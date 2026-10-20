/**
 * The monitoring cycle that makes RegRadar "real-time": fetch new regulations,
 * run impact analysis for every organisation, then email alert digests.
 */
import { ai } from "./ai.js";
import { buildDigest, matchesAlert, type AlertSettings, type FindingSummary, type NewDoc } from "./alerts.js";
import { config } from "./config.js";
import { query } from "./db.js";
import { logger } from "./logger.js";
import { sendMail } from "./mailer.js";

let running = false;

/**
 * One monitoring cycle:
 * 1. AI service fetches and indexes new regulator documents.
 * 2. For every organisation that has uploaded policies, run impact analysis on each new document.
 * 3. Email each organisation a digest filtered by its alert settings.
 */
export async function runMonitoringCycle(opts: { limit?: number } = {}) {
  if (running) return { skipped: true, reason: "a cycle is already running" };
  running = true;
  const started = Date.now();
  try {
    const { runs } = await ai.runIngest({ limit: opts.limit });
    const newIds = runs.flatMap((r) => r.new_document_ids);
    if (!newIds.length) return { newDocuments: 0, runs, ms: Date.now() - started };

    const docs = await query<NewDoc>(
      `SELECT id, title, regulator, ref_no, published_at::text AS published_at, url
       FROM documents WHERE id = ANY($1) ORDER BY published_at DESC NULLS LAST`,
      [newIds],
    );
    const orgs = await query<{ org_id: string }>(
      `SELECT DISTINCT org_id FROM documents WHERE kind = 'policy' AND status = 'ready' AND org_id IS NOT NULL`,
    );

    const findingsByOrg = new Map<string, FindingSummary[]>();
    for (const { org_id } of orgs) {
      const list: FindingSummary[] = [];
      for (const d of docs) {
        try {
          const { findings } = await ai.impact({ org_id, regulation_id: d.id });
          list.push(...findings.map((f) => ({ regulation_id: d.id, severity: f.severity, summary: f.summary })));
        } catch (e) {
          logger.warn({ org_id, doc: d.id, err: (e as Error).message }, "impact analysis failed");
        }
      }
      findingsByOrg.set(org_id, list);
    }

    const settings = await query<AlertSettings & { org_id: string }>(
      "SELECT org_id, emails, regulators, keywords, enabled FROM alert_settings",
    );
    let emailsSent = 0;
    for (const s of settings) {
      const relevant = docs.filter((d) => matchesAlert(s, d));
      if (!relevant.length) continue;
      const { subject, text } = buildDigest(relevant, findingsByOrg.get(s.org_id) ?? [], config.appUrl);
      try {
        await sendMail(s.emails, subject, text);
        emailsSent++;
      } catch (e) {
        logger.error({ org: s.org_id, err: (e as Error).message }, "alert email failed");
      }
    }
    await query(`INSERT INTO audit_log (action, details) VALUES ('monitoring_cycle', $1)`, [
      JSON.stringify({ newDocuments: docs.length, orgsAnalysed: orgs.length, emailsSent }),
    ]);
    return { newDocuments: docs.length, orgsAnalysed: orgs.length, emailsSent, ms: Date.now() - started };
  } finally {
    running = false;
  }
}

export function startScheduler() {
  if (!config.cronIntervalMinutes) return;
  const ms = config.cronIntervalMinutes * 60_000;
  logger.info({ everyMinutes: config.cronIntervalMinutes }, "in-process scheduler enabled");
  const tick = () =>
    runMonitoringCycle()
      .then((r) => logger.info(r, "monitoring cycle done"))
      .catch((e) => logger.error({ err: e.message }, "monitoring cycle failed"));
  setTimeout(tick, 30_000); // first run shortly after boot
  setInterval(tick, ms).unref();
}
