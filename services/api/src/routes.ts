/**
 * All /api endpoints used by the web app.
 *
 * Rule of thumb for this file: every query that reads or changes company data
 * filters by req.user.orgId, so one organisation can never see another's
 * policies, findings, questions or audit log. Inputs are validated with zod.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { z } from "zod";
import { ai, AiError } from "./ai.js";
import { audit } from "./audit.js";
import {
  hashPassword, passwordProblem, requireAdmin, requireAuth, SESSION_EXPIRED, signToken, SUSPENDED, verifyPassword, type AuthUser,
} from "./auth.js";
import { captchaProblem } from "./captcha.js";
import { recordError } from "./errors.js";
import { inviteEmail } from "./emails.js";
import { config } from "./config.js";
import { one, query, tx } from "./db.js";
import { runMonitoringCycle } from "./jobs.js";
import { logger } from "./logger.js";
import { sendMail } from "./mailer.js";
import {
  codeMatches, FORGOT_MESSAGE, hashInviteToken, INVITE_DAYS, issueResetCode, MAX_ATTEMPTS, newInviteToken,
  NO_ACCOUNT, RESEND_SECONDS, resetEmail,
} from "./passwordReset.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const TOO_MANY = { error: "Too many attempts. Please wait 15 minutes and try again." };
// Per connection (IP): 20 sign-in / sign-up attempts, and 10 password-reset requests, every 15 minutes.
// Automated tests (NODE_ENV=test) make many requests from one address, so limits are off there.
const skip = () => config.isTest;
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: config.authRateLimit, standardHeaders: true, legacyHeaders: false, message: TOO_MANY, skip });
const resetLimiter = rateLimit({ windowMs: 15 * 60_000, limit: config.resetRateLimit, standardHeaders: true, legacyHeaders: false, message: TOO_MANY, skip });
const askLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: "You're asking questions very quickly. Please wait a minute." },
  keyGenerator: (req) => req.user?.id ?? req.ip ?? "anon", skip: () => config.isTest });

export const router = Router();

// ---------------- Auth ----------------
const Email = z.string().trim().toLowerCase().email("Enter a valid email address");

// Public settings the sign-in pages need before anyone is signed in.
router.get("/auth/config", (_req, res) => {
  res.json({ recaptchaSiteKey: config.recaptcha.secretKey ? config.recaptcha.siteKey || null : null });
});

const RegisterIn = z.object({
  orgName: z.string().trim().min(2, "Enter your company name").max(120),
  name: z.string().trim().min(2, "Enter your name").max(120),
  email: Email,
  password: z.string().max(200),
  confirmPassword: z.string().max(200).optional(),   // the web form always sends it; API clients may omit it
  captcha: z.string().max(4000).optional(),
});

// Sign up: creates the company and its first user (an admin). The web app then sends the user
// to the sign-in page; API clients can use the returned token directly.
router.post("/auth/register", authLimiter, wrap(async (req, res) => {
  const b = RegisterIn.parse(req.body);
  const problem = passwordProblem(b.password);
  if (problem) return res.status(400).json({ error: problem });
  if (b.confirmPassword !== undefined && b.confirmPassword !== b.password) return res.status(400).json({ error: "The two passwords don't match" });
  const robot = await captchaProblem(b.captcha, req.ip);
  if (robot) return res.status(400).json({ error: robot, code: "captcha" });
  if (await one("SELECT 1 FROM users WHERE email = $1", [b.email])) {
    return res.status(409).json({ error: "An account with this email already exists. Sign in instead?", code: "email_taken" });
  }
  const hash = await hashPassword(b.password);
  const user = await tx(async (c) => {
    const org = (await c.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [b.orgName])).rows[0];
    const u = (await c.query(
      `INSERT INTO users (org_id, email, name, password_hash, role) VALUES ($1,$2,$3,$4,'admin')
       RETURNING id, org_id, email, name, role`, [org.id, b.email, b.name, hash])).rows[0];
    await c.query("INSERT INTO alert_settings (org_id, emails) VALUES ($1, $2)", [org.id, [b.email]]);
    return u;
  });
  const authUser: AuthUser = { id: user.id, orgId: user.org_id, email: user.email, name: user.name, role: user.role };
  req.user = authUser;
  audit(req, "register", { org: b.orgName });
  res.status(201).json({ token: signToken(authUser), user: { ...authUser, orgName: b.orgName } });
}));

const LoginIn = z.object({
  email: Email, password: z.string().max(200), captcha: z.string().max(4000).optional(),
  remember: z.boolean().optional(),   // "Remember me": a 30-day session instead of 12 hours
});

router.post("/auth/login", authLimiter, wrap(async (req, res) => {
  const b = LoginIn.parse(req.body);
  const robot = await captchaProblem(b.captcha, req.ip);
  if (robot) return res.status(400).json({ error: robot, code: "captcha" });
  const u = await one(
    `SELECT u.id, u.org_id, u.email, u.name, u.role, u.password_hash, u.token_version, o.name AS org_name,
            (u.suspended_at IS NOT NULL OR o.suspended_at IS NOT NULL) AS suspended
     FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.email = $1`, [b.email]);
  // Unknown email and wrong password get different messages, so people know whether to sign up.
  if (!u) return res.status(401).json({ error: NO_ACCOUNT, code: "no_account" });
  if (!(await verifyPassword(b.password, u.password_hash))) {
    return res.status(401).json({ error: "Incorrect password", code: "bad_credentials" });
  }
  if (u.suspended) return res.status(403).json({ error: SUSPENDED, code: "suspended" });
  const authUser: AuthUser = { id: u.id, orgId: u.org_id, email: u.email, name: u.name, role: u.role };
  req.user = authUser;
  audit(req, "login", { remember: !!b.remember });
  res.json({ token: signToken(authUser, u.token_version, !!b.remember), user: { ...authUser, orgName: u.org_name } });
}));

const ForgotIn = z.object({ email: Email, captcha: z.string().max(4000).optional() });

// Step 1 of a reset. An unknown email is told to sign up instead (no code is sent).
// One email per account per minute at most; the per-connection limit slows down guessing.
router.post("/auth/forgot", resetLimiter, wrap(async (req, res) => {
  const b = ForgotIn.parse(req.body);
  const robot = await captchaProblem(b.captcha, req.ip);
  if (robot) return res.status(400).json({ error: robot, code: "captcha" });
  const u = await one("SELECT id, org_id, name, email, role FROM users WHERE email = $1", [b.email]);
  if (!u) return res.status(404).json({ error: NO_ACCOUNT, code: "no_account" });
  const recent = await one(
    "SELECT 1 FROM password_resets WHERE user_id = $1 AND created_at > now() - make_interval(secs => $2)", [u.id, RESEND_SECONDS]);
  if (!recent) {
    // Not awaited, so the page doesn't wait on the mail server; failures are logged.
    issueResetCode(u).catch((e) => logger.error({ err: e.message }, "password reset email failed"));
    req.user = { id: u.id, orgId: u.org_id, email: u.email, name: u.name, role: u.role };
    audit(req, "password_reset_requested");
  }
  res.json({ message: FORGOT_MESSAGE, resendAfterSeconds: RESEND_SECONDS });
}));

const ResetIn = z.object({
  email: Email,
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from the email"),
  password: z.string().max(200),
  confirmPassword: z.string().max(200),
});

// Step 2: check the code and set the new password. Wrong codes count towards a limit of 5.
router.post("/auth/reset", resetLimiter, wrap(async (req, res) => {
  const b = ResetIn.parse(req.body);
  const problem = passwordProblem(b.password);
  if (problem) return res.status(400).json({ error: problem, code: "weak_password" });
  if (b.password !== b.confirmPassword) return res.status(400).json({ error: "The two new passwords don't match", code: "mismatch" });

  const u = await one("SELECT id, org_id, name, email, role FROM users WHERE email = $1", [b.email]);
  const r = u && await one(
    `SELECT id, code_hash, attempts, expires_at < now() AS expired FROM password_resets
     WHERE user_id = $1 AND used_at IS NULL AND invalidated_at IS NULL ORDER BY id DESC LIMIT 1`, [u.id]);
  if (!u) return res.status(404).json({ error: NO_ACCOUNT, code: "no_account" });
  if (!r) return res.status(400).json({ error: "That code isn't valid. Request a new code.", code: "no_code" });
  if (r.expired) return res.status(400).json({ error: "That code has expired. Request a new code.", code: "expired" });
  if (r.attempts >= MAX_ATTEMPTS) {
    return res.status(400).json({ error: "That code is locked after too many wrong tries. Request a new code.", code: "locked" });
  }

  if (!codeMatches(b.code, r.code_hash)) {
    const { attempts } = await one("UPDATE password_resets SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts", [r.id]);
    const left = MAX_ATTEMPTS - attempts;
    return res.status(400).json(left > 0
      ? { error: `That code is wrong. ${left} ${left === 1 ? "attempt" : "attempts"} left.`, code: "wrong_code", attemptsLeft: left }
      : { error: "That code is wrong, and it's now locked. Request a new code.", code: "locked", attemptsLeft: 0 });
  }

  const hash = await hashPassword(b.password);
  await tx(async (c) => {
    // Bumping token_version signs the account out everywhere else.
    await c.query("UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1", [u.id, hash]);
    await c.query("UPDATE password_resets SET used_at = now() WHERE id = $1", [r.id]);
  });
  req.user = { id: u.id, orgId: u.org_id, email: u.email, name: u.name, role: u.role };
  audit(req, "password_reset");
  res.json({ ok: true });
}));

// ---------------- Browser error reports (public: crashes can happen before sign-in) ----------------
const clientErrorLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, skip });
const ClientErrorIn = z.object({
  message: z.string().max(2000),
  stack: z.string().max(8000).optional(),
  url: z.string().max(500).optional(),
  component: z.string().max(2000).optional(),
});

router.post("/client-errors", clientErrorLimiter, (req, res) => {
  const b = ClientErrorIn.safeParse(req.body);
  if (b.success && b.data.message.trim()) {
    let path = "";
    try { path = new URL(b.data.url ?? "", "http://x").pathname; } catch { /* keep empty */ }
    recordError({ source: "web", message: b.data.message, stack: [b.data.stack, b.data.component].filter(Boolean).join("\n\nReact components:\n") || null,
      path, context: { userAgent: String(req.headers["user-agent"] ?? "").slice(0, 200) } });
  }
  res.status(204).end();
});

