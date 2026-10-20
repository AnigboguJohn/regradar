/** Alerts panel (on System health): what's firing now, recent alerts, and who gets the emails. */
import { useEffect, useState } from "react";
import { Spinner } from "../../components/ui";
import { adminApi, adminPost } from "../adminApi";
import { ago, fmtWhen, Panel, StatusPill } from "../ui";

export function AlertsPanel() {
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const load = () => adminApi("/alerts").then(setD).catch(() => setD({ alerts: [], recipients: [] }));
  useEffect(() => { load(); }, []);

  const act = async (kind: "check" | "test") => {
    setBusy(kind); setNote(null);
    try {
      const r = await adminPost(`/alerts/${kind}`, {});
      setNote({ text: kind === "test" ? r.message : r.skipped ? "Another server is running the checks right now."
        : r.firing.length ? `Checks done: ${r.firing.length} alert(s) firing.` : "Checks done: everything looks fine." });
      load();
    } catch (e) { setNote({ text: (e as Error).message, error: true }); } finally { setBusy(null); }
  };

  const firing = d?.alerts.filter((a: any) => a.status === "firing") ?? [];
  const recent = d?.alerts.filter((a: any) => a.status === "resolved") ?? [];

  return (
    <Panel title="Alerts" description={d ? `Checked every ${d.monitorEveryMinutes || "—"} minutes. Emails go to ${d.recipients.join(", ") || "nobody yet"}.` : undefined}
      actions={<div className="flex gap-2">
        <button className="btn-ghost px-3 py-1.5" onClick={() => act("test")} disabled={!!busy}>{busy === "test" ? "Sending…" : "Send test alert"}</button>
        <button className="btn-primary px-3 py-1.5" onClick={() => act("check")} disabled={!!busy}>{busy === "check" ? "Checking…" : "Run checks now"}</button>
      </div>} flush>
      {note && <p className={`border-b border-slate-100 px-5 py-2.5 text-sm ${note.error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{note.text}</p>}
      {!d ? <div className="p-5"><Spinner /></div> : (
        <div className="divide-y divide-slate-100">
          {firing.length === 0 && (
            <div className="flex items-center gap-2 px-5 py-4 text-sm text-slate-700"><StatusPill tone="good">All clear</StatusPill> No alerts are firing.</div>
          )}
          {firing.map((a: any) => (
            <div key={a.key} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={a.severity === "critical" ? "bad" : "warn"}>{a.severity === "critical" ? "Critical" : "Warning"}</StatusPill>
                <span className="font-medium text-slate-900">{a.title}</span>
                <span className="text-xs text-slate-500">since {ago(a.first_fired)}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-line text-sm text-slate-600">{a.detail}</p>
            </div>
          ))}
          {recent.length > 0 && (
            <details className="px-5 py-3 text-sm">
              <summary className="cursor-pointer font-medium text-slate-600">Recently resolved ({recent.length})</summary>
              <ul className="mt-2 space-y-1.5">
                {recent.map((a: any) => (
                  <li key={a.key} className="flex flex-wrap justify-between gap-2 text-slate-600">
                    <span>{a.title}</span><span className="text-xs text-slate-500">resolved {fmtWhen(a.resolved_at)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Panel>
  );
}
