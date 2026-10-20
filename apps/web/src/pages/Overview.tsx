/**
 * Dashboard: headline numbers, the latest regulations and the findings that
 * need attention. Loads its four data sources in parallel.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, ErrorNote, Severity, Spinner, Stat } from "../components/ui";
import { api, fmtDate } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function Overview() {
  const { user } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [regs, setRegs] = useState<any[]>([]);
  const [findings, setFindings] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api("/stats"), api("/regulations"), api("/impact?status=open"), api("/status")])
      .then(([s, r, f, st]) => { setStats(s); setRegs(r.regulations.slice(0, 6)); setFindings(f.findings.slice(0, 5)); setStatus(st); })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorNote error={error} />;
  if (!stats) return <Spinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Good to see you, {user?.name.split(" ")[0]}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {status?.lastIngest?.error
            ? `The last regulator check (${fmtDate(status.lastIngest.started_at)}) couldn't reach the source: ${status.lastIngest.error}.`
            : status?.lastIngest?.finished_at ? `Last checked for new regulations ${fmtDate(status.lastIngest.finished_at)}.` : "Waiting for the first regulation sync."}
          {status?.ai && !status.ai.llm && " AI summaries are off (no model key set), so answers show the matching passages."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Regulations indexed" value={stats.regulations} />
        <Stat label="New in 30 days" value={stats.regulations_30d} />
        <Stat label="Open findings" value={stats.open_findings} />
        <Stat label="High severity" value={stats.high_findings} tone={stats.high_findings ? "red" : undefined} />
      </div>

      {stats.policies === 0 && (
        <div className="card flex flex-col items-start gap-3 border-brand-500 bg-brand-50 p-5 md:flex-row md:items-center">
          <div className="flex-1">
            <div className="font-medium text-brand-900">Upload your internal policies to switch on impact analysis</div>
            <div className="text-sm text-brand-900/80">RegRadar will then check every new regulation against them and flag what needs to change.</div>
          </div>
          <Link to="/policies" className="btn-primary">Upload policies</Link>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Latest regulations</h2>
            <Link to="/regulations" className="text-sm text-brand-700 hover:underline">View all</Link>
          </div>
          {regs.length === 0 ? <p className="text-sm text-slate-500">Nothing indexed yet. An admin can run a sync from Settings.</p> : (
            <ul className="divide-y divide-slate-100">
              {regs.map((r) => (
                <li key={r.id} className="py-2.5">
                  <Link to={`/regulations/${r.id}`} className="text-sm font-medium text-slate-900 hover:text-brand-700">{r.title}</Link>
                  <div className="mt-1 flex flex-wrap gap-1"><Badge>{r.regulator ?? "Upload"}</Badge><Badge>{fmtDate(r.published_at)}</Badge>
                    {r.open_findings > 0 && <span className="text-xs font-medium text-red-600">{r.open_findings} finding(s)</span>}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">What needs attention</h2>
            <Link to="/impact" className="text-sm text-brand-700 hover:underline">All findings</Link>
          </div>
          {findings.length === 0 ? <p className="text-sm text-slate-500">No open findings.</p> : (
            <ul className="space-y-3">
              {findings.map((f) => (
                <li key={f.id} className="text-sm">
                  <div className="flex items-center gap-2"><Severity level={f.severity} /><span className="truncate text-xs text-slate-500">{f.policy_title}</span></div>
                  <p className="mt-1 text-slate-800">{f.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
