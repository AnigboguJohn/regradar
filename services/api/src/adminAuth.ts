/**
 * Platform admin authentication for the /admin console. Admin accounts live in their own
 * table and their tokens carry typ "admin", so a company user's token can never open the
 * console and an admin token can never act as a company user.
 *
 * Signing in is two steps: password (+ reCAPTCHA) returns a short-lived challenge, and the
 * challenge plus a 6-digit authenticator code returns the session token (8 hours).
 */
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { one, query } from "./db.js";
import { logger } from "./logger.js";

export interface PlatformAdmin { id: string; email: string; name: string }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { admin?: PlatformAdmin }
  }
}

const ADMIN_TTL = "8h";
const CHALLENGE_TTL = "5m";
export const ADMIN_SESSION_EXPIRED = "Your admin session expired. Please sign in again.";

export function signAdminToken(a: PlatformAdmin, version: number) {
  return jwt.sign({ sub: a.id, typ: "admin", ver: version }, config.jwtSecret, { expiresIn: ADMIN_TTL });
}

/** Proof that the password step passed. For first-time setup it also carries the new (encrypted) secret. */
export function signChallenge(adminId: string, setupSecret?: string) {
  return jwt.sign({ sub: adminId, typ: "admin-2fa", ...(setupSecret ? { setup: setupSecret } : {}) }, config.jwtSecret, { expiresIn: CHALLENGE_TTL });
}

export function readChallenge(token: string): { adminId: string; setup?: string } | null {
  try {
    const p = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    return p.typ === "admin-2fa" ? { adminId: String(p.sub), setup: p.setup } : null;
  } catch { return null; }
}

export async function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Not signed in" });
  let p: jwt.JwtPayload;
  try { p = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload; } catch { return res.status(401).json({ error: ADMIN_SESSION_EXPIRED }); }
  if (p.typ !== "admin") return res.status(401).json({ error: "This page needs an admin sign-in." });
  try {
    const a = await one("SELECT id, email, name, token_version, disabled_at FROM platform_admins WHERE id = $1", [p.sub]);
    if (!a || a.disabled_at || a.token_version !== p.ver) return res.status(401).json({ error: ADMIN_SESSION_EXPIRED });
    req.admin = { id: a.id, email: a.email, name: a.name };
    next();
  } catch (e) { next(e); }
}

/** Record an admin action. Fire-and-forget so logging problems never block the action. */
export function adminAudit(req: Request, action: string, details: Record<string, unknown> = {}, adminId?: string) {
  query("INSERT INTO admin_audit (admin_id, action, details, ip) VALUES ($1, $2, $3, $4)",
    [adminId ?? req.admin?.id ?? null, action, JSON.stringify(details), req.ip ?? null])
    .catch((e) => logger.error({ err: e.message, action }, "admin audit write failed"));
}
