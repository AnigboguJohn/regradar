/**
 * Platform admin console API, mounted at /api/admin. Only platform admins (their own accounts,
 * password + authenticator code) can use it. Unlike the company API, queries here deliberately
 * span every organisation: this is the operator's view of the whole service.
 * Every change an admin makes is written to admin_audit.
 */
import crypto from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import QRCode from "qrcode";
import { z } from "zod";
import {
  ADMIN_SESSION_EXPIRED, adminAudit, readChallenge, requirePlatformAdmin, signAdminToken, signChallenge,
} from "./adminAuth.js";
import { ai } from "./ai.js";
import { hashPassword, passwordProblem, verifyPassword } from "./auth.js";
import { captchaProblem } from "./captcha.js";
import { config } from "./config.js";
import { one, pool, query } from "./db.js";
import { runMonitoringCycle } from "./jobs.js";
import { checkSmtp, emailEnabled } from "./mailer.js";
import { runAlertMonitor, sendTestAlert } from "./ops.js";
import { issueResetCode } from "./passwordReset.js";
import { decryptSecret, encryptSecret, newTotpSecret, otpauthUrl, verifyTotp } from "./totp.js";

export const adminRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many attempts. Please wait 15 minutes and try again." }, skip: () => config.isTest });

const PAGE = 25;
const page = (req: Request) => Math.max(1, Number(req.query.page ?? 1) || 1);
const uuid = z.string().uuid();
// A real bcrypt hash of a random value, checked when the email is unknown so both cases take the same time.
const dummyHash = hashPassword(crypto.randomUUID());
const GOOGLE_TEST_SITE_KEY = "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI";

// ---------------- Sign in (password + reCAPTCHA, then authenticator code) ----------------
const LoginIn = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().max(200),
  captcha: z.string().max(4000).optional(),
});

adminRouter.post("/auth/login", loginLimiter, wrap(async (req, res) => {
  const b = LoginIn.parse(req.body);
  const robot = await captchaProblem(b.captcha, req.ip);
  if (robot) return res.status(400).json({ error: robot, code: "captcha" });
  const a = await one("SELECT id, email, name, password_hash, totp_enabled, disabled_at FROM platform_admins WHERE email = $1", [b.email]);
  const ok = await verifyPassword(b.password, a?.password_hash ?? await dummyHash);
  // One message for unknown email and wrong password: the admin console never confirms who is an admin.
  if (!a || !ok) {
    adminAudit(req, "admin_login_failed", { email: b.email }, a?.id);
    return res.status(401).json({ error: "Incorrect email or password" });
  }
  if (a.disabled_at) return res.status(403).json({ error: "This admin account is disabled." });
  if (a.totp_enabled) return res.json({ step: "code", challenge: signChallenge(a.id) });
  // First sign-in: set up the authenticator app. The secret is only saved once a code proves it works.
  const secret = newTotpSecret();
  const url = otpauthUrl(secret, a.email);
  res.json({ step: "setup", challenge: signChallenge(a.id, encryptSecret(secret)), secret, otpauthUrl: url,
    qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) });
}));

