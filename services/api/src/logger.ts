/**
 * Structured JSON logger (pino). Passwords, tokens and secrets are redacted
 * so they never end up in log files or CloudWatch.
 */
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["req.headers.authorization", "req.headers['x-cron-secret']", "*.password", "*.password_hash"],
});
