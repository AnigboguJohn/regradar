/**
 * Built-in error tracking. Unexpected server errors, AI service failures and crashes in users'
 * browsers are stored in app_errors, grouped by a fingerprint so the same bug is one entry with
 * a count. The admin console lists them (Errors page) and the alert monitor emails admins when
 * new errors appear or errors spike. Writes never throw: tracking must not cause failures.
 */
import crypto from "node:crypto";
import { query } from "./db.js";
import { logger } from "./logger.js";

export type ErrorSource = "api" | "web" | "ai";

/** Replace ids, numbers and quoted values so "User 123 not found" and "User 456 not found" group together. */
export function normalizeMessage(message: string) {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/(["'`]).*?\1/g, "<value>")
    .replace(/\b\d+\b/g, "<n>")
    .slice(0, 300);
}

/** The first stack frame that isn't inside node_modules or Node itself, without column numbers. */
export function topFrame(stack?: string | null) {
  const lines = (stack ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("at "));
  const own = lines.find((l) => !l.includes("node_modules") && !l.includes("node:")) ?? lines[0] ?? "";
  return own.replace(/:\d+\)?$/, "").replace(/\?[^)\s]*/, "");
}

export function fingerprint(source: ErrorSource, message: string, stack?: string | null) {
  return crypto.createHash("sha1").update(`${source}|${normalizeMessage(message)}|${topFrame(stack)}`).digest("hex");
}

/** Route-like path: /api/conversations/123?x=1 -> /api/conversations/:id */
export const normalizePath = (path: string) =>
  path.split("?")[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id").replace(/\/\d+(?=\/|$)/g, "/:id").replace(/\/invite\/[^/]+/, "/invite/:token").slice(0, 300);

export function recordError(e: { source: ErrorSource; message: string; stack?: string | null; path?: string; context?: Record<string, unknown> }) {
  const message = (e.message || "Unknown error").slice(0, 1000);
  const stack = e.stack ? e.stack.slice(0, 6000) : null;
  query(
    `INSERT INTO app_errors (fingerprint, source, message, stack, path, last_context)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (fingerprint) DO UPDATE SET
       count = app_errors.count + 1, last_seen = now(), message = EXCLUDED.message,
       stack = COALESCE(EXCLUDED.stack, app_errors.stack), path = EXCLUDED.path,
       last_context = EXCLUDED.last_context, resolved_at = NULL`,   // a resolved error that comes back is reopened
    [fingerprint(e.source, message, stack), e.source, message, stack, e.path ? normalizePath(e.path) : null, JSON.stringify(e.context ?? {})],
  ).catch((err) => logger.error({ err: err.message }, "could not record error"));
}
