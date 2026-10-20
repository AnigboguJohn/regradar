import assert from "node:assert/strict";
import { test } from "node:test";
import { base32Decode, base32Encode, decryptSecret, encryptSecret, newTotpSecret, totpCode, verifyTotp } from "../src/totp.js";

// RFC 6238 appendix B: SHA-1 secret "12345678901234567890"; the last 6 digits of each 8-digit code.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

test("TOTP codes match the RFC 6238 test vectors", () => {
  assert.equal(totpCode(RFC_SECRET, 59_000), "287082");
  assert.equal(totpCode(RFC_SECRET, 1_111_111_109_000), "081804");
  assert.equal(totpCode(RFC_SECRET, 1_234_567_890_000), "005924");
  assert.equal(totpCode(RFC_SECRET, 2_000_000_000_000), "279037");
});

test("verification accepts one step of clock drift and nothing else", () => {
  const s = newTotpSecret();
  const now = 1_800_000_000_000;
  assert.ok(verifyTotp(s, totpCode(s, now), now));
  assert.ok(verifyTotp(s, totpCode(s, now - 30_000), now));
  assert.ok(!verifyTotp(s, totpCode(s, now - 90_000), now));
  assert.ok(!verifyTotp(s, "12345", now));
  assert.ok(!verifyTotp(s, "abcdef", now));
});

test("base32 round-trips and secrets are stored encrypted", () => {
  const raw = Buffer.from("any bytes at all \u0000ÿ");
  assert.deepEqual(base32Decode(base32Encode(raw)), raw);
  const s = newTotpSecret();
  const stored = encryptSecret(s);
  assert.ok(!stored.includes(s));
  assert.equal(decryptSecret(stored), s);
  assert.notEqual(encryptSecret(s), stored);   // random IV each time
});
