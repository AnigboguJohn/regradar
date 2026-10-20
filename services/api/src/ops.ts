/**
 * Operational health and alerting.
 *
 * readiness() is the deep health check behind GET /api/health/ready (used by uptime monitors
 * and the load balancer): it checks the database and the AI service.
 *
 * The alert monitor runs every few minutes. Each check either fires or clears an alert in
 * ops_alerts. A new alert emails the ops recipients (OPS_ALERT_EMAILS, or every platform admin);
 * while it keeps firing a reminder goes out (hourly for critical, daily for warnings); when it
 * clears, an "all clear" email follows. If several API servers run, a database lock makes sure
 * only one of them runs the monitor at a time.
 */
import { ai } from "./ai.js";
import { config } from "./config.js";
import { brandedEmail, emailButton, esc } from "./emails.js";
import { one, pool, query } from "./db.js";
import { logger } from "./logger.js";
import { checkSmtp, sendMail } from "./mailer.js";

export async function readiness() {
  const t0 = Date.now();
  const db = await one("SELECT 1 AS ok").then(() => true).catch(() => false);
  const dbMs = Date.now() - t0;
  const t1 = Date.now();
  const aiOk = await ai.health().then((h) => !!h?.ok).catch(() => false);
  return { ok: db && aiOk, db: { ok: db, ms: dbMs }, ai: { ok: aiOk, ms: Date.now() - t1 } };
}

type Severity = "critical" | "warning";
interface Finding { key: string; severity: Severity; title: string; detail: string }

// Remembered between runs (per server) to spot spikes and new failures.
let lastErrorCounts: Map<string, number> | null = null;
let lastFailedDownloads: number | null = null;

/** Run every check and return the alerts that should currently be firing. */
export async function evaluateChecks(): Promise<Finding[]> {
  const out: Finding[] = [];
  const r = await readiness();
  if (!r.db.ok) {
    out.push({ key: "db_down", severity: "critical", title: "Database is not responding", detail: "The API can't reach PostgreSQL. Nobody can sign in or use RegRadar." });
    return out;   // nothing else can be checked without the database
  }
  if (!r.ai.ok) out.push({ key: "ai_down", severity: "critical", title: "AI service is down", detail: "Remi can't answer questions and uploads can't be indexed. Check the ai container / ECS service." });

  // Errors: compare each error group's count with the previous run.
  const groups = await query<{ fingerprint: string; message: string; source: string; count: number; first_seen: Date }>(
    "SELECT fingerprint, message, source, count, first_seen FROM app_errors WHERE resolved_at IS NULL AND last_seen > now() - interval '15 minutes'");
  if (lastErrorCounts) {
    const rising = groups.map((g) => ({ ...g, delta: g.count - (lastErrorCounts!.get(g.fingerprint) ?? 0) })).filter((g) => g.delta > 0);
    const total = rising.reduce((n, g) => n + g.delta, 0);
    const top = rising.sort((a, b) => b.delta - a.delta).slice(0, 3).map((g) => `• [${g.source}] ${g.message.slice(0, 120)} (×${g.delta})`).join("\n");
    if (total >= 20) out.push({ key: "error_spike", severity: "critical", title: `${total} errors in the last few minutes`, detail: top });
    else if (rising.some((g) => !lastErrorCounts!.has(g.fingerprint))) {
      out.push({ key: "new_errors", severity: "warning", title: "New errors appeared", detail: top });
    }
  }
  lastErrorCounts = new Map((await query<{ fingerprint: string; count: number }>("SELECT fingerprint, count FROM app_errors")).map((g) => [g.fingerprint, g.count]));

  // Regulator sync: last run failed, or no successful run for too long.
  const last = await one("SELECT started_at, finished_at, error FROM ingest_runs ORDER BY id DESC LIMIT 1");
  const lastOk = await one("SELECT max(finished_at) AS at FROM ingest_runs WHERE finished_at IS NOT NULL AND error IS NULL");
  if (last?.error) out.push({ key: "sync_failing", severity: "warning", title: "Regulator check is failing", detail: `The last check failed: ${String(last.error).slice(0, 300)}` });
  const staleHours = config.syncStaleHours;
  if (!lastOk?.at || Date.now() - new Date(lastOk.at).getTime() > staleHours * 3_600_000) {
    out.push({ key: "sync_stale", severity: "warning", title: `No successful regulator check in ${staleHours} hours`,
      detail: lastOk?.at ? `Last successful check: ${new Date(lastOk.at).toISOString()}.` : "No regulator check has ever finished successfully." });
  }
  const failed = (await one("SELECT count(*)::int AS n FROM documents WHERE kind = 'regulation' AND status = 'failed'")).n;
  if (lastFailedDownloads !== null && failed > lastFailedDownloads) {
    out.push({ key: "new_failed_downloads", severity: "warning", title: `${failed - lastFailedDownloads} new circular(s) failed to download`,
      detail: `${failed} circulars are not searchable. Fix them in Admin → Regulations & sync (Attach PDF).` });
  }
  lastFailedDownloads = failed;

  const smtp = await checkSmtp();
  if (smtp.configured && !smtp.ok) out.push({ key: "email_failing", severity: "warning", title: "Email can't be sent", detail: `The mail server refused the login: ${smtp.error}. Reset codes and invites aren't being delivered.` });

  const attacks = (await one("SELECT count(*)::int AS n FROM admin_audit WHERE action IN ('admin_login_failed','admin_2fa_failed') AND created_at > now() - interval '1 hour'")).n;
  if (attacks >= 10) out.push({ key: "admin_signin_attack", severity: "warning", title: `${attacks} failed admin sign-ins in the last hour`, detail: "Someone may be trying to guess an admin password. Check Admin → Activity & audit → Admin actions." });

  return out;
}

