/**
 * Authentication: password hashing (bcrypt), JWT sessions and the Express
 * middleware that protects routes. Every signed-in request carries req.user,
 * which includes the organisation id used to keep each company's data separate.
 *
 * Each token carries the user's token_version. Changing or resetting a password
 * bumps it, so every older token stops working (other devices are signed out).
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { one } from "./db.js";

export interface AuthUser {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: "admin" | "member";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** The session was started with "Remember me" (30 days instead of the usual 12 hours). */
      remember?: boolean;
    }
  }
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export const SESSION_EXPIRED = "Your session expired. Please sign in again.";
export const SUSPENDED = "This account has been suspended. Contact RegRadar support if you think this is a mistake.";

export function signToken(u: AuthUser, version = 0, remember = false): string {
  return jwt.sign({ sub: u.id, org: u.orgId, email: u.email, name: u.name, role: u.role, ver: version, rem: remember },
    config.jwtSecret, { expiresIn: (remember ? config.rememberTtl : config.jwtTtl) as jwt.SignOptions["expiresIn"] });
}

export function verifyToken(token: string): AuthUser & { ver: number; rem: boolean } {
  const p = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
  if (p.typ) throw new Error("not a company user token");   // admin console tokens can't act as users
  return { id: String(p.sub), orgId: p.org, email: p.email, name: p.name, role: p.role, ver: Number(p.ver ?? 0), rem: !!p.rem };
}

// The token proves who signed in; the user row is read fresh on every request so a password
// change, a removed account or an edited profile takes effect immediately.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Not signed in" });
  let claims: ReturnType<typeof verifyToken>;
  try { claims = verifyToken(token); } catch { return res.status(401).json({ error: SESSION_EXPIRED }); }
  try {
    const u = await one(
      `SELECT u.id, u.org_id, u.email, u.name, u.role, u.token_version, u.suspended_at, o.suspended_at AS org_suspended_at
       FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.id = $1`, [claims.id]);
    if (!u || u.token_version !== claims.ver) return res.status(401).json({ error: SESSION_EXPIRED });
    if (u.suspended_at || u.org_suspended_at) return res.status(403).json({ error: SUSPENDED, code: "suspended" });
    req.user = { id: u.id, orgId: u.org_id, email: u.email, name: u.name, role: u.role };
    req.remember = claims.rem;
    next();
  } catch (e) { next(e); }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admins only" });
  next();
}

/** Password policy: 10+ chars with a letter and a digit. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Password must contain letters and numbers";
  return null;
}
