/**
 * Sends emails over SMTP (Gmail, Amazon SES, Mailgun...).
 * Without SMTP settings, emails are printed to the logs instead, so local
 * development works with no email account.
 *
 * Branded emails pass `html`; the RegRadar logo is attached inline (cid:regradar-logo)
 * so it shows in Gmail and Outlook, which block SVG and most external images.
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

export async function sendMail(to: string[], subject: string, text: string, html?: string) {
  if (!to.length) return;
  if (!transport) {
    logger.info({ to, subject }, "SMTP not configured: email logged instead of sent\n" + text);
    return;
  }
  await transport.sendMail({
    from: config.smtp.from, to, subject, text,
    ...(html ? { html, attachments: logo && html.includes(`cid:${LOGO_CID}`) ? [{ filename: "regradar.png", content: logo, cid: LOGO_CID }] : [] } : {}),
  });
}

/** Checks the SMTP login without sending anything (for the admin health page). */
export async function checkSmtp(): Promise<{ configured: boolean; ok: boolean; error?: string }> {
  if (!transport) return { configured: false, ok: false };
  try { await transport.verify(); return { configured: true, ok: true }; }
  catch (e) { return { configured: true, ok: false, error: (e as Error).message.slice(0, 200) }; }
}
