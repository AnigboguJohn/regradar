/**
 * Builds the Express application: security headers, CORS, JSON parsing, request
 * logging, the health check, the scheduled-job endpoint and the /api routes.
 * With WEB_DIST set (single-service hosting such as Render), it also serves the
 * built web app, so the whole product runs behind one address.
 * Kept separate from index.ts so tests can create the app without starting a server.
 */
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import crypto from "node:crypto";
import path from "node:path";
import { config } from "./config.js";
import { runMonitoringCycle } from "./jobs.js";
import { logger } from "./logger.js";
import { adminRouter } from "./adminRoutes.js";
import { readiness } from "./ops.js";
import { errorHandler, router } from "./routes.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1); // behind ALB / CloudFront
  app.use(helmet({
    // What the browser may load. reCAPTCHA needs Google's script and frame; everything else is our own.
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/"],
        "frame-src": ["'self'", "https://www.google.com/recaptcha/", "https://recaptcha.google.com/recaptcha/"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'"],
        "font-src": ["'self'", "data:"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'self'"],
      },
    },
  }));
  app.use(cors({ origin: config.corsOrigins, credentials: false }));
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/healthz" } }));

  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  // Deep check for uptime monitors: 200 when the database and AI service answer, 503 otherwise.
  app.get("/api/health/ready", async (_req, res) => {
    const r = await readiness();
    res.status(r.ok ? 200 : 503).json({ status: r.ok ? "ok" : "degraded", db: r.db, ai: r.ai, time: new Date().toISOString() });
  });

  // Called by AWS EventBridge Scheduler (or any cron) to run a monitoring cycle.
  app.post("/internal/cron/monitor", async (req, res, next) => {
    const given = Buffer.from(String(req.headers["x-cron-secret"] ?? ""));
    const expected = Buffer.from(config.cronSecret);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    // Respond immediately; the cycle can take minutes.
    res.status(202).json({ accepted: true });
    runMonitoringCycle()
      .then((r) => logger.info(r, "cron monitoring cycle done"))
      .catch((e) => logger.error({ err: e.message }, "cron monitoring cycle failed"));
    void next;
  });

  app.use("/api/admin", adminRouter);   // platform admin console (separate accounts and tokens)
  app.use("/api", router);

  // Single-service hosting: serve the web app. Hashed assets are cached for a year;
  // any other path that isn't an API call gets index.html so the React router can handle it.
  if (config.webDist) {
    const dist = path.resolve(config.webDist);
    app.use("/assets", express.static(path.join(dist, "assets"), { immutable: true, maxAge: "1y", fallthrough: false }));
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api\/|\/internal\/).*/, (_req, res) => {
      res.setHeader("cache-control", "no-cache");
      res.sendFile(path.join(dist, "index.html"));
    });
  }
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(errorHandler);
  return app;
}