async function recipients() {
  if (config.opsAlertEmails.length) return config.opsAlertEmails;
  return (await query<{ email: string }>("SELECT email FROM platform_admins WHERE disabled_at IS NULL")).map((r) => r.email);
}

function alertMail(kind: "firing" | "reminder" | "resolved", f: { severity: Severity; title: string; detail: string }) {
  const label = kind === "resolved" ? "RESOLVED" : f.severity === "critical" ? "CRITICAL" : "WARNING";
  const subject = `[RegRadar ${label}] ${f.title}`;
  const link = `${config.appUrl.replace(/\/$/, "")}/admin/health`;
  const text = `${kind === "resolved" ? "All clear: this problem has stopped." : kind === "reminder" ? "Still happening:" : "A problem was detected:"}\n\n${f.title}\n${f.detail}\n\nSystem health: ${link}`;
  const html = brandedEmail({
    title: kind === "resolved" ? `Resolved: ${f.title}` : f.title,
    intro: kind === "resolved" ? "This problem has stopped. No action needed." : `${f.severity === "critical" ? "<strong style=\"color:#b91c1c;\">Critical</strong>" : "<strong style=\"color:#b45309;\">Warning</strong>"}${kind === "reminder" ? " · still happening" : ""}`,
    content: `<p style="margin:0 0 18px;text-align:left;font-size:14px;line-height:1.6;color:#334155;white-space:pre-line;">${esc(f.detail)}</p>${emailButton(link, "Open system health")}`,
    footnote: "You get this because you're a RegRadar platform admin. Alerts repeat while a problem continues (hourly if critical, daily for warnings).",
  });
  return { subject, text, html };
}

async function notify(kind: "firing" | "reminder" | "resolved", f: { severity: Severity; title: string; detail: string }) {
  const to = await recipients();
  if (!to.length) return logger.warn({ alert: f.title }, "alert has no recipients (create a platform admin or set OPS_ALERT_EMAILS)");
  const m = alertMail(kind, f);
  await sendMail(to, m.subject, m.text, m.html).catch((e) => logger.error({ err: e.message }, "alert email failed"));
}

/** One monitor pass: evaluate checks, then fire, remind or resolve alerts. Returns what changed. */
export async function runAlertMonitor() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT pg_try_advisory_lock(727275) AS got");
    if (!rows[0].got) return { skipped: true };
    try {
      const findings = await evaluateChecks();
      const firing = await query<{ key: string; severity: Severity; title: string; detail: string; last_notified: Date | null }>(
        "SELECT key, severity, title, detail, last_notified FROM ops_alerts WHERE status = 'firing'");
      const changes: string[] = [];
      for (const f of findings) {
        const existing = firing.find((a) => a.key === f.key);
        if (!existing) {
          await query(`INSERT INTO ops_alerts (key, status, severity, title, detail, first_fired, last_notified, resolved_at, fire_count)
            VALUES ($1, 'firing', $2, $3, $4, now(), now(), NULL, 1)
            ON CONFLICT (key) DO UPDATE SET status = 'firing', severity = $2, title = $3, detail = $4, first_fired = now(),
              last_notified = now(), resolved_at = NULL, fire_count = ops_alerts.fire_count + 1`, [f.key, f.severity, f.title, f.detail]);
          await notify("firing", f); changes.push(`fired ${f.key}`);
        } else {
          const every = f.severity === "critical" ? 3_600_000 : 86_400_000;
          const due = !existing.last_notified || Date.now() - new Date(existing.last_notified).getTime() >= every;
          await query(`UPDATE ops_alerts SET severity = $2, title = $3, detail = $4${due ? ", last_notified = now()" : ""} WHERE key = $1`, [f.key, f.severity, f.title, f.detail]);
          if (due) { await notify("reminder", f); changes.push(`reminded ${f.key}`); }
        }
      }
      for (const a of firing.filter((a) => !findings.some((f) => f.key === a.key))) {
        await query("UPDATE ops_alerts SET status = 'resolved', resolved_at = now() WHERE key = $1", [a.key]);
        await notify("resolved", a); changes.push(`resolved ${a.key}`);
      }
      return { firing: findings.map((f) => f.key), changes };
    } finally {
      await client.query("SELECT pg_advisory_unlock(727275)");
    }
  } finally { client.release(); }
}

export function startAlertMonitor() {
  if (!config.opsMonitorMinutes) return;
  const tick = () => runAlertMonitor()
    .then((r) => { if ("changes" in r && r.changes?.length) logger.info(r, "alert monitor"); })
    .catch((e) => logger.error({ err: e.message }, "alert monitor failed"));
  setTimeout(tick, 60_000).unref();   // first pass a minute after start-up
  setInterval(tick, config.opsMonitorMinutes * 60_000).unref();
  logger.info({ everyMinutes: config.opsMonitorMinutes }, "alert monitor enabled");
}

/** Sends one example alert to the ops recipients, so admins can check alerts reach them. */
export async function sendTestAlert() {
  const to = await recipients();
  const m = alertMail("firing", { severity: "warning", title: "Test alert", detail: "This is a test from Admin → System health. Real alerts look like this." });
  await sendMail(to, m.subject, m.text, m.html);
  return to;
}