const VerifyIn = z.object({ challenge: z.string().max(4000), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app") });

adminRouter.post("/auth/verify", loginLimiter, wrap(async (req, res) => {
  const b = VerifyIn.parse(req.body);
  const ch = readChallenge(b.challenge);
  if (!ch) return res.status(401).json({ error: "That took too long. Sign in again.", code: "challenge_expired" });
  const a = await one("SELECT id, email, name, totp_secret, totp_enabled, token_version, disabled_at FROM platform_admins WHERE id = $1", [ch.adminId]);
  if (!a || a.disabled_at) return res.status(401).json({ error: ADMIN_SESSION_EXPIRED });
  const stored = ch.setup ?? a.totp_secret;
  if (!stored || (!ch.setup && !a.totp_enabled)) return res.status(401).json({ error: "Sign in again.", code: "challenge_expired" });
  if (!verifyTotp(decryptSecret(stored), b.code)) {
    adminAudit(req, "admin_2fa_failed", {}, a.id);
    return res.status(400).json({ error: "That code isn't right. Check your authenticator app and try the current code." });
  }
  if (ch.setup) await query("UPDATE platform_admins SET totp_secret = $2, totp_enabled = true WHERE id = $1", [a.id, ch.setup]);
  await query("UPDATE platform_admins SET last_login_at = now() WHERE id = $1", [a.id]);
  adminAudit(req, ch.setup ? "admin_2fa_enabled" : "admin_login", {}, a.id);
  res.json({ token: signAdminToken(a, a.token_version), admin: { id: a.id, email: a.email, name: a.name } });
}));

// Everything below needs a signed-in platform admin.
adminRouter.use(requirePlatformAdmin);

adminRouter.get("/me", wrap(async (req, res) => {
  res.json({ admin: await one("SELECT id, email, name, created_at, last_login_at FROM platform_admins WHERE id = $1", [req.admin!.id]) });
}));

adminRouter.post("/auth/logout", wrap(async (req, res) => {
  await query("UPDATE platform_admins SET token_version = token_version + 1 WHERE id = $1", [req.admin!.id]);
  adminAudit(req, "admin_logout");
  res.status(204).end();
}));

adminRouter.post("/me/password", loginLimiter, wrap(async (req, res) => {
  const b = z.object({ current: z.string().max(200), next: z.string().max(200) }).parse(req.body);
  const a = await one("SELECT password_hash FROM platform_admins WHERE id = $1", [req.admin!.id]);
  if (!(await verifyPassword(b.current, a.password_hash))) return res.status(400).json({ error: "Your current password is incorrect" });
  const problem = passwordProblem(b.next);
  if (problem) return res.status(400).json({ error: problem });
  if (b.next.length < 14) return res.status(400).json({ error: "Admin passwords must be at least 14 characters" });
  const { token_version } = await one(
    "UPDATE platform_admins SET password_hash = $2, token_version = token_version + 1 WHERE id = $1 RETURNING token_version",
    [req.admin!.id, await hashPassword(b.next)]);
  adminAudit(req, "admin_password_change");
  res.json({ token: signAdminToken(req.admin!, token_version) });
}));

// ---------------- Overview ----------------
adminRouter.get("/overview", wrap(async (_req, res) => {
  const totals = await one(`SELECT
    (SELECT count(*) FROM organizations)::int AS companies,
    (SELECT count(*) FROM organizations WHERE suspended_at IS NOT NULL)::int AS companies_suspended,
    (SELECT count(*) FROM users)::int AS users,
    (SELECT count(*) FROM users WHERE created_at > now() - interval '7 days')::int AS users_new_7d,
    (SELECT count(DISTINCT user_id) FROM audit_log WHERE action = 'login' AND created_at > now() - interval '7 days')::int AS users_active_7d,
    (SELECT count(*) FROM chat_messages)::int AS questions,
    (SELECT count(*) FROM chat_messages WHERE created_at > now() - interval '7 days')::int AS questions_7d,
    (SELECT count(*) FROM documents WHERE kind = 'regulation' AND org_id IS NULL AND status = 'ready')::int AS regulations_public,
    (SELECT count(*) FROM documents WHERE kind = 'regulation' AND status = 'failed')::int AS regulations_failed,
    (SELECT count(*) FROM documents WHERE kind = 'regulation' AND org_id IS NOT NULL)::int AS regulations_private,
    (SELECT count(*) FROM documents WHERE kind = 'policy')::int AS policies,
    (SELECT count(*) FROM impact_findings WHERE status = 'open')::int AS findings_open,
    (SELECT count(*) FROM app_errors WHERE resolved_at IS NULL)::int AS errors_open,
    (SELECT count(*) FROM app_errors WHERE last_seen > now() - interval '24 hours')::int AS errors_24h,
    (SELECT count(*) FROM ops_alerts WHERE status = 'firing')::int AS alerts_firing`);
  // Daily counts for the last 30 days (days with nothing still appear, as 0).
  const daily = await query(`
    SELECT to_char(d, 'YYYY-MM-DD') AS day,
      (SELECT count(*) FROM users u WHERE u.created_at >= d AND u.created_at < d + interval '1 day')::int AS signups,
      (SELECT count(*) FROM chat_messages m WHERE m.created_at >= d AND m.created_at < d + interval '1 day')::int AS questions
    FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') AS d
    ORDER BY d`);
  const recentCompanies = await query(`
    SELECT o.id, o.name, o.created_at, (SELECT count(*) FROM users u WHERE u.org_id = o.id)::int AS users
    FROM organizations o ORDER BY o.created_at DESC LIMIT 6`);
  res.json({ totals, daily, recentCompanies });
}));

// ---------------- Companies ----------------
adminRouter.get("/companies", wrap(async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const status = String(req.query.status ?? "all");
  const params: unknown[] = [];
  const where: string[] = [];
  if (q) { params.push(`%${q}%`); where.push(`(o.name ILIKE $${params.length} OR EXISTS (SELECT 1 FROM users x WHERE x.org_id = o.id AND x.email ILIKE $${params.length}))`); }
  if (status === "active") where.push("o.suspended_at IS NULL");
  if (status === "suspended") where.push("o.suspended_at IS NOT NULL");
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (await one(`SELECT count(*)::int AS n FROM organizations o ${w}`, params)).n;
  params.push((page(req) - 1) * PAGE);
  const rows = await query(`
    SELECT o.id, o.name, o.created_at, o.suspended_at,
      (SELECT count(*) FROM users u WHERE u.org_id = o.id)::int AS users,
      (SELECT count(*) FROM chat_messages m WHERE m.org_id = o.id)::int AS questions,
      (SELECT count(*) FROM documents d WHERE d.org_id = o.id AND d.kind = 'policy')::int AS policies,
      (SELECT max(a.created_at) FROM audit_log a WHERE a.org_id = o.id) AS last_active
    FROM organizations o ${w} ORDER BY o.created_at DESC LIMIT ${PAGE} OFFSET $${params.length}`, params);
  res.json({ companies: rows, total, pageSize: PAGE });
}));

adminRouter.get("/companies/:id", wrap(async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ error: "Company not found" });
  const company = await one(`
    SELECT o.id, o.name, o.created_at, o.suspended_at,
      (SELECT count(*) FROM chat_messages m WHERE m.org_id = o.id)::int AS questions,
      (SELECT count(*) FROM documents d WHERE d.org_id = o.id AND d.kind = 'policy')::int AS policies,
      (SELECT count(*) FROM documents d WHERE d.org_id = o.id AND d.kind = 'regulation')::int AS private_regulations,
      (SELECT count(*) FROM impact_findings f WHERE f.org_id = o.id AND f.status = 'open')::int AS open_findings,
      (SELECT array_agg(email) FROM alert_settings s, unnest(s.emails) email WHERE s.org_id = o.id) AS alert_emails
    FROM organizations o WHERE o.id = $1`, [req.params.id]);
  if (!company) return res.status(404).json({ error: "Company not found" });
  const users = await query(`
    SELECT u.id, u.name, u.email, u.role, u.created_at, u.suspended_at,
      (SELECT max(a.created_at) FROM audit_log a WHERE a.user_id = u.id AND a.action = 'login') AS last_login
    FROM users u WHERE u.org_id = $1 ORDER BY u.created_at`, [company.id]);
  const activity = await query(`
    SELECT a.id, a.action, a.created_at, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.org_id = $1 ORDER BY a.created_at DESC LIMIT 25`, [company.id]);
  res.json({ company, users, activity });
}));

