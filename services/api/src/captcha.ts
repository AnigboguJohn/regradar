/**
 * Google reCAPTCHA v2 check for the public auth forms (sign-up, sign-in, forgot password).
 * The browser solves the "I'm not a robot" checkbox and sends us its token; we ask Google
 * whether that token is genuine. With no secret key configured the check is switched off.
 */
import { config } from "./config.js";
import { logger } from "./logger.js";

export const CAPTCHA_MISSING = "Please tick “I'm not a robot” and try again.";
export const CAPTCHA_FAILED = "We couldn't confirm you're not a robot. Please tick the box again.";

/** null when the check passes (or reCAPTCHA is off), otherwise a message for the user. */
export async function captchaProblem(token: unknown, ip?: string): Promise<string | null> {
  if (!config.recaptcha.secretKey) return null;
  if (typeof token !== "string" || !token.trim()) return CAPTCHA_MISSING;
  try {
    const r = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: config.recaptcha.secretKey, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    const body = (await r.json()) as { success?: boolean; "error-codes"?: string[] };
    if (body.success) return null;
    logger.info({ codes: body["error-codes"] }, "reCAPTCHA rejected");
    return CAPTCHA_FAILED;
  } catch (e) {
    // If Google can't be reached, fail closed: the form stays protected.
    logger.warn({ err: (e as Error).message }, "reCAPTCHA verification unavailable");
    return "We couldn't check the “I'm not a robot” box right now. Please try again in a moment.";
  }
}
