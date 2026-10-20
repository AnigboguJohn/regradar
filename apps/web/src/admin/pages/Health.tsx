/** System health: each part of RegRadar with a plain status, why it matters, and what to do. */
import { useEffect, useState, type ReactNode } from "react";
import { ErrorNote, Spinner } from "../../components/ui";
import { adminApi } from "../adminApi";
import { ago, fmtWhen, PageHeader, Panel, StatusPill } from "../ui";
import { AlertsPanel } from "./Alerts";

type Tone = "good" | "warn" | "bad" | "neutral";
function Row({ name, tone, status, detail, fix }: { name: string; tone: Tone; status: string; detail?: ReactNode; fix?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-1.5 px-5 py-4">
      <div className="w-44 shrink-0 text-sm font-medium text-slate-900">{name}</div>
      <div className="min-w-0 flex-1 text-sm text-slate-600">
        {detail}
        {fix && <p className="mt-1 text-xs text-amber-800">{fix}</p>}
      </div>
      <StatusPill tone={tone}>{status}</StatusPill>
    </div>
  );
}

export default function AdminHealth() {
  const [h, setH] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  const load = () => { setH(null); adminApi("/health").then((r) => { setH(r); setAt(new Date()); }).catch((e) => setError(e.message)); };
  useEffect(load, []);

  return (
    <>
      <PageHeader title="System health" description={at ? `Checked ${at.toLocaleTimeString()}` : "Checking every part of RegRadar…"}
        actions={<button className="btn-ghost" onClick={load} disabled={!h}>Check again</button>} />
      <ErrorNote error={error} />
      {!h ? <Spinner label="Checking the database, AI service and email…" /> : (
        <div className="space-y-5">
          <AlertsPanel />
          <Panel title="Services" flush>
            <div className="divide-y divide-slate-100">
              <Row name="API" tone="good" status="Running"
                detail={<>Up {Math.floor(h.api.uptimeSeconds / 3600)}h {Math.floor((h.api.uptimeSeconds % 3600) / 60)}m · {h.api.memoryMb} MB memory · Node {h.api.node} · {h.api.environment}</>} />
              <Row name="Database" tone={h.database.ok ? (h.database.ms > 500 ? "warn" : "good") : "bad"} status={h.database.ok ? `${h.database.ms} ms` : "Down"}
                detail={h.database.ok ? <>{h.database.version} · {h.database.size} · connections {h.database.pool.total} open, {h.database.pool.idle} idle</> : "Can't reach PostgreSQL."} />
              <Row name="AI service" tone={h.ai.ok ? "good" : "bad"} status={h.ai.ok ? `${h.ai.ms} ms` : "Down"}
                detail={h.ai.ok ? <>Regulator feeds: {(h.ai.sources ?? []).join(", ") || "none"}</> : "The Python AI service isn't answering, so Remi and uploads won't work."}
                fix={!h.ai.ok && "Check the ai container: docker compose logs ai"} />
              <Row name="AI written answers" tone={h.ai.llm ? "good" : "warn"} status={h.ai.llm ? `On · ${h.ai.llm_provider}` : "Off"}
                detail={h.ai.llm ? "Remi writes summarised, cited answers and finds real policy conflicts." : "Remi only shows matching passages; impact checks only flag sections for review."}
                fix={!h.ai.llm && "Set LLM_PROVIDER + LLM_API_KEY (free Gemini or Groq) or ANTHROPIC_API_KEY in .env, then restart the ai service."} />
              <Row name="Meaning-based search" tone={h.ai.embeddings ? "good" : "neutral"} status={h.ai.embeddings ? "On" : "Keywords only"}
                detail={h.ai.embeddings ? "Search matches meaning as well as words." : "Search matches words. Optional: an embeddings key improves recall."} />
            </div>
          </Panel>

          <Panel title="Email & sign-in protection" flush>
            <div className="divide-y divide-slate-100">
              <Row name="Email (SMTP)" tone={!h.email.configured ? "warn" : h.email.ok ? "good" : "bad"}
                status={!h.email.configured ? "Not set up" : h.email.ok ? "Working" : "Login failed"}
                detail={h.email.configured ? <>{h.email.host} · sends as {h.email.from}</> : "Reset codes, invites and alerts are written to the logs instead of being emailed."}
                fix={h.email.configured && !h.email.ok ? `Mail server said: ${h.email.error}` : !h.email.configured ? "Fill in SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM in .env." : undefined} />
              <Row name="reCAPTCHA" tone={!h.recaptcha.enabled ? "warn" : h.recaptcha.testKeys ? "warn" : "good"}
                status={!h.recaptcha.enabled ? "Off" : h.recaptcha.testKeys ? "Test keys" : "On"}
                detail="Protects sign-up, sign-in, forgot password and admin sign-in from bots."
                fix={h.recaptcha.testKeys ? "Google's test keys let anyone through. Add your own keys from google.com/recaptcha/admin." : !h.recaptcha.enabled ? "Set RECAPTCHA_SITE_KEY and RECAPTCHA_SECRET_KEY in .env." : undefined} />
              <Row name="Failed admin sign-ins" tone={h.security.failedAdminSignIns24h > 5 ? "bad" : h.security.failedAdminSignIns24h ? "warn" : "good"}
                status={`${h.security.failedAdminSignIns24h} in 24h`}
                detail="Wrong passwords or wrong authenticator codes on this console. Details are in Activity & audit → Admin actions." />
            </div>
          </Panel>

          <Panel title="Regulator sync" flush>
            <div className="divide-y divide-slate-100">
              <Row name="Last automatic check" tone={!h.sync.lastRun ? "warn" : h.sync.lastRun.error ? "bad" : h.sync.lastRun.finished_at ? "good" : "warn"}
                status={!h.sync.lastRun ? "Never" : h.sync.lastRun.error ? "Error" : h.sync.lastRun.finished_at ? ago(h.sync.lastRun.finished_at) : "Not finished"}
                detail={h.sync.lastRun ? <>Started {fmtWhen(h.sync.lastRun.started_at)} · {h.sync.lastRun.new_docs ?? 0} new · {h.sync.scheduledEveryMinutes ? `runs every ${h.sync.scheduledEveryMinutes / 60} h` : "scheduled by AWS EventBridge"}</> : "No check has run yet."}
                fix={h.sync.lastRun?.error ?? undefined} />
            </div>
          </Panel>

          <Panel title="Database migrations" description={`${h.migrations.length} applied`} flush>
            <ul className="divide-y divide-slate-100">
              {h.migrations.map((m: any) => (
                <li key={m.name} className="flex justify-between gap-3 px-5 py-2 text-sm"><code className="text-slate-800">{m.name}</code><span className="text-xs text-slate-500">{fmtWhen(m.applied_at)}</span></li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </>
  );
}
