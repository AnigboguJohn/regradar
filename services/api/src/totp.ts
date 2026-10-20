/**
 * Time-based one-time codes (TOTP, RFC 6238): the 6-digit codes shown by Google Authenticator,
 * Microsoft Authenticator, 1Password and similar apps. Implemented with Node's crypto so no
 * extra dependency is needed. Secrets are stored encrypted (AES-256-GCM, key derived from
 * JWT_SECRET), so the database alone can't be used to generate codes.
 */
import crypto from "node:crypto";
import { config } from "./config.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;

export function base32Encode(buf: Buffer) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string) {
  const clean = s.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** A new random secret (160 bits, the size authenticator apps expect), as base32. */
export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

export function totpCode(secret: string, time = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 1000 / STEP_SECONDS)));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = h[h.length - 1] & 15;
  const n = ((h[offset] & 127) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/** Accepts the current code and the ones either side, to allow for a clock that's slightly off. */
export function verifyTotp(secret: string, code: string, time = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((w) => {
    const a = Buffer.from(totpCode(secret, time + w * STEP_SECONDS * 1000));
    return crypto.timingSafeEqual(a, Buffer.from(code));
  });
}

/** The link an authenticator app reads from the QR code. */
export const otpauthUrl = (secret: string, account: string) =>
  `otpauth://totp/${encodeURIComponent(`RegRadar Admin:${account}`)}?secret=${secret}&issuer=${encodeURIComponent("RegRadar Admin")}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;

const key = () => crypto.createHash("sha256").update(`totp-secret:${config.jwtSecret}`).digest();

export function encryptSecret(secret: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(secret, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decryptSecret(stored: string) {
  const [iv, tag, data] = stored.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}