adminRouter.patch("/companies/:id", wrap(async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ error: "Company not found" });
  const b = z.object({ suspended: z.boolean().optional(), name: z.string().trim().min(2).max(120).optional() }).parse(req.body);
  const r = await one(`UPDATE organizations SET
      name = COALESCE($2, name),
      suspended_at = CASE WHEN $3::boolean IS NULL THEN suspended_at WHEN $3 THEN COALESCE(suspended_at, now()) ELSE NULL END
    WHERE id = $1 RETURNING id, name, suspended_at`, [req.params.id, b.name ?? null, b.suspended ?? null]);
  if (!r) return res.status(404).json({ error: "Company not found" });
  adminAudit(req, b.suspended === undefined ? "company_update" : b.suspended ? "company_suspend" : "company_unsuspend", { companyId: r.id, name: r.name });
  res.json({ company: r });
}));

// ---------------- Users ----------------
adminRouter.get("/users", wrap(async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const role = String(req.query.role ?? "");
  const status = String(req.query.status ?? "all");
  const params: unknown[] = [];
  const where: string[] = [];
  if (q) { params.push(`%${q}%`); where.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR o.name ILIKE $${params.length})`); }
  if (role === "admin" || role === "member") { params.push(role); where.push(`u.role = $${params.length}`); }
  if (status === "active") where.push("u.suspended_at IS NULL AND o.suspended_at IS NULL");
  if (status === "suspended") where.push("(u.suspended_at IS NOT NULL OR o.suspended_at IS NOT NULL)");
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (await one(`SELECT count(*)::int AS n FROM users u JOIN organizations o ON o.id = u.org_id ${w}`, params)).n;
  params.push((page(req) - 1) * PAGE);
  const rows = await query(`
    SELECT u.id, u.name, u.email, u.role, u.created_at, u.suspended_at, o.id AS org_id, o.name AS org_name,
      o.suspended_at AS org_suspended_at,
      (SELECT max(a.created_at) FROM audit_log a WHERE a.user_id = u.id AND a.action = 'login') AS last_login,
      (SELECT count(*) FROM chat_messages m WHERE m.user_id = u.id)::int AS questions
    FROM users u JOIN organizations o ON o.id = u.org_id ${w}
    ORDER BY u.created_at DESC LIMIT ${PAGE} OFFSET $${params.length}`, params);
  res.json({ users: rows, total, pageSize: PAGE });
}));

const ownUser = async (id: string) =>
  uuid.safeParse(id).success ? one("SELECT id, org_id, name, email, role, suspended_at FROM users WHERE id = $1", [id]) : null;

adminRouter.patch("/users/:id", wrap(async (req, res) => {
  const b = z.object({ role: z.enum(["admin", "member"]).optional(), suspended: z.boolean().optional() }).parse(req.body);
  const u = await ownUser(req.params.id);
  if (!u) return res.status(404).json({ error: "User not found" });
  // A company must always keep at least one active admin.
  if ((b.role === "member" || b.suspended) && u.role === "admin") {
    const others = await one("SELECT count(*)::int AS n FROM users WHERE org_id = $1 AND role = 'admin' AND suspended_at IS NULL AND id <> $2", [u.org_id, u.id]);
    if (others.n === 0) return res.status(400).json({ error: "This is the company's only admin. Make someone else an admin first." });
  }
  const r = await one(`UPDATE users SET
      role = COALESCE($2, role),
      suspended_at = CASE WHEN $3::boolean IS NULL THEN suspended_at WHEN $3 THEN COALESCE(suspended_at, now()) ELSE NULL END,
      token_version = token_version + CASE WHEN $3::boolean IS TRUE OR $2 IS NOT NULL THEN 1 ELSE 0 END
    WHERE id = $1 RETURNING id, name, email, role, suspended_at`, [u.id, b.role ?? null, b.suspended ?? null]);
  adminAudit(req, b.suspended === true ? "user_suspend" : b.suspended === false ? "user_unsuspend" : "user_role_change",
    { userId: u.id, email: u.email, ...(b.role ? { role: b.role } : {}) });
  res.json({ user: r });
}));

adminRouter.post("/users/:id/reset-password", wrap(async (req, res) => {
  const u = await ownUser(req.params.id);
  if (!u) return res.status(404).json({ error: "User not found" });
  if (!emailEnabled()) return res.status(400).json({ error: "Email isn't set up (Brevo or SMTP), so a reset code can't be sent." });
  await issueResetCode(u);
  adminAudit(req, "user_reset_sent", { userId: u.id, email: u.email });
  res.json({ ok: true, message: `A reset code was emailed to ${u.email}. It expires in 5 minutes.` });
}));

adminRouter.post("/users/:id/sign-out", wrap(async (req, res) => {
  const u = await ownUser(req.params.id);
  if (!u) return res.status(404).json({ error: "User not found" });
  await query("UPDATE users SET token_version = token_version + 1 WHERE id = $1", [u.id]);
  adminAudit(req, "user_signed_out", { userId: u.id, email: u.email });
  res.json({ ok: true });
}));

// ---------------- Regulations & sync ----------------
adminRouter.get("/regulations", wrap(async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const status = String(req.query.status ?? "all");
  const scope = String(req.query.scope ?? "all");
  const params: unknown[] = [];
  const where = ["d.kind = 'regulation'"];
  if (q) { params.push(`%${q}%`); where.push(`(d.title ILIKE $${params.length} OR d.ref_no ILIKE $${params.length})`); }
  if (status === "ready" || status === "failed") { params.push(status); where.push(`d.status = $${params.length}`); }
  if (scope === "public") where.push("d.org_id IS NULL");
  if (scope === "private") where.push("d.org_id IS NOT NULL");
  const w = `WHERE ${where.join(" AND ")}`;
  const total = (await one(`SELECT count(*)::int AS n FROM documents d ${w}`, params)).n;
  params.push((page(req) - 1) * PAGE);
  const rows = await query(`
    SELECT d.id, d.title, d.regulator, d.ref_no, d.url, d.published_at, d.ingested_at, d.status, d.error, d.page_count,
      d.source_id, d.org_id, o.name AS org_name, (SELECT count(*) FROM chunks c WHERE c.document_id = d.id)::int AS chunks
    FROM documents d LEFT JOIN organizations o ON o.id = d.org_id ${w}
    ORDER BY d.published_at DESC NULLS LAST, d.ingested_at DESC LIMIT ${PAGE} OFFSET $${params.length}`, params);
  const counts = await one(`SELECT
    count(*) FILTER (WHERE status = 'ready')::int AS ready, count(*) FILTER (WHERE status = 'failed')::int AS failed,
    count(*) FILTER (WHERE org_id IS NULL)::int AS public, count(*) FILTER (WHERE org_id IS NOT NULL)::int AS private
    FROM documents WHERE kind = 'regulation'`);
  res.json({ regulations: rows, total, pageSize: PAGE, counts });
}));

// Attach the real PDF to a circular whose automatic download failed (e.g. the regulator's site
// blocked it). The text is indexed for every company, keeping the circular's details and link.
adminRouter.post("/regulations/:id/attach", upload.single("file"), wrap(async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ error: "Regulation not found" });
  if (!req.file) return res.status(400).json({ error: "Choose the PDF (or DOCX/TXT) file to attach" });
  const doc = await one("SELECT id, title, org_id FROM documents WHERE id = $1 AND kind = 'regulation'", [req.params.id]);
  if (!doc) return res.status(404).json({ error: "Regulation not found" });
  if (doc.org_id) return res.status(400).json({ error: "This is a company's private upload; only regulator feed circulars can be fixed here." });
  const form = new FormData();
  form.append("document_id", doc.id);
  form.append("file", new Blob([Uint8Array.from(req.file.buffer)]), req.file.originalname);
  await ai.attach(form);
  adminAudit(req, "regulation_attach", { regulationId: doc.id, title: doc.title, filename: req.file.originalname });
  res.json({ ok: true });
}));

// Add a circular for every company (manual uploads by a company stay private to that company).
adminRouter.post("/regulations/upload", upload.single("file"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a file to upload" });
  const form = new FormData();
  form.append("org_id", "");
  form.append("kind", "regulation");
  for (const k of ["title", "regulator", "ref_no", "published_at"]) {
    const v = String(req.body?.[k] ?? "").trim();
    if (v) form.append(k, v);
  }
  form.append("file", new Blob([Uint8Array.from(req.file.buffer)]), req.file.originalname);
  const { document_id } = await ai.upload(form);
  adminAudit(req, "regulation_publish", { regulationId: document_id, filename: req.file.originalname });
  res.status(201).json({ document_id });
}));

adminRouter.delete("/regulations/:id", wrap(async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ error: "Regulation not found" });
  const r = await one("DELETE FROM documents WHERE id = $1 AND kind = 'regulation' RETURNING title", [req.params.id]);
  if (!r) return res.status(404).json({ error: "Regulation not found" });
  adminAudit(req, "regulation_delete", { regulationId: req.params.id, title: r.title });
  res.status(204).end();
}));

adminRouter.post("/sync", wrap(async (req, res) => {
  adminAudit(req, "manual_sync");
  res.json(await runMonitoringCycle({ limit: 25 }));
}));

adminRouter.get("/ingest-runs", wrap(async (_req, res) => {
  res.json({ runs: await query(
    "SELECT id, source_id, started_at, finished_at, new_docs, error FROM ingest_runs ORDER BY id DESC LIMIT 20") });
}));

// ---------------- System health ----------------
adminRouter.get("/health", wrap(async (_req, res) => {
  const t0 = Date.now();
  const db = await one(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size, version() AS version`).catch(() => null);
  const dbMs = Date.now() - t0;
  const t1 = Date.now();
  const aiHealth = await ai.health().catch(() => null);
  const aiMs = Date.now() - t1;
  const [smtp, migrations, lastRun] = await Promise.all([
    checkSmtp(),
    query("SELECT name, applied_at FROM schema_migrations ORDER BY name"),
    one("SELECT source_id, started_at, finished_at, new_docs, error FROM ingest_runs ORDER BY id DESC LIMIT 1"),
  ]);
  const errors24h = await one(
    "SELECT count(*)::int AS n FROM admin_audit WHERE action IN ('admin_login_failed','admin_2fa_failed') AND created_at > now() - interval '24 hours'");
  res.json({
    api: { ok: true, uptimeSeconds: Math.round(process.uptime()), node: process.version, memoryMb: Math.round(process.memoryUsage().rss / 1048576), environment: config.isProd ? "production" : "development", appUrl: config.appUrl },
    database: { ok: !!db, ms: dbMs, size: db?.size, version: db?.version?.split(" ").slice(0, 2).join(" "), pool: { total: pool.totalCount, idle: pool.idleCount } },
    ai: { ok: !!aiHealth?.ok, ms: aiMs, ...aiHealth },
    email: { ...smtp, host: smtp.via === "brevo" ? "Brevo (HTTPS API)" : config.smtp.host || null, from: config.smtp.from },
    recaptcha: { enabled: !!config.recaptcha.secretKey, testKeys: config.recaptcha.siteKey === GOOGLE_TEST_SITE_KEY },
    sync: { lastRun, scheduledEveryMinutes: config.cronIntervalMinutes || null },
    security: { failedAdminSignIns24h: errors24h.n },
    migrations,
  });
}));

