/**
 * Integration tests: the real API (Express app, auth, SQL, migrations) against a real
 * PostgreSQL database, with a small fake AI service so no model or internet is needed.
 *
 * Needs TEST_DATABASE_URL pointing at a database whose name ends in "_test" (it is wiped
 * and rebuilt on every run). Without it these tests are skipped, so `npm test` still works.
 *   Local:  createdb regradar_test, then
 *           TEST_DATABASE_URL=postgresql://regradar:regradar@localhost:5432/regradar_test npm test
 *   CI:     set in .github/workflows/ci.yml
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";

const DB_URL = process.env.TEST_DATABASE_URL;
const skip = !DB_URL ? "TEST_DATABASE_URL not set" : !/_test(\?|$)/.test(new URL(DB_URL).pathname) ? "TEST_DATABASE_URL must name a *_test database" : false;

// ---------------- Fake AI service ----------------
const fakeAi = { up: true, lastAnswerBody: null as any };
const aiServer = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const send = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (!fakeAi.up) return send(503, { detail: "down" });
    if (req.url === "/health") return send(200, { ok: true, llm: false, embeddings: false, sources: ["cbn_circulars"] });
    if (req.url === "/answer") {
      const body = JSON.parse(raw || "{}");
      fakeAi.lastAnswerBody = body;
      if (body.question.includes("explode")) return send(500, { detail: "model crashed" });
      return send(200, { answer: `Answer to: ${body.question}`, citations: [], mode: "extractive", retrieved: 0 });
    }
    if (req.url === "/impact") return send(200, { findings: [] });
    return send(404, { detail: "not faked" });
  });
});

let base = "";
let apiServer: http.Server;
let mod: {
  hashCode: (c: string) => string; totpCode: (s: string, t?: number) => string;
  runAlertMonitor: () => Promise<any>; query: (sql: string, p?: unknown[]) => Promise<any[]>; pool: { end: () => Promise<void> };
};

before(async () => {
  if (skip) return;
  await new Promise<void>((r) => aiServer.listen(0, "127.0.0.1", r));
  Object.assign(process.env, {
    NODE_ENV: "test", DATABASE_URL: DB_URL, JWT_SECRET: "integration-test-secret", INTERNAL_TOKEN: "test",
    AI_SERVICE_URL: `http://127.0.0.1:${(aiServer.address() as AddressInfo).port}`, APP_URL: "http://app.test",
    RECAPTCHA_SECRET_KEY: "", RECAPTCHA_SITE_KEY: "", SMTP_HOST: "", OPS_MONITOR_MINUTES: "0", CRON_INTERVAL_MINUTES: "0",
    MIGRATIONS_DIR: new URL("../../../db/migrations", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), LOG_LEVEL: "silent",
  });
  // Imported only now, because config is read from the environment at import time.
  const db = await import("../src/db.js");
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await db.migrate();
  const { createApp } = await import("../src/app.js");
  mod = { ...db, ...(await import("../src/passwordReset.js")), ...(await import("../src/totp.js")), ...(await import("../src/ops.js")) } as any;
  apiServer = createApp().listen(0);
  base = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}/api`;
});

after(async () => {
  if (skip) return;
  apiServer?.close(); aiServer.close();
  await mod?.pool.end();
});

async function call(method: string, path: string, body?: unknown, token?: string) {
  const r = await fetch(base + path, {
    method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : {} };
}
const PW = "GoodPass-123";
let n = 0;
async function newCompany(name = "Test Bank") {
  const email = `owner${++n}@bank.test`;
  const reg = await call("POST", "/auth/register", { orgName: name, name: "Ada Owner", email, password: PW, confirmPassword: PW });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const login = await call("POST", "/auth/login", { email, password: PW });
  return { email, token: login.body.token as string, user: login.body.user };
}

describe("sign-up and sign-in", { skip }, () => {
  test("sign-up validates input", async () => {
    const base = { orgName: "Acme", name: "Ada", email: "a@bank.test", password: PW };
    assert.equal((await call("POST", "/auth/register", { ...base, confirmPassword: "Other-123456" })).body.error, "The two passwords don't match");
    assert.match((await call("POST", "/auth/register", { ...base, password: "short", confirmPassword: "short" })).body.error, /10 characters/);
    assert.equal((await call("POST", "/auth/register", { ...base, email: "nope", confirmPassword: PW })).body.error, "Enter a valid email address");
  });

  test("duplicate email is refused with a sign-in hint", async () => {
    const { email } = await newCompany();
    const r = await call("POST", "/auth/register", { orgName: "Another Co", name: "Someone Else", email, password: PW, confirmPassword: PW });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "email_taken");
  });

  test("unknown email and wrong password get different messages", async () => {
    const { email } = await newCompany();
    assert.equal((await call("POST", "/auth/login", { email: "nobody@bank.test", password: PW })).body.code, "no_account");
    assert.equal((await call("POST", "/auth/login", { email, password: "Wrong-Pass-1" })).body.code, "bad_credentials");
  });

  test("remember me gives a 30-day session instead of 12 hours", async () => {
    const { email } = await newCompany();
    const life = (t: string) => { const p = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()); return (p.exp - p.iat) / 3600; };
    assert.equal(life((await call("POST", "/auth/login", { email, password: PW })).body.token), 12);
    assert.equal(life((await call("POST", "/auth/login", { email, password: PW, remember: true })).body.token), 720);
  });

  test("a tampered token is rejected", async () => {
    const { token } = await newCompany();
    assert.equal((await call("GET", "/me", undefined, token)).status, 200);
    assert.equal((await call("GET", "/me", undefined, token.slice(0, -3) + "abc")).status, 401);
  });
});

describe("password reset", { skip }, () => {
  async function requestCode(email: string, code = "123456") {
    assert.equal((await call("POST", "/auth/forgot", { email })).status, 200);
    // The code is created in the background (the page doesn't wait for the email), so wait for it.
    const latest = `SELECT r.id FROM password_resets r JOIN users u ON u.id = r.user_id
                    WHERE u.email = $1 AND r.used_at IS NULL AND r.invalidated_at IS NULL ORDER BY r.id DESC LIMIT 1`;
    for (let i = 0; i < 50 && !(await mod.query(latest, [email])).length; i++) await new Promise((r) => setTimeout(r, 20));
    // The real code is only emailed (and stored hashed), so the test plants a known one.
    const updated = await mod.query(`UPDATE password_resets SET code_hash = $2 WHERE id = (${latest}) RETURNING id`, [email, mod.hashCode(code)]);
    assert.equal(updated.length, 1, "a reset code was created");
  }
  const reset = (email: string, code: string, password = "NewPass-4567") => call("POST", "/auth/reset", { email, code, password, confirmPassword: password });

  test("unknown email is told to sign up", async () => {
    assert.equal((await call("POST", "/auth/forgot", { email: "ghost@bank.test" })).body.code, "no_account");
  });

  test("wrong codes count down and then lock the code", async () => {
    const { email } = await newCompany();
    await requestCode(email);
    assert.equal((await reset(email, "000000")).body.error, "That code is wrong. 4 attempts left.");
    for (let i = 0; i < 3; i++) await reset(email, "000000");
    assert.equal((await reset(email, "000000")).body.code, "locked");
    assert.equal((await reset(email, "123456")).body.code, "locked");   // even the right code is locked now
  });

  test("an expired code is refused", async () => {
    const { email } = await newCompany();
    await requestCode(email);
    await mod.query("UPDATE password_resets SET expires_at = now() - interval '1 minute'");
    assert.equal((await reset(email, "123456")).body.code, "expired");
  });

  test("a correct code changes the password, signs out old sessions and can't be reused", async () => {
    const { email, token } = await newCompany();
    await requestCode(email, "654321");
    assert.equal((await reset(email, "654321")).status, 200);
    assert.equal((await call("GET", "/me", undefined, token)).status, 401, "old session ended");
    assert.equal((await call("POST", "/auth/login", { email, password: PW })).status, 401);
    assert.equal((await call("POST", "/auth/login", { email, password: "NewPass-4567" })).status, 200);
    assert.equal((await reset(email, "654321")).body.code, "no_code");
  });
});

describe("conversations with Remi", { skip }, () => {
  test("follow-ups continue the conversation and send its history", async () => {
    const { token } = await newCompany();
    const first = await call("POST", "/ask", { question: "What is the Tier 1 limit?" }, token);
    assert.equal(first.status, 200);
    const id = first.body.conversation_id;
    const second = await call("POST", "/ask", { question: "And for Tier 2?", conversation_id: id }, token);
    assert.equal(second.body.conversation_id, id);
    assert.equal(fakeAi.lastAnswerBody.history.length, 1);
    assert.equal(fakeAi.lastAnswerBody.history[0].question, "What is the Tier 1 limit?");
    const convo = await call("GET", `/conversations/${id}`, undefined, token);
    assert.equal(convo.body.messages.length, 2);
  });

  test("rename, pin, archive and delete", async () => {
    const { token } = await newCompany();
    const id = (await call("POST", "/ask", { question: "Question one" }, token)).body.conversation_id;
    await call("PATCH", `/conversations/${id}`, { title: "Renamed", pinned: true }, token);
    let list = (await call("GET", "/conversations", undefined, token)).body.conversations;
    assert.equal(list[0].title, "Renamed");
    assert.ok(list[0].pinned_at);
    await call("PATCH", `/conversations/${id}`, { archived: true }, token);
    assert.equal((await call("GET", "/conversations", undefined, token)).body.conversations.length, 0);
    assert.equal((await call("GET", "/conversations?archived=1", undefined, token)).body.conversations.length, 1);
    assert.equal((await call("DELETE", `/conversations/${id}`, undefined, token)).status, 204);
    assert.equal((await call("GET", `/conversations/${id}`, undefined, token)).status, 404);
  });

  test("another company can't read or continue your conversation", async () => {
    const a = await newCompany("A Bank");
    const b = await newCompany("B Bank");
    const id = (await call("POST", "/ask", { question: "Private question" }, a.token)).body.conversation_id;
    assert.equal((await call("GET", `/conversations/${id}`, undefined, b.token)).status, 404);
    assert.equal((await call("POST", "/ask", { question: "Sneaky follow-up", conversation_id: id }, b.token)).status, 404);
  });
});

describe("team invites", { skip }, () => {
  test("invite, accept, and the link works once", async () => {
    const { token } = await newCompany("Invite Bank");
    const inv = await call("POST", "/team/invites", { email: "new.member@bank.test", role: "member" }, token);
    assert.equal(inv.status, 201);
    const t = inv.body.link.split("/invite/")[1];
    assert.equal((await call("GET", `/auth/invites/${t}`)).body.orgName, "Invite Bank");
    const accept = await call("POST", `/auth/invites/${t}/accept`, { name: "New Member", password: PW, confirmPassword: PW });
    assert.equal(accept.status, 201);
    assert.equal((await call("GET", `/auth/invites/${t}`)).body.code, "used");
    const member = await call("POST", "/auth/login", { email: "new.member@bank.test", password: PW });
    assert.equal(member.body.user.role, "member");
    assert.equal((await call("POST", "/team/invites", { email: "x@bank.test" }, member.body.token)).status, 403, "members can't invite");
  });

  test("a cancelled invite stops working", async () => {
    const { token } = await newCompany();
    const t = (await call("POST", "/team/invites", { email: "later@bank.test" }, token)).body.link.split("/invite/")[1];
    const id = (await call("GET", "/team/invites", undefined, token)).body.invites[0].id;
    await call("DELETE", `/team/invites/${id}`, undefined, token);
    assert.equal((await call("GET", `/auth/invites/${t}`)).body.code, "revoked");
  });
});

describe("admin console", { skip }, () => {
  let admin = "";
  before(async () => {
    if (skip) return;
    const { hashPassword } = await import("../src/auth.js");
    await mod.query("INSERT INTO platform_admins (email, name, password_hash) VALUES ('ops@regradar.test', 'Ops', $1)", [await hashPassword("Admin-Pass-123456")]);
    const login = await call("POST", "/admin/auth/login", { email: "ops@regradar.test", password: "Admin-Pass-123456" });
    assert.equal(login.body.step, "setup");
    const verified = await call("POST", "/admin/auth/verify", { challenge: login.body.challenge, code: mod.totpCode(login.body.secret) });
    admin = verified.body.token;
    assert.ok(admin);
  });

  test("admin and company tokens can't be swapped", async () => {
    const { token } = await newCompany();
    assert.equal((await call("GET", "/admin/overview", undefined, token)).status, 401);
    assert.equal((await call("GET", "/me", undefined, admin)).status, 401);
  });

  test("the second sign-in needs only the authenticator code", async () => {
    const login = await call("POST", "/admin/auth/login", { email: "ops@regradar.test", password: "Admin-Pass-123456" });
    assert.equal(login.body.step, "code");
    assert.equal((await call("POST", "/admin/auth/verify", { challenge: login.body.challenge, code: "000000" })).status, 400);
  });

  test("suspending a company blocks its users immediately", async () => {
    const { email, token, user } = await newCompany("Suspend Me");
    assert.equal((await call("PATCH", `/admin/companies/${user.orgId}`, { suspended: true }, admin)).status, 200);
    assert.equal((await call("GET", "/me", undefined, token)).body.code, "suspended");
    assert.equal((await call("POST", "/auth/login", { email, password: PW })).status, 403);
    await call("PATCH", `/admin/companies/${user.orgId}`, { suspended: false }, admin);
    assert.equal((await call("POST", "/auth/login", { email, password: PW })).status, 200);
  });

  test("a company's only admin can't be demoted", async () => {
    const { user } = await newCompany();
    assert.equal((await call("PATCH", `/admin/users/${user.id}`, { role: "member" }, admin)).status, 400);
  });

  test("overview totals add up", async () => {
    const o = await call("GET", "/admin/overview", undefined, admin);
    const users = (await mod.query("SELECT count(*)::int AS n FROM users"))[0].n;
    assert.equal(o.body.totals.users, users);
    assert.equal(o.body.daily.length, 30);
  });
});

describe("error tracking, health and alerts", { skip }, () => {
  let admin = "";
  before(async () => {
    if (skip) return;
    const login = await call("POST", "/admin/auth/login", { email: "ops@regradar.test", password: "Admin-Pass-123456" });
    const secret = (await mod.query("SELECT totp_secret FROM platform_admins WHERE email = 'ops@regradar.test'"))[0].totp_secret;
    const { decryptSecret } = await import("../src/totp.js");
    admin = (await call("POST", "/admin/auth/verify", { challenge: login.body.challenge, code: mod.totpCode(decryptSecret(secret)) })).body.token;
  });

  test("browser crashes are grouped and counted", async () => {
    const crash = { message: "TypeError: x is undefined", stack: "TypeError: x is undefined\n    at render (app.js:10:5)", url: "http://app.test/ask?c=42" };
    assert.equal((await call("POST", "/client-errors", crash)).status, 204);
    await call("POST", "/client-errors", crash);
    await new Promise((r) => setTimeout(r, 200));   // writes are fire-and-forget
    const errs = (await call("GET", "/admin/errors?source=web", undefined, admin)).body.errors;
    const e = errs.find((x: any) => x.message === crash.message);
    assert.equal(e.count, 2);
    assert.equal(e.path, "/ask", "query strings are not stored");
  });

  test("AI service failures are recorded and shown as a friendly 502", async () => {
    const { token } = await newCompany();
    const r = await call("POST", "/ask", { question: "please explode" }, token);
    assert.equal(r.status, 502);
    await new Promise((res) => setTimeout(res, 200));
    const errs = (await call("GET", "/admin/errors?source=ai", undefined, admin)).body.errors;
    assert.ok(errs.some((x: any) => x.path === "POST /api/ask"));
  });

  test("readiness reports the AI service going down, and the alert fires then clears", async () => {
    assert.equal((await fetch(base + "/health/ready")).status, 200);
    fakeAi.up = false;
    try {
      assert.equal((await fetch(base + "/health/ready")).status, 503);
      await mod.runAlertMonitor();
      assert.equal((await mod.query("SELECT status FROM ops_alerts WHERE key = 'ai_down'"))[0].status, "firing");
    } finally { fakeAi.up = true; }
    await mod.runAlertMonitor();
    assert.equal((await mod.query("SELECT status FROM ops_alerts WHERE key = 'ai_down'"))[0].status, "resolved");
  });
});
