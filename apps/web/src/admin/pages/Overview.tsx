/** Admin overview: platform-wide numbers, 30-day sign-up and question trends, newest companies. */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ErrorNote, Spinner } from "../../components/ui";
import { adminApi } from "../adminApi";
import { ago, Callout, DailyBars, PageHeader, Panel, StatTile } from "../ui";

export default function AdminOverview() {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { adminApi("/overview").then(setD).catch((e) => setError(e.message)); }, []);
  if (error) return <ErrorNote error={error} />;
  if (!d) return <Spinner />;
  const t = d.totals;

  return (
    <>
      <PageHeader title="Overview" description="Everything happening across RegRadar, all companies together." />
      {t.alerts_firing > 0 && (
        <div className="mb-3">
          <Callout><strong>{t.alerts_firing} alert(s) firing.</strong> <Link to="/admin/health" className="font-semibold underline">See System health</Link>.</Callout>
        </div>
      )}
      {t.regulations_failed > 0 && (
        <div className="mb-5">
          <Callout>
            <strong>{t.regulations_failed} regulator circulars failed to download</strong>, so no company can search them yet.{" "}
            <Link to="/admin/regulations?status=failed" className="font-semibold underline">Fix them in Regulations & sync</Link>.
          </Callout>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Companies" value={t.companies} note={t.companies_suspended ? `${t.companies_suspended} suspended` : "none suspended"} />
        <StatTile label="Users" value={t.users} note={`${t.users_new_7d} new · ${t.users_active_7d} signed in this week`} />
        <StatTile label="Questions to Remi" value={t.questions} note={`${t.questions_7d} in the last 7 days`} />
        <StatTile label="Regulations searchable" value={t.regulations_public} note={`${t.regulations_private} private company uploads`} tone={t.regulations_public === 0 ? "warn" : undefined} />
        <StatTile label="Failed downloads" value={t.regulations_failed} tone={t.regulations_failed ? "warn" : undefined} note="regulator circulars" />
        <StatTile label="Company policies" value={t.policies} />
        <StatTile label="Open impact findings" value={t.findings_open} />
        <StatTile label="Open errors" value={<Link to="/admin/errors" className="hover:underline">{t.errors_open}</Link>} note={`${t.errors_24h} seen in the last 24 h`} tone={t.errors_open ? "warn" : undefined} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Sign-ups" description="New users per day, last 30 days">
          <DailyBars label="Sign-ups" data={d.daily.map((x: any) => ({ day: x.day, value: x.signups }))} />
        </Panel>
        <Panel title="Questions" description="Questions asked to Remi per day, last 30 days">
          <DailyBars label="Questions" data={d.daily.map((x: any) => ({ day: x.day, value: x.questions }))} />
        </Panel>
      </div>

      <div className="mt-5">
        <Panel title="Newest companies" actions={<Link to="/admin/companies" className="text-sm font-medium text-brand-700 hover:underline">All companies</Link>} flush>
          <ul className="divide-y divide-slate-100">
            {d.recentCompanies.map((c: any) => (
              <li key={c.id}>
                <Link to={`/admin/companies/${c.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                  <span className="truncate text-sm font-medium text-slate-900">{c.name}</span>
                  <span className="shrink-0 text-xs text-slate-500">{c.users} {c.users === 1 ? "user" : "users"} · joined {ago(c.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
