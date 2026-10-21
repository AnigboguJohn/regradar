/**
 * PostgreSQL access for the API: a shared connection pool, small query helpers,
 * a transaction helper and the migration runner that applies db/migrations/*.sql.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { config } from "./config.js";
import { logger } from "./logger.js";

// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Dates (avoids timezone shifts).
pg.types.setTypeParser(1082, (v) => v);

// RDS enforces TLS. Set DB_SSL=true there (encrypts traffic; supply the RDS CA bundle to also verify the cert).
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});
// Hosted databases (Neon, RDS failover) close idle connections. Without this handler Node treats
// that as an unhandled error and the whole server crashes; the pool simply opens a new connection.
pool.on("error", (err) => logger.warn({ err: err.message }, "idle database connection closed; it will be replaced"));

export async function query<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []) {
  const res = await pool.query<T>(sql, params);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []) {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Apply db/migrations/*.sql once each, in filename order. */
export async function migrate() {
  const dir = path.resolve(config.migrationsDir);
  const client = await pool.connect();
  try {
    // Advisory lock: several API containers may start at once.
    await client.query("SELECT pg_advisory_lock(727274)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())`);
    const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
      logger.info({ file }, "migration applied");
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => undefined);
    client.release();
  }
}
