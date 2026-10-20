/**
 * Branded HTML emails (password reset codes, team invites). Email apps need tables and
 * inline styles, so everything here is old-fashioned HTML on purpose. The logo is the
 * inline attachment added by mailer.ts (cid:regradar-logo).
 */
import { LOGO_CID } from "./mailer.js";

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const FONT = "-apple-system,'Segoe UI',Roboto,Arial,sans-serif";

/** A violet call-to-action button that works in Gmail and Outlook. */
export function emailButton(href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
    <td style="border-radius:10px;background:#0f172a;">
      <a href="${esc(href)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${esc(label)}</a>
    </td></tr></table>`;
}

/** The common frame: logo header, title, intro line, main content and a small-print footnote. */
export function brandedEmail({ title, intro, content, footnote }: { title: string; intro: string; content: string; footnote: string }) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f1fa;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1fa;padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;border:1px solid #e9e5f5;font-family:${FONT};color:#0f172a;">
      <tr><td style="padding:28px 32px 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle;"><img src="cid:${LOGO_CID}" width="36" height="36" alt="RegRadar" style="display:block;border:0;border-radius:9px;"></td>
          <td style="vertical-align:middle;padding-left:10px;font-size:18px;font-weight:700;letter-spacing:-0.2px;">RegRadar</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:16px 32px 0;">
        <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;">${esc(title)}</h1>
        <p style="margin:0;font-size:15px;line-height:1.55;color:#475569;">${intro}</p>
      </td></tr>
      <tr><td align="center" style="padding:24px 32px;">${content}</td></tr>
      <tr><td style="padding:0 32px 28px;">
        <p style="margin:0;padding-top:16px;border-top:1px solid #f1f5f9;font-size:13px;line-height:1.55;color:#64748b;">${footnote}</p>
      </td></tr>
    </table>
    <p style="margin:16px 0 0;font-family:${FONT};font-size:12px;color:#94a3b8;">RegRadar · Regulatory compliance assistant</p>
  </td></tr>
</table>
</body></html>`;
}

export function inviteEmail(o: { inviter: string; orgName: string; role: string; link: string; days: number }) {
  const roleText = o.role === "admin" ? "an admin" : "a member";
  const text = [
    `${o.inviter} invited you to join ${o.orgName} on RegRadar as ${roleText}.`,
    "",
    "RegRadar tracks new regulations, answers compliance questions with citations, and checks your policies against new rules.",
    "",
    "Accept the invite and choose your password here:",
    o.link,
    "",
    `This link works once and expires in ${o.days} days. If you weren't expecting it, you can ignore this email.`,
  ].join("\n");
  const html = brandedEmail({
    title: `Join ${o.orgName} on RegRadar`,
    intro: `<strong style="color:#0f172a;">${esc(o.inviter)}</strong> invited you to join <strong style="color:#0f172a;">${esc(o.orgName)}</strong> as ${roleText}.`,
    content: `${emailButton(o.link, "Accept invite")}
      <p style="margin:14px 0 0;font-size:13px;color:#64748b;">Expires in <strong style="color:#0f172a;">${o.days} days</strong> · works once</p>
      <p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;word-break:break-all;">Button not working? Paste this link into your browser:<br><a href="${esc(o.link)}" style="color:#6d28d9;">${esc(o.link)}</a></p>`,
    footnote: "RegRadar tracks new regulations, answers compliance questions with citations, and checks your policies against new rules. If you weren't expecting this invite, you can ignore this email.",
  });
  return { subject: `${o.inviter} invited you to ${o.orgName} on RegRadar`, text, html };
}
