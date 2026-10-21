/** Email through Brevo's HTTPS API (used on Render, whose free plan blocks SMTP ports). */
import assert from "node:assert/strict";
import { test } from "node:test";

Object.assign(process.env, {
  BREVO_API_KEY: "test-brevo-key", MAIL_FROM: "RegRadar <owner@example.com>", APP_URL: "https://regradar.example.app", SMTP_HOST: "",
});
const calls: { url: string; init: RequestInit }[] = [];
globalThis.fetch = (async (url: string, init: RequestInit) => {
  calls.push({ url, init });
  return new Response(JSON.stringify({ messageId: "1" }), { status: 201 });
}) as typeof fetch;
const { sendMail, emailEnabled, LOGO_CID } = await import("../src/mailer.js");

test("Brevo: sender, recipients, subject and the logo link are sent correctly", async () => {
  assert.equal(emailEnabled(), true);
  await sendMail(["a@bank.test", "b@bank.test"], "123456 is your code", "plain text", `<img src="cid:${LOGO_CID}"> hello`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.brevo.com/v3/smtp/email");
  assert.equal((calls[0].init.headers as Record<string, string>)["api-key"], "test-brevo-key");
  const body = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(body.sender, { name: "RegRadar", email: "owner@example.com" });
  assert.deepEqual(body.to, [{ email: "a@bank.test" }, { email: "b@bank.test" }]);
  assert.equal(body.subject, "123456 is your code");
  assert.equal(body.textContent, "plain text");
  assert.equal(body.htmlContent, '<img src="https://regradar.example.app/email-logo.png"> hello');
});

test("Brevo: a refused email raises an error (so it is logged, not silently lost)", async () => {
  globalThis.fetch = (async () => new Response('{"message":"sender not verified"}', { status: 400 })) as unknown as typeof fetch;
  await assert.rejects(sendMail(["a@bank.test"], "x", "y"), /Brevo refused the email \(400\)/);
});
