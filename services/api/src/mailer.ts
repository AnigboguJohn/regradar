/**
 * Sends emails, by one of two routes:
 *   - Brevo's HTTPS API when BREVO_API_KEY is set. Used on hosts that block SMTP ports
 *     (Render's free plan blocks 25/465/587). The logo is linked from the website.
 *   - SMTP otherwise (Gmail, Amazon SES, Mailgun...). The logo is attached inline.
 * With neither configured, emails are printed to the logs, so local development works
 * with no email account.
 */
import fs from "node:fs";
import nodemailer from "nodemailer";
import { config } from "./config.js";
import { logger } from "./logger.js";

const transport = config.smtp.host
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

export const LOGO_CID = "regradar-logo";
// assets/ sits next to src/ (dev) and dist/ (Docker image), so this path works in both.
const logoPath = new URL("../assets/logo.png", import.meta.url);
const logo = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;

/** "RegRadar <alerts@x.com>" -> { name: "RegRadar", email: "alerts@x.com" } */
function parseFrom(from: string) {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].replace(/^"|"$/g, "") || "RegRadar", email: m[2] } : { name: "RegRadar", email: from.trim() };
}

export const emailEnabled = () => !!(config.brevoApiKey || transport);

async function sendViaBrevo(to: string[], subject: string, text: string, html?: string) {
  const logoUrl = `${config.appUrl.replace(/\/$/, "")}/email-logo.png`;
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": config.brevoApiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: parseFrom(config.smtp.from),
      to: to.map((email) => ({ email })),
      subject,
      textContent: text,
      ...(html ? { htmlContent: html.replaceAll(`cid:${LOGO_CID}`, logoUrl) } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Brevo refused the email (${r.status}): ${(await r.text()).slice(0, 300)}`);
}

export async function sendMail(to: string[], subject: string, text: string, html?: string) {
  if (!to.length) return;
  if (config.brevoApiKey) return sendViaBrevo(to, subject, text, html);
  if (!transport) {
    logger.info({ to, subject }, "Email not configured: email logged instead of sent\n" + text);
    return;
  }
  await transport.sendMail({
    from: config.smtp.from, to, subject, text,
    ...(html ? { html, attachments: logo && html.includes(`cid:${LOGO_CID}`) ? [{ filename: "regradar.png", content: logo, cid: LOGO_CID }] : [] } : {}),
  });
}

/** Checks the email login without sending anything (for the admin health page and alerts). */
export async function checkSmtp(): Promise<{ configured: boolean; ok: boolean; error?: string; via?: string }> {
  if (config.brevoApiKey) {
    try {
      const r = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": config.brevoApiKey, accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
      return r.ok ? { configured: true, ok: true, via: "brevo" } : { configured: true, ok: false, via: "brevo", error: `Brevo said ${r.status}: check the API key` };
    } catch (e) { return { configured: true, ok: false, via: "brevo", error: (e as Error).message.slice(0, 200) }; }
  }
  if (!transport) return { configured: false, ok: false };
  try { await transport.verify(); return { configured: true, ok: true, via: "smtp" }; }
  catch (e) { return { configured: true, ok: false, via: "smtp", error: (e as Error).message.slice(0, 200) }; }
}