// ---------------- Errors (built-in error tracking) ----------------
adminRouter.get("/errors", wrap(async (req, res) => {
  const status = req.query.status === "resolved" ? "resolved" : "open";
  const source = ["api", "web", "ai"].includes(String(req.query.source)) ? String(req.query.source) : null;
  const rows = await query(
    `SELECT id, source, message, stack, path, count, first_seen, last_seen, last_context, resolved_at FROM app_errors
     WHERE ${status === "open" ? "resolved_at IS NULL" : "resolved_at IS NOT NULL"} AND ($1::text IS NULL OR source = $1)
     ORDER BY last_seen DESC LIMIT 100`, [source]);
  const counts = await one(`SELECT count(*) FILTER (WHERE resolved_at IS NULL)::int AS open,
    count(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolved FROM app_errors`);
  res.json({ errors: rows, counts });
}));

adminRouter.patch("/errors/:id", wrap(async (req, res) => {
  const b = z.object({ resolved: z.boolean() }).parse(req.body);
  if (!/^\d{1,18}$/.test(req.params.id)) return res.status(404).json({ error: "Error not found" });
  const r = await one(`UPDATE app_errors SET resolved_at = ${b.resolved ? "now()" : "NULL"} WHERE id = $1 RETURNING id, message`, [req.params.id]);
  if (!r) return res.status(404).json({ error: "Error not found" });
  adminAudit(req, b.resolved ? "error_resolve" : "error_reopen", { errorId: r.id, message: r.message.slice(0, 120) });
  res.json({ ok: true });
}));

