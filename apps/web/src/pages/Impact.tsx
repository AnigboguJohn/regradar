/**
 * Impact findings: where a regulation conflicts with or requires changes to a
 * policy. Users review the evidence side by side and mark each finding
 * resolved or dismissed (both are kept for the audit trail).
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Empty, ErrorNote, Severity, Spinner } from "../components/ui";
import { api, fmtDate, patch } from "../lib/api";

export default function Impact() {
  const [status, setStatus] = useState("open");
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = () => api(`/impact?status=${status}`).then((r) => setRows(r.findings)).catch((e) => setError(e.message));
  useEffect(() => { setRows(null); load(); /* eslint-disable-next-line */ }, [status]);

  const update = async (id: number, s: string) => {
    try { await patch(`/impact/${id}`, { status: s }); await load(); } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">Impact</h1>
        <p className="mt-1 text-sm text-slate-500">Places where a regulation conflicts with, or requires changes to, your policies.</p>
      </div>
      <div className="flex gap-1 rounded-lg bg-slate-200/60 p-1 text-sm w-fit">
        {["open", "resolved", "dismissed"].map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={`rounded-md px-3 py-1.5 capitalize ${status === s ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}>{s}</button>
        ))}
      </div>
      <ErrorNote error={error} />
      {!rows ? <Spinner /> : rows.length === 0 ? (
        <Empty title={status === "open" ? "Nothing needs attention" : `No ${status} findings`}>
          {status === "open" && "Open a regulation and click “Check impact on our policies”, or wait for the next automatic check."}
        </Empty>
      ) : (
        <div className="space-y-3">
          {rows.map((f) => (
            <article key={f.id} className="card p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Severity level={f.severity} />
                <Badge>{f.policy_title ?? "Policy"}</Badge>
                <span className="text-xs text-slate-500">{fmtDate(f.created_at)}</span>
              </div>
              <p className="mt-2 font-medium text-slate-900">{f.summary}</p>
              {f.recommendation && <p className="mt-1 text-sm text-slate-700"><span className="font-medium">Recommended change:</span> {f.recommendation}</p>}
              <p className="mt-2 text-xs text-slate-500">
                Triggered by <Link to={`/regulations/${f.regulation_id}`} className="font-medium text-brand-700 hover:underline">{f.regulation_title}</Link>
                {f.ref_no && ` (${f.ref_no})`}
              </p>
              <button className="mt-2 text-xs font-medium text-slate-600 hover:text-slate-900" onClick={() => setExpanded(expanded === f.id ? null : f.id)}>
                {expanded === f.id ? "Hide evidence" : "Show evidence"}
              </button>
              {expanded === f.id && (
                <div className="mt-2 grid gap-3 text-sm md:grid-cols-2">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="label">Regulation says</div>
                    <p className="text-slate-700">{f.evidence?.regulation_quote || "—"}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="label">Your policy says {f.evidence?.policy_section ? `(${f.evidence.policy_section})` : ""}</div>
                    <p className="text-slate-700">{f.evidence?.policy_excerpt}</p>
                  </div>
                </div>
              )}
              <div className="mt-3 flex gap-2">
                {f.status !== "resolved" && <button className="btn-ghost py-1.5" onClick={() => update(f.id, "resolved")}>Mark resolved</button>}
                {f.status !== "dismissed" && <button className="btn-ghost py-1.5" onClick={() => update(f.id, "dismissed")}>Dismiss</button>}
                {f.status !== "open" && <button className="btn-ghost py-1.5" onClick={() => update(f.id, "open")}>Reopen</button>}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