// ---------------- Accepting a team invite (public: the invitee has no account yet) ----------------
/** The invite behind a link token, or the reason it can't be used (status + message for the person). */
async function inviteFromToken(token: string) {
  const inv = await one(
    `SELECT i.id, i.org_id, i.email, i.role, i.accepted_at, i.revoked_at, i.expires_at < now() AS expired,
            o.name AS org_name, u.name AS inviter_name
     FROM invites i JOIN organizations o ON o.id = i.org_id LEFT JOIN users u ON u.id = i.invited_by
     WHERE i.token_hash = $1`, [hashInviteToken(token)]);
  if (!inv) return { error: [404, "This invite link isn't valid. Check you copied the whole link, or ask your admin for a new one.", "invalid"] as const };
  if (inv.revoked_at) return { error: [410, "This invite was cancelled. Ask your admin to send a new one.", "revoked"] as const };
  if (inv.accepted_at) return { error: [410, "This invite has already been used. Sign in with the email it was sent to.", "used"] as const };
  if (inv.expired) return { error: [410, "This invite has expired. Ask your admin to send a new one.", "expired"] as const };
  if (await one("SELECT 1 FROM users WHERE email = $1", [inv.email])) {
    return { error: [409, "This email already has a RegRadar account. Sign in instead.", "account_exists"] as const };
  }
  return { inv };
}