// ---------------- Alerts ----------------
adminRouter.get("/alerts", wrap(async (_req, res) => {
  res.json({
    alerts: await query(`SELECT key, status, severity, title, detail, first_fired, last_notified, resolved_at, fire_count
      FROM ops_alerts ORDER BY (status = 'firing') DESC, coalesce(resolved_at, first_fired) DESC LIMIT 30`),
    monitorEveryMinutes: config.opsMonitorMinutes,
    recipients: config.opsAlertEmails.length ? config.opsAlertEmails
      : (await query<{ email: string }>("SELECT email FROM platform_admins WHERE disabled_at IS NULL")).map((r) => r.email),
  });
}));

adminRouter.post("/alerts/check", wrap(async (req, res) => {
  adminAudit(req, "alerts_check");
  res.json(await runAlertMonitor());
}));

adminRouter.post("/alerts/test", wrap(async (req, res) => {
  if (!emailEnabled()) return res.status(400).json({ error: "Email isn't set up (Brevo or SMTP), so alerts can't be emailed." });
  const to = await sendTestAlert();
  adminAudit(req, "alerts_test", { to });
  res.json({ ok: true, message: `Test alert sent to ${to.join(", ")}.` });
}));

// ---------------- Activity & audit ----------------
function auditFilters(req: Request) {
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  if (uuid.safeParse(req.query.company).success) add("a.org_id = ?", req.query.company);
  if (String(req.query.action ?? "")) add("a.action = ?", String(req.query.action));
  if (String(req.query.q ?? "").trim()) {
    params.push(`%${String(req.query.q).trim()}%`);
    where.push(`(u.email ILIKE $${params.length} OR u.name ILIKE $${params.length} OR o.name ILIKE $${params.length})`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from ?? ""))) add("a.created_at >= ?::date", req.query.from);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to ?? ""))) add("a.created_at < ?::date + 1", req.query.to);
  return { params, where: where.length ? `WHERE ${where.join(" AND ")}` : "" };
}
const AUDIT_FROM = "FROM audit_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN organizations o ON o.id = a.org_id";

