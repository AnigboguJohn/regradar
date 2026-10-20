/**
 * Builds the Express application: security headers, CORS, JSON parsing, request
 * logging, the health check, the scheduled-job endpoint and the /api routes.
 * Kept separate from index.ts so tests can create the app without starting a server.
 */
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import crypto from "node:crypto";
import { config } from "./config.js";
import { runMonitoringCycle } from "./jobs.js";
import { logger } from "./logger.js";
import { adminRouter } from "./adminRoutes.js";
import { readiness } from "./ops.js";
import { errorHandler, router } from "./routes.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1); // behind ALB / CloudFront
  app.use(helmet());
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
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(errorHandler);
  return app;
}
