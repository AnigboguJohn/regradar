/** Companies: searchable list, and one company's page with its users and recent activity. */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ConfirmDialog } from "../../components/Menu";
import { Avatar, ErrorNote, Spinner } from "../../components/ui";
import { adminApi, adminPatch } from "../adminApi";
import { ago, EmptyRow, fmtWhen, PageHeader, Pager, Panel, SearchBox, StatTile, StatusPill, td, th } from "../ui";
import { Flash, UserActions } from "./UserActions";

export function AdminCompanies() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      adminApi(`/companies?q=${encodeURIComponent(q)}&status=${status}&page=${page}`).then(setData).catch((e) => setError(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q, status, page]);

  return (
    <>
      <PageHeader title="Companies" description="Every organisation using RegRadar." />
      <ErrorNote error={error} />
      <Panel flush>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-4">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by company name or a user's email" />
          <select className="input w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            <option value="all">All companies</option><option value="active">Active</option><option value="suspended">Suspended</option>
          </select>
        </div>
        {!data ? <div className="p-5"><Spinner /></div> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/70"><tr>
                  <th className={th}>Company</th><th className={th}>Users</th><th className={th}>Questions</th>
                  <th className={th}>Policies</th><th className={th}>Last active</th><th className={th}>Status</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.companies.length === 0 && <EmptyRow cols={6}>No companies match.</EmptyRow>}
                  {data.companies.map((c: any) => (
                    <tr key={c.id} className="hover:bg-slate-50/60">
                      <td className={td}>
                        <Link to={`/admin/companies/${c.id}`} className="font-medium text-slate-900 hover:text-brand-700">{c.name}</Link>
                        <div className="text-xs text-slate-500">joined {fmtWhen(c.created_at)}</div>
                      </td>
                      <td className={`${td} tabular-nums`}>{c.users}</td>
                      <td className={`${td} tabular-nums`}>{c.questions}</td>
                      <td className={`${td} tabular-nums`}>{c.policies}</td>
                      <td className={`${td} text-slate-600`}>{ago(c.last_active)}</td>
                      <td className={td}>{c.suspended_at ? <StatusPill tone="bad">Suspended</StatusPill> : <StatusPill tone="good">Active</StatusPill>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
          </>
        )}
      </Panel>
    </>
  );
}

export function AdminCompany() {
  const { id = "" } = useParams();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const load = () => adminApi(`/companies/${id}`).then(setD).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]);

  if (error) return <ErrorNote error={error} />;
  if (!d) return <Spinner />;
  const c = d.company;

  const toggleSuspend = async () => {
    try {
      await adminPatch(`/companies/${c.id}`, { suspended: !c.suspended_at });
      setMsg({ text: c.suspended_at ? `${c.name} is active again.` : `${c.name} is suspended. Its users can't sign in.` });
      load();
    } catch (e) { setMsg({ text: (e as Error).message, error: true }); }
  };

  return (
    <>
      <Link to="/admin/companies" className="text-sm text-brand-700 hover:underline">← All companies</Link>
      <div className="mt-2">
        <PageHeader title={c.name} description={`Joined ${fmtWhen(c.created_at)}`}
          actions={<>
            {c.suspended_at ? <StatusPill tone="bad">Suspended {ago(c.suspended_at)}</StatusPill> : <StatusPill tone="good">Active</StatusPill>}
            {c.suspended_at
              ? <button className="btn-primary" onClick={toggleSuspend}>Unsuspend company</button>
              : <button className="btn border border-red-200 bg-white text-red-600 hover:bg-red-50" onClick={() => setConfirm(true)}>Suspend company</button>}
          </>} />
      </div>
      <Flash msg={msg} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Questions asked" value={c.questions} />
        <StatTile label="Policies uploaded" value={c.policies} />
        <StatTile label="Private regulations" value={c.private_regulations} />
        <StatTile label="Open impact findings" value={c.open_findings} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Users" description={`${d.users.length} ${d.users.length === 1 ? "person" : "people"}`} flush>
          <ul className="divide-y divide-slate-100">
            {d.users.map((u: any) => (
              <li key={u.id} className="flex items-center gap-3 px-5 py-3">
                <Avatar name={u.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">{u.name}</div>
                  <div className="truncate text-xs text-slate-500">{u.email} · last sign-in {ago(u.last_login)}</div>
                </div>
                {u.suspended_at && <StatusPill tone="bad">Suspended</StatusPill>}
                <span className={`rounded-md px-2 py-0.5 text-xs font-medium capitalize ${u.role === "admin" ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-600"}`}>{u.role}</span>
                <UserActions u={u} onDone={load} onMessage={setMsg} />
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Recent activity" flush>
          <ul className="divide-y divide-slate-100">
            {d.activity.length === 0 && <li className="px-5 py-8 text-center text-sm text-slate-500">No activity yet.</li>}
            {d.activity.map((a: any) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="min-w-0 truncate"><span className="text-slate-900">{a.user_name ?? "System"}</span> <span className="text-slate-500">{a.action.replace(/_/g, " ")}</span></span>
                <span className="shrink-0 text-xs text-slate-500">{ago(a.created_at)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {confirm && (
        <ConfirmDialog title={`Suspend ${c.name}?`} confirmLabel="Suspend company" danger onCancel={() => setConfirm(false)}
          onConfirm={async () => { await toggleSuspend(); setConfirm(false); }}>
          All {d.users.length} of its users are signed out and blocked straight away. Nothing is deleted, and you can unsuspend it any time.
        </ConfirmDialog>
      )}
    </>
  );
}
