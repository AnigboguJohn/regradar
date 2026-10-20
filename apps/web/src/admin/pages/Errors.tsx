/**
 * Built-in error tracking: server errors, AI service failures and crashes in users' browsers,
 * grouped so each bug is one row with how often it happened. Open one to see the stack trace,
 * then mark it resolved once fixed (it reopens automatically if it happens again).
 */
import { useEffect, useState } from "react";
import { ErrorNote, Spinner } from "../../components/ui";
import { adminApi, adminPatch } from "../adminApi";
import { ago, fmtWhen, PageHeader, Panel, StatusPill } from "../ui";
import { Flash } from "./UserActions";

const SOURCE: Record<string, string> = { api: "Server", web: "Browser", ai: "AI service" };

export default function AdminErrors() {
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const [source, setSource] = useState("");
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const load = () => adminApi(`/errors?status=${status}&source=${source}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { setData(null); load(); }, [status, source]);

  const setResolved = async (e: any, resolved: boolean) => {
    try { await adminPatch(`/errors/${e.id}`, { resolved }); setMsg({ text: resolved ? "Marked resolved. It reopens by itself if it happens again." : "Reopened." }); load(); }
    catch (err) { setMsg({ text: (err as Error).message, error: true }); }
  };

  return (
    <>
      <PageHeader title="Errors" description="Problems people hit, grouped so each bug appears once. Recorded automatically." />
      <Flash msg={msg} />
      <ErrorNote error={error} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl bg-slate-200/60 p-1 text-sm" role="tablist">
          {(["open", "resolved"] as const).map((s) => (
            <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
              className={`rounded-lg px-3.5 py-1.5 font-medium capitalize ${status === s ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
              {s}{data?.counts ? ` (${data.counts[s]})` : ""}
            </button>
          ))}
        </div>
        <select className="input w-auto" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Where">
          <option value="">Everywhere</option><option value="api">Server</option><option value="web">Users' browsers</option><option value="ai">AI service</option>
        </select>
      </div>
      <Panel flush>
        {!data ? <div className="p-5"><Spinner /></div> : data.errors.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="font-medium text-slate-800">{status === "open" ? "No open errors" : "Nothing resolved yet"}</p>
            <p className="mt-1 text-sm text-slate-500">{status === "open" ? "When something breaks for a user, it shows up here within seconds." : "Errors you mark as resolved are kept here."}</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.errors.map((e: any) => (
              <li key={e.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start gap-3">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                    <div className="break-words font-medium text-slate-900">{e.message}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <StatusPill tone={e.source === "web" ? "warn" : "bad"}>{SOURCE[e.source]}</StatusPill>
                      {e.path && <code className="font-mono">{e.path}</code>}
                      <span>{e.count} {e.count === 1 ? "time" : "times"}</span>
                      <span>last {ago(e.last_seen)}</span>
                      <span>first {fmtWhen(e.first_seen)}</span>
                    </div>
                  </button>
                  {e.resolved_at
                    ? <button className="btn-ghost px-3 py-1.5" onClick={() => setResolved(e, false)}>Reopen</button>
                    : <button className="btn-ghost px-3 py-1.5" onClick={() => setResolved(e, true)}>Mark resolved</button>}
                </div>
                {open === e.id && (
                  <div className="mt-3 space-y-2">
                    {e.stack && <pre className="max-h-72 overflow-auto rounded-xl bg-slate-950 p-3 text-xs leading-relaxed text-slate-200">{e.stack}</pre>}
                    {Object.keys(e.last_context ?? {}).length > 0 && (
                      <div className="text-xs text-slate-500">Last time: {Object.entries(e.last_context).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