router.get("/auth/invites/:token", authLimiter, wrap(async (req, res) => {
  const r = await inviteFromToken(req.params.token);
  if (r.error) return res.status(r.error[0]).json({ error: r.error[1], code: r.error[2] });
  const i = r.inv;
  res.json({ email: i.email, role: i.role, orgName: i.org_name, inviterName: i.inviter_name ?? "Your admin" });
}));

const AcceptIn = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120),
  password: z.string().max(200),
  confirmPassword: z.string().max(200),
});

router.post("/auth/invites/:token/accept", authLimiter, wrap(async (req, res) => {
  const b = AcceptIn.parse(req.body);
  const problem = passwordProblem(b.password);
  if (problem) return res.status(400).json({ error: problem });
  if (b.password !== b.confirmPassword) return res.status(400).json({ error: "The two passwords don't match" });
  const r = await inviteFromToken(req.params.token);
  if (r.error) return res.status(r.error[0]).json({ error: r.error[1], code: r.error[2] });
  const i = r.inv;
  const hash = await hashPassword(b.password);
  const user = await tx(async (c) => {
    // Marking the invite first (only if still unused) stops a double-click creating two accounts.
    const claimed = await c.query("UPDATE invites SET accepted_at = now() WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL", [i.id]);
    if (!claimed.rowCount) return null;
    return (await c.query(
      `INSERT INTO users (org_id, email, name, password_hash, role) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, org_id, email, name, role`, [i.org_id, i.email, b.name, hash, i.role])).rows[0];
  });
  if (!user) return res.status(410).json({ error: "This invite has already been used. Sign in with the email it was sent to.", code: "used" });
  req.user = { id: user.id, orgId: user.org_id, email: user.email, name: user.name, role: user.role };
  audit(req, "invite_accepted", { inviteId: i.id, role: i.role });
  res.status(201).json({ email: user.email });
}));

// Everything below requires a signed-in user.
router.use(requireAuth);

// The signed-in user, read fresh from the database so profile edits show up straight away.
const ME_SQL = `SELECT u.id, u.org_id, u.email, u.name, u.role, u.created_at, u.token_version, o.name AS org_name
                FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.id = $1`;
const meJson = (r: any) => ({ id: r.id, orgId: r.org_id, email: r.email, name: r.name, role: r.role, orgName: r.org_name, createdAt: r.created_at });

router.get("/me", wrap(async (req, res) => {
  const r = await one(ME_SQL, [req.user!.id]);
  if (!r) return res.status(401).json({ error: SESSION_EXPIRED });
  res.json({ user: meJson(r) });
}));