adminRouter.get("/audit", wrap(async (req, res) => {
  const { params, where } = auditFilters(req);
  const total = (await one(`SELECT count(*)::int AS n ${AUDIT_FROM} ${where}`, params)).n;
  params.push((page(req) - 1) * 50);
  const rows = await query(`
    SELECT a.id, a.action, a.details, a.created_at, u.name AS user_name, u.email AS user_email, o.id AS org_id, o.name AS org_name
    ${AUDIT_FROM} ${where} ORDER BY a.created_at DESC LIMIT 50 OFFSET $${params.length}`, params);
  const actions = await query("SELECT DISTINCT action FROM audit_log ORDER BY action");
  res.json({ events: rows, total, pageSize: 50, actions: actions.map((r: any) => r.action) });
}));

const csvCell = (v: unknown) => {
  const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  // Quote everything; a leading =,+,-,@ is prefixed so spreadsheets don't run it as a formula.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

adminRouter.get("/audit.csv", wrap(async (req, res) => {
  const { params, where } = auditFilters(req);
  const rows = await query(`
    SELECT a.created_at, o.name AS company, u.name AS user_name, u.email AS user_email, a.action, a.details
    ${AUDIT_FROM} ${where} ORDER BY a.created_at DESC LIMIT 50000`, params);
  adminAudit(req, "audit_export", { rows: rows.length });
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="regradar-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(["time,company,user,email,action,details",
    ...rows.map((r: any) => [new Date(r.created_at).toISOString(), r.company, r.user_name, r.user_email, r.action, r.details].map(csvCell).join(","))].join("\n"));
}));

adminRouter.get("/admin-audit", wrap(async (req, res) => {
  res.json({ events: await query(`
    SELECT x.id, x.action, x.details, x.ip, x.created_at, p.name AS admin_name, p.email AS admin_email
    FROM admin_audit x LEFT JOIN platform_admins p ON p.id = x.admin_id
    ORDER BY x.created_at DESC LIMIT ${50} OFFSET $1`, [(page(req) - 1) * 50]) });
}));
