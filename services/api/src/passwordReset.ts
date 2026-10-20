/**
 * Password reset codes: 6 digits, emailed, valid for 5 minutes and 5 attempts, usable once.
 * Only an HMAC of the code is stored, keyed with the server secret, so a database leak
 * doesn't reveal working codes.
 */
import crypto from "node:crypto";
import { config } from "./config.js";
import { tx } from "./db.js";
import { brandedEmail, esc } from "./emails.js";
import { sendMail } from "./mailer.js";

export const CODE_TTL_MINUTES = 5;
export const MAX_ATTEMPTS = 5;
export const RESEND_SECONDS = 60;

export const FORGOT_MESSAGE = `We've sent a 6-digit code to your email. It expires in ${CODE_TTL_MINUTES} minutes.`;
export const NO_ACCOUNT = "There's no account with this email. Please create an account first.";

export const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

export const hashCode = (code: string) => crypto.createHmac("sha256", config.jwtSecret).update(`reset:${code}`).digest("hex");

export function codeMatches(code: string, storedHash: string) {
  const a = Buffer.from(hashCode(code), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}


/** The reset email, as plain text and as a branded HTML version with the RegRadar logo. */
export function resetEmail(name: string, code: string) {
  const first = name.split(/\s+/)[0] || name;
  const text = [
    `Hi ${first},`,
    "",
    "Use this code to reset your RegRadar password:",
    "",
    `    ${code}`,
    "",
    `It expires in ${CODE_TTL_MINUTES} minutes and can only be used once.`,
    "",
    "If you didn't ask to reset your password, you can ignore this email. Your password won't change.",
    "",
    "RegRadar",
  ].join("\n");

  const html = brandedEmail({
    title: "Reset your password",
    intro: `Hi ${esc(first)}, use this code to reset your RegRadar password.`,
    content: `<div style="display:inline-block;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:16px 28px;font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:10px;color:#4c1d95;">${code}</div>
        <p style="margin:12px 0 0;font-size:13px;color:#64748b;">Expires in <strong style="color:#0f172a;">${CODE_TTL_MINUTES} minutes</strong> · can be used once</p>`,
    footnote: "If you didn't ask to reset your password, you can ignore this email. Your password won't change, and no one can use this code without access to your inbox.",
  });

  return { subject: `${code} is your RegRadar password reset code`, text, html };
}

// ---------------- Team invite links ----------------
export const INVITE_DAYS = 7;
/** A long random token for the invite link; only its SHA-256 hash is stored. */
export const newInviteToken = () => crypto.randomBytes(32).toString("base64url");
export const hashInviteToken = (token: string) => crypto.createHash("sha256").update(`invite:${token}`).digest("hex");

/**
 * Create a new reset code for a user (cancelling older ones) and email it. Used by the
 * Forgot password page and by the admin console's "Send password reset" button.
 * Resolves once the email is handed to the mail server.
 */
export async function issueResetCode(user: { id: string; name: string; email: string }) {
  const code = newCode();
  await tx(async (c) => {
    await c.query("UPDATE password_resets SET invalidated_at = now() WHERE user_id = $1 AND used_at IS NULL AND invalidated_at IS NULL", [user.id]);
    await c.query(
      "INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))",
      [user.id, hashCode(code), CODE_TTL_MINUTES]);
  });
  const mail = resetEmail(user.name, code);
  await sendMail([user.email], mail.subject, mail.text, mail.html);
}
