/**
 * All API settings, read once from environment variables (.env locally,
 * Secrets Manager on AWS). In production a missing JWT_SECRET stops the app
 * from starting instead of silently using an insecure default.
 */
function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

export const config = {
  port: Number(env("PORT", "4000")),
  databaseUrl: env("DATABASE_URL", "postgresql://regradar:regradar@localhost:5432/regradar"),
  jwtSecret: isProd ? env("JWT_SECRET") : env("JWT_SECRET", "dev-only-change-me"),
  jwtTtl: env("JWT_TTL", "12h"),
  rememberTtl: env("REMEMBER_TTL", "30d"),   // sessions started with "Remember me"
  aiUrl: env("AI_SERVICE_URL", "http://localhost:8000"),
  internalToken: env("INTERNAL_TOKEN", "dev-internal-token"),
  cronSecret: env("CRON_SECRET", "dev-cron-secret"),
  cronIntervalMinutes: Number(env("CRON_INTERVAL_MINUTES", "0")), // 0 = rely on external scheduler (EventBridge)
  // Render sets RENDER_EXTERNAL_URL (e.g. https://regradar.onrender.com) automatically.
  corsOrigins: env("CORS_ORIGINS", process.env.RENDER_EXTERNAL_URL ?? "http://localhost:5173").split(",").map((s) => s.trim()),
  appUrl: env("APP_URL", process.env.RENDER_EXTERNAL_URL ?? "http://localhost:5173"),
  // Folder with the built web app; set when the API also serves the website (Render).
  webDist: process.env.WEB_DIST ?? "",
  // Email over HTTPS via Brevo, for hosts that block SMTP ports (Render's free plan does).
  brevoApiKey: process.env.BREVO_API_KEY ?? "",
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? "587"),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.MAIL_FROM ?? "RegRadar <alerts@regradar.local>",
  },
  // Google reCAPTCHA v2 ("I'm not a robot" checkbox) on sign-up, sign-in and forgot-password.
  // Leave both empty to switch it off (e.g. automated tests).
  recaptcha: {
    siteKey: process.env.RECAPTCHA_SITE_KEY ?? "",
    secretKey: process.env.RECAPTCHA_SECRET_KEY ?? "",
  },
  // Alerting: who gets alert emails (comma-separated; empty = every platform admin), how often
  // the checks run (0 = off), and after how many hours without a successful regulator check to warn.
  opsAlertEmails: (process.env.OPS_ALERT_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  opsMonitorMinutes: Number(env("OPS_MONITOR_MINUTES", isTest ? "0" : "5")),
  syncStaleHours: Number(env("SYNC_STALE_HOURS", "24")),
  // Attempts allowed per connection every 15 minutes (sign-in/sign-up, and password resets).
  authRateLimit: Number(env("AUTH_RATE_LIMIT", "20")),
  resetRateLimit: Number(env("RESET_RATE_LIMIT", "10")),
  migrationsDir: env("MIGRATIONS_DIR", "../../db/migrations"),
  isProd,
  isTest,
};
