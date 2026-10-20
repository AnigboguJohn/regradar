/**
 * Audit trail. Records who did what (login, upload, question, status change)
 * for the organisation's audit log, which regulators expect compliance tools to keep.
 * Writes are fire-and-forget so a logging problem never breaks the user's action.
 */
import type { Request } from "express";
import { query } from "./db.js";
import { logger } from "./logger.js";

export function audit(req: Request, action: string, details: Record<string, unknown> = {}) {
  query("INSERT INTO audit_log (org_id, user_id, action, details) VALUES ($1, $2, $3, $4)", [
    req.user?.orgId ?? null,
    req.user?.id ?? null,
    action,
    JSON.stringify({ ...details, ip: req.ip }),
  ]).catch((e) => logger.error({ err: e.message, action }, "audit write failed"));
}