const ProfileIn = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
});

// Update your own name and email. The sign-in token carries both, so a fresh token is returned.
router.patch("/me", wrap(async (req, res) => {
  const b = ProfileIn.parse(req.body);
  if (await one("SELECT 1 FROM users WHERE email = $1 AND id <> $2", [b.email, req.user!.id])) {
    return res.status(409).json({ error: "Another account already uses this email" });
  }
  await query("UPDATE users SET name = $2, email = $3 WHERE id = $1", [req.user!.id, b.name, b.email]);
  const r = await one(ME_SQL, [req.user!.id]);
  audit(req, "profile_update", { emailChanged: b.email !== req.user!.email });
  const authUser: AuthUser = { id: r.id, orgId: r.org_id, email: r.email, name: r.name, role: r.role };
  res.json({ token: signToken(authUser, r.token_version, req.remember), user: meJson(r) });
}));

const PasswordIn = z.object({ current: z.string().max(200), next: z.string().max(200) });

router.post("/me/password", authLimiter, wrap(async (req, res) => {
  const b = PasswordIn.parse(req.body);
  const u = await one("SELECT password_hash FROM users WHERE id = $1", [req.user!.id]);
  if (!u || !(await verifyPassword(b.current, u.password_hash))) return res.status(400).json({ error: "Your current password is incorrect" });
  const problem = passwordProblem(b.next);
  if (problem) return res.status(400).json({ error: problem });
  if (b.next === b.current) return res.status(400).json({ error: "Choose a password you haven't used here" });
  // Other devices are signed out; this browser gets a fresh token so it stays signed in.
  const { token_version } = await one(
    "UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1 RETURNING token_version",
    [req.user!.id, await hashPassword(b.next)]);
  audit(req, "password_change");
  res.json({ token: signToken(req.user!, token_version, req.remember) });
}));

// Admins can rename the organisation (shown in the sidebar and on alert emails).
router.patch("/organization", requireAdmin, wrap(async (req, res) => {
  const b = z.object({ name: z.string().trim().min(2).max(120) }).parse(req.body);
  await query("UPDATE organizations SET name = $2 WHERE id = $1", [req.user!.orgId, b.name]);
  audit(req, "organization_update", { name: b.name });
  res.json({ name: b.name });
}));

router.get("/status", wrap(async (_req, res) => {
  const health = await ai.health().catch(() => null);
  const last = await one(
    "SELECT source_id, started_at, finished_at, new_docs, error FROM ingest_runs ORDER BY id DESC LIMIT 1");
  res.json({ ai: health, lastIngest: last });
}));

router.get("/stats", wrap(async (req, res) => {
  const org = req.user!.orgId;
  const s = await one(
    `SELECT
       (SELECT count(*) FROM documents WHERE kind='regulation' AND status='ready'
          AND (org_id IS NULL OR org_id = $1))::int AS regulations,
       (SELECT count(*) FROM documents WHERE kind='regulation' AND status='ready'
          AND (org_id IS NULL OR org_id = $1) AND published_at >= current_date - 30)::int AS regulations_30d,
       (SELECT count(*) FROM documents WHERE org_id = $1 AND kind='policy')::int AS policies,
       (SELECT count(*) FROM impact_findings WHERE org_id = $1 AND status='open')::int AS open_findings,
       (SELECT count(*) FROM impact_findings WHERE org_id = $1 AND status='open' AND severity='high')::int AS high_findings,
       (SELECT count(*) FROM chat_messages WHERE org_id = $1)::int AS questions`, [org]);
  res.json(s);
}));

// ---------------- Ask ----------------
// Questions can be long (whole clauses pasted in); the limit only guards against abuse.
const MAX_QUESTION = 20_000;
// How many earlier turns of a conversation Remi reads when answering. Every turn is still stored.
const MEMORY_TURNS = 10;

const AskIn = z.object({
  question: z.string().trim().min(3).max(MAX_QUESTION),
  scope: z.enum(["all", "regulations", "policies"]).default("all"),
  regulators: z.array(z.string().max(20)).max(10).optional(),
  conversation_id: z.union([z.string(), z.number()]).transform(String).pipe(z.string().regex(/^\d{1,18}$/)).optional(),
});

const conversationTitle = (q: string) => {
  const t = q.replace(/\s+/g, " ").trim();
  return t.length > 80 ? t.slice(0, 77) + "…" : t;
};

