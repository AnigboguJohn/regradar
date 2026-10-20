/**
 * Entry point of the Node.js API.
 * Runs database migrations, starts the HTTP server and (optionally) the in-process
 * scheduler, and shuts down cleanly on SIGTERM (which ECS sends on every deploy).
 */
import { createApp } from "./app.js";
import { config } from "./config.js";
import { migrate, pool } from "./db.js";
import { startScheduler } from "./jobs.js";
import { logger } from "./logger.js";
import { startAlertMonitor } from "./ops.js";

async function main() {
  await migrate();
  const server = createApp().listen(config.port, () => logger.info({ port: config.port }, "RegRadar API listening"));
  startScheduler();
  startAlertMonitor();

  const shutdown = () => {
    logger.info("shutting down");
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((e) => {
  logger.fatal({ err: e.message }, "failed to start");
  process.exit(1);
});