// Ask a question, optionally continuing one of the caller's conversations. The AI service retrieves
// passages for THIS organisation only and sees the conversation's recent turns, so follow-ups like
// "and for Tier 2?" keep their context. The answer is stored for history and the audit trail.
router.post("/ask", askLimiter, wrap(async (req, res) => {
  const { conversation_id, ...b } = AskIn.parse(req.body);
  const u = req.user!;
  let convoId: string | null = null;
  if (conversation_id) {
    const c = await ownConversation(req, conversation_id);
    if (!c) return res.status(404).json({ error: "Conversation not found" });
    convoId = String(c.id);
  }
  const history = convoId
    ? (await query(`SELECT question, answer FROM chat_messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT ${MEMORY_TURNS}`, [convoId])).reverse()
    : [];
  const out = await ai.answer({ org_id: u.orgId, ...b, history });
  // The conversation is created only once an answer exists, so failed questions leave no empty threads.
  const saved = await tx(async (c) => {
    // Continuing an archived conversation brings it back to the sidebar.
    if (convoId) await c.query("UPDATE conversations SET updated_at = now(), archived_at = NULL WHERE id = $1", [convoId]);
    else convoId = String((await c.query(
      "INSERT INTO conversations (org_id, user_id, title) VALUES ($1,$2,$3) RETURNING id", [u.orgId, u.id, conversationTitle(b.question)])).rows[0].id);
    return (await c.query(
      `INSERT INTO chat_messages (org_id, user_id, conversation_id, question, answer, citations, mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
      [u.orgId, u.id, convoId, b.question, out.answer, JSON.stringify(out.citations), out.mode])).rows[0];
  });
  audit(req, "ask", { messageId: saved.id, conversationId: convoId, citations: out.citations.length, mode: out.mode });
  res.json({ id: saved.id, created_at: saved.created_at, conversation_id: convoId, question: b.question, ...out });
}));

router.get("/ask/history", wrap(async (req, res) => {
  const rows = await query(
    `SELECT m.id, m.conversation_id, m.question, m.answer, m.citations, m.mode, m.created_at, u.name AS asked_by
     FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1 ORDER BY m.created_at DESC LIMIT 50`, [req.user!.orgId]);
  res.json({ messages: rows });
}));

/** One of the caller's own, not-deleted conversations, or null. */
async function ownConversation(req: Request, id: string) {
  if (!/^\d{1,18}$/.test(id)) return null;
  return one(
    `SELECT id, title, created_at, updated_at, pinned_at, archived_at FROM conversations
     WHERE id = $1 AND org_id = $2 AND user_id = $3 AND deleted_at IS NULL`, [id, req.user!.orgId, req.user!.id]);
}

// The caller's own conversations: pinned first, then most recently active. No cap: every conversation
// is kept. ?archived=1 lists the archived ones instead.
router.get("/conversations", wrap(async (req, res) => {
  const archived = req.query.archived === "1";
  const rows = await query(
    `SELECT c.id, c.title, c.created_at, c.updated_at, c.pinned_at, c.archived_at, count(m.id)::int AS message_count
     FROM conversations c LEFT JOIN chat_messages m ON m.conversation_id = c.id
     WHERE c.org_id = $1 AND c.user_id = $2 AND c.deleted_at IS NULL AND (c.archived_at IS NOT NULL) = $3
     GROUP BY c.id ORDER BY c.pinned_at DESC NULLS LAST, c.updated_at DESC, c.id DESC`,
    [req.user!.orgId, req.user!.id, archived]);
  res.json({ conversations: rows });
}));

// One conversation with every message in it, oldest first.
router.get("/conversations/:id", wrap(async (req, res) => {
  const convo = await ownConversation(req, req.params.id);
  if (!convo) return res.status(404).json({ error: "Conversation not found" });
  const messages = await query(
    `SELECT id, conversation_id, question, answer, citations, mode, created_at FROM chat_messages
     WHERE conversation_id = $1 ORDER BY id`, [convo.id]);
  res.json({ conversation: convo, messages });
}));

const ConversationPatch = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
});

// Rename, pin/unpin, archive/unarchive (the conversation menu in the sidebar).
router.patch("/conversations/:id", wrap(async (req, res) => {
  const b = ConversationPatch.parse(req.body);
  const convo = await ownConversation(req, req.params.id);
  if (!convo) return res.status(404).json({ error: "Conversation not found" });
  const updated = await one(
    `UPDATE conversations SET
       title       = COALESCE($2, title),
       pinned_at   = CASE WHEN $3::boolean IS NULL THEN pinned_at   WHEN $3 THEN COALESCE(pinned_at, now())   ELSE NULL END,
       archived_at = CASE WHEN $4::boolean IS NULL THEN archived_at WHEN $4 THEN COALESCE(archived_at, now()) ELSE NULL END
     WHERE id = $1 RETURNING id, title, created_at, updated_at, pinned_at, archived_at`,
    [convo.id, b.title ?? null, b.pinned ?? null, b.archived ?? null]);
  audit(req, "conversation_update", { conversationId: convo.id, ...b });
  res.json({ conversation: updated });
}));

// Delete removes the conversation for the user; its messages are kept for the audit trail.
router.delete("/conversations/:id", wrap(async (req, res) => {
  const convo = await ownConversation(req, req.params.id);
  if (!convo) return res.status(404).json({ error: "Conversation not found" });
  await query("UPDATE conversations SET deleted_at = now() WHERE id = $1", [convo.id]);
  audit(req, "conversation_delete", { conversationId: convo.id });
  res.status(204).end();
}));

// ---------------- Regulations feed ----------------
// Regulations visible to a company: public ones (org_id IS NULL, from regulator feeds)
// plus any it uploaded privately. Filters are added as numbered SQL parameters ($2, $3...) to avoid SQL injection.
router.get("/regulations", wrap(async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const regulator = String(req.query.regulator ?? "").trim();
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const params: unknown[] = [req.user!.orgId];
  let where = "d.kind = 'regulation' AND d.status = 'ready' AND (d.org_id IS NULL OR d.org_id = $1)";
  if (regulator) {
    params.push(regulator);
    where += ` AND d.regulator = $${params.length}`;
  }
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (d.title ILIKE $${params.length} OR d.ref_no ILIKE $${params.length})`;
  }
  params.push((page - 1) * 25);
  const rows = await query(
    `SELECT d.id, d.title, d.regulator, d.ref_no, d.url, d.published_at, d.ingested_at, d.page_count,
            (d.org_id IS NOT NULL) AS private,
            (SELECT count(*) FROM impact_findings f WHERE f.regulation_id = d.id AND f.org_id = $1 AND f.status='open')::int AS open_findings
     FROM documents d WHERE ${where}
     ORDER BY d.published_at DESC NULLS LAST, d.ingested_at DESC LIMIT 25 OFFSET $${params.length}`, params);
  res.json({ regulations: rows, page });
}));

router.get("/regulations/:id", wrap(async (req, res) => {
  const doc = await one(
    `SELECT id, title, regulator, ref_no, url, published_at, ingested_at, page_count FROM documents
     WHERE id = $1 AND kind = 'regulation' AND (org_id IS NULL OR org_id = $2)`, [req.params.id, req.user!.orgId]);
  if (!doc) return res.status(404).json({ error: "Not found" });
  const chunks = await query(
    "SELECT ordinal, page, heading, content FROM chunks WHERE document_id = $1 ORDER BY ordinal LIMIT 200", [doc.id]);
  const findings = await query(
    `SELECT f.id, f.severity, f.summary, f.recommendation, f.status, p.title AS policy_title
     FROM impact_findings f LEFT JOIN documents p ON p.id = f.policy_id
     WHERE f.regulation_id = $1 AND f.org_id = $2 ORDER BY f.created_at DESC`, [doc.id, req.user!.orgId]);
  res.json({ regulation: doc, chunks, findings });
}));

// Upload a regulation the system doesn't monitor yet (stays private to this org).
router.post("/regulations/upload", upload.single("file"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Attach a file" });
  const form = new FormData();
  form.append("org_id", req.user!.orgId);
  form.append("kind", "regulation");
  for (const k of ["title", "regulator", "ref_no", "published_at"]) {
    const v = String(req.body?.[k] ?? "").trim();
    if (v) form.append(k, v);
  }
  form.append("file", new Blob([Uint8Array.from(req.file.buffer)]), req.file.originalname);
  const { document_id } = await ai.upload(form);
  audit(req, "regulation_upload", { document_id, filename: req.file.originalname });
  res.status(201).json({ id: document_id });
}));

// ---------------- Policies ----------------
router.get("/policies", wrap(async (req, res) => {
  const rows = await query(
    `SELECT d.id, d.title, d.ingested_at, d.page_count,
            (SELECT count(*) FROM chunks c WHERE c.document_id = d.id)::int AS sections,
            (SELECT count(*) FROM impact_findings f WHERE f.policy_id = d.id AND f.status = 'open')::int AS open_findings
     FROM documents d WHERE d.org_id = $1 AND d.kind = 'policy' ORDER BY d.ingested_at DESC`, [req.user!.orgId]);
  res.json({ policies: rows });
}));

// Policy upload: multer keeps the file in memory (max 25 MB) and we forward it to the AI
// service, which extracts the text, splits it into chunks and indexes it for search.
router.post("/policies", upload.single("file"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Attach a PDF, DOCX, TXT or MD file" });
  const form = new FormData();
  form.append("org_id", req.user!.orgId);
  form.append("kind", "policy");
  const title = String(req.body?.title ?? "").trim();
  if (title) form.append("title", title);
  form.append("file", new Blob([Uint8Array.from(req.file.buffer)]), req.file.originalname);
  const { document_id } = await ai.upload(form);
  audit(req, "policy_upload", { document_id, filename: req.file.originalname });
  res.status(201).json({ id: document_id });
}));

router.delete("/policies/:id", wrap(async (req, res) => {
  const rows = await query("DELETE FROM documents WHERE id = $1 AND org_id = $2 AND kind = 'policy' RETURNING id",
    [req.params.id, req.user!.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  audit(req, "policy_delete", { document_id: req.params.id });
  res.status(204).end();
}));

// ---------------- Impact ----------------
// Compare one regulation with this company's policies now (the scheduler also does this
// automatically for every new regulation). Re-running replaces the open findings.
router.post("/impact/run", wrap(async (req, res) => {
  const { regulationId } = z.object({ regulationId: z.string().uuid() }).parse(req.body);
  const reg = await one(
    "SELECT id FROM documents WHERE id = $1 AND kind='regulation' AND (org_id IS NULL OR org_id = $2)",
    [regulationId, req.user!.orgId]);
  if (!reg) return res.status(404).json({ error: "Regulation not found" });
  const out = await ai.impact({ org_id: req.user!.orgId, regulation_id: regulationId });
  audit(req, "impact_run", { regulationId, findings: out.findings.length });
  res.json(out);
}));

router.get("/impact", wrap(async (req, res) => {
  const status = ["open", "resolved", "dismissed"].includes(String(req.query.status)) ? String(req.query.status) : "open";
  const rows = await query(
    `SELECT f.id, f.severity, f.summary, f.recommendation, f.evidence, f.status, f.created_at,
            r.id AS regulation_id, r.title AS regulation_title, r.ref_no, r.regulator, r.url AS regulation_url,
            p.id AS policy_id, p.title AS policy_title
     FROM impact_findings f
     JOIN documents r ON r.id = f.regulation_id
     LEFT JOIN documents p ON p.id = f.policy_id
     WHERE f.org_id = $1 AND f.status = $2
     ORDER BY CASE f.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END, f.created_at DESC
     LIMIT 200`, [req.user!.orgId, status]);
  res.json({ findings: rows });
}));

router.patch("/impact/:id", wrap(async (req, res) => {
  const { status } = z.object({ status: z.enum(["open", "resolved", "dismissed"]) }).parse(req.body);
  const rows = await query("UPDATE impact_findings SET status = $1 WHERE id = $2 AND org_id = $3 RETURNING id",
    [status, req.params.id, req.user!.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  audit(req, "finding_status", { id: req.params.id, status });
  res.json({ ok: true });
}));

// ---------------- Alert settings ----------------
router.get("/alerts", wrap(async (req, res) => {
  const s = await one("SELECT emails, regulators, keywords, enabled FROM alert_settings WHERE org_id = $1", [req.user!.orgId]);
  res.json(s ?? { emails: [], regulators: [], keywords: [], enabled: true });
}));

const AlertsIn = z.object({
  emails: z.array(z.string().trim().toLowerCase().email()).max(20),
  regulators: z.array(z.string().trim().toUpperCase().max(20)).max(20),
  keywords: z.array(z.string().trim().max(60)).max(50),
  enabled: z.boolean(),
});

router.put("/alerts", requireAdmin, wrap(async (req, res) => {
  const b = AlertsIn.parse(req.body);
  await query(
    `INSERT INTO alert_settings (org_id, emails, regulators, keywords, enabled) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (org_id) DO UPDATE SET emails=$2, regulators=$3, keywords=$4, enabled=$5`,
    [req.user!.orgId, b.emails, b.regulators, b.keywords.filter(Boolean), b.enabled]);
  audit(req, "alerts_update", b);
  res.json(b);
}));

// ---------------- Team (admin) ----------------
router.get("/team", requireAdmin, wrap(async (req, res) => {
  res.json({ users: await query("SELECT id, name, email, role, created_at FROM users WHERE org_id = $1 ORDER BY created_at", [req.user!.orgId]) });
}));

const MemberIn = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().max(200),
  role: z.enum(["admin", "member"]).default("member"),
});

router.post("/team", requireAdmin, wrap(async (req, res) => {
  const b = MemberIn.parse(req.body);
  const problem = passwordProblem(b.password);
  if (problem) return res.status(400).json({ error: problem });
  if (await one("SELECT 1 FROM users WHERE email = $1", [b.email])) return res.status(409).json({ error: "Email already in use" });
  const u = await one(
    "INSERT INTO users (org_id, email, name, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email, role",
    [req.user!.orgId, b.email, b.name, await hashPassword(b.password), b.role]);
  audit(req, "team_add", { email: b.email, role: b.role });
  res.status(201).json(u);
}));

// Invites waiting to be accepted (not used, not cancelled, not expired).
router.get("/team/invites", requireAdmin, wrap(async (req, res) => {
  res.json({ invites: await query(
    `SELECT i.id, i.email, i.role, i.created_at, i.expires_at, u.name AS invited_by_name
     FROM invites i LEFT JOIN users u ON u.id = i.invited_by
     WHERE i.org_id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
     ORDER BY i.created_at DESC`, [req.user!.orgId]) });
}));

/** Create an invite (cancelling any earlier one for the same email) and email the link. */
async function sendInvite(req: Request, email: string, role: "admin" | "member") {
  const token = newInviteToken();
  const link = `${config.appUrl.replace(/\/$/, "")}/invite/${token}`;
  const invite = await tx(async (c) => {
    await c.query("UPDATE invites SET revoked_at = now() WHERE org_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL",
      [req.user!.orgId, email]);
    return (await c.query(
      `INSERT INTO invites (org_id, email, role, token_hash, invited_by, expires_at)
       VALUES ($1,$2,$3,$4,$5, now() + make_interval(days => $6)) RETURNING id, email, role, created_at, expires_at`,
      [req.user!.orgId, email, role, hashInviteToken(token), req.user!.id, INVITE_DAYS])).rows[0];
  });
  const org = await one("SELECT name FROM organizations WHERE id = $1", [req.user!.orgId]);
  const mail = inviteEmail({ inviter: req.user!.name, orgName: org.name, role, link, days: INVITE_DAYS });
  let emailSent = true;
  try { await sendMail([email], mail.subject, mail.text, mail.html); }
  catch (e) { emailSent = false; logger.error({ err: (e as Error).message }, "invite email failed"); }
  audit(req, "invite_sent", { email, role, emailSent });
  // The link is returned once so the admin can also share it another way (e.g. WhatsApp).
  return { invite: { ...invite, invited_by_name: req.user!.name }, link, emailSent: emailSent && !!config.smtp.host };
}

const InviteIn = z.object({ email: Email, role: z.enum(["admin", "member"]).default("member") });

router.post("/team/invites", requireAdmin, wrap(async (req, res) => {
  const b = InviteIn.parse(req.body);
  const existing = await one("SELECT org_id FROM users WHERE email = $1", [b.email]);
  if (existing) {
    return res.status(409).json({ error: existing.org_id === req.user!.orgId
      ? "This person is already on your team."
      : "This email already has a RegRadar account with another company, so it can't be invited." });
  }
  res.status(201).json(await sendInvite(req, b.email, b.role));
}));

router.post("/team/invites/:id/resend", requireAdmin, wrap(async (req, res) => {
  if (!/^\d{1,18}$/.test(req.params.id)) return res.status(404).json({ error: "Invite not found" });
  const inv = await one("SELECT email, role FROM invites WHERE id = $1 AND org_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL",
    [req.params.id, req.user!.orgId]);
  if (!inv) return res.status(404).json({ error: "Invite not found" });
  res.json(await sendInvite(req, inv.email, inv.role));
}));

router.delete("/team/invites/:id", requireAdmin, wrap(async (req, res) => {
  if (!/^\d{1,18}$/.test(req.params.id)) return res.status(404).json({ error: "Invite not found" });
  const r = await one("UPDATE invites SET revoked_at = now() WHERE id = $1 AND org_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING email",
    [req.params.id, req.user!.orgId]);
  if (!r) return res.status(404).json({ error: "Invite not found" });
  audit(req, "invite_revoked", { email: r.email });
  res.status(204).end();
}));

router.get("/audit", requireAdmin, wrap(async (req, res) => {
  res.json({ events: await query(
    `SELECT a.id, a.action, a.details, a.created_at, u.name AS user_name FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id WHERE a.org_id = $1 ORDER BY a.created_at DESC LIMIT 200`, [req.user!.orgId]) });
}));

// Admins can trigger a monitoring cycle on demand (e.g. for a demo).
router.post("/admin/sync", requireAdmin, wrap(async (req, res) => {
  audit(req, "manual_sync");
  res.json(await runMonitoringCycle({ limit: 10 }));
}));

// ---------------- Errors ----------------
// Turns known errors into clear 4xx messages; anything unexpected becomes a 500
// (with details hidden in production so internals are not leaked).
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues[0]?.message ?? "Invalid input", issues: err.issues });
  if (err instanceof AiError) {
    if (err.status >= 500) recordError({ source: "ai", message: err.message, path: `${req.method} ${req.originalUrl}`, context: { status: err.status } });
    return res.status(err.status >= 500 ? 502 : err.status).json({ error: err.message });
  }
  if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File too large (max 25 MB)" });
  if (err?.code === "22P02") return res.status(400).json({ error: "Invalid id" });
  res.locals.err = err;
  recordError({ source: "api", message: String(err?.message ?? err), stack: err?.stack, path: `${req.method} ${req.originalUrl}`,
    context: { userId: req.user?.id ?? null, orgId: req.user?.orgId ?? null, admin: req.admin?.email ?? null } });
  res.status(500).json({ error: config.isProd ? "Something went wrong" : String(err?.message ?? err) });
}
