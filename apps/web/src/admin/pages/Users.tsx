/** All users across every company, with search, filters and the per-user actions menu. */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Avatar, ErrorNote, Spinner } from "../../components/ui";
import { adminApi } from "../adminApi";
import { ago, EmptyRow, PageHeader, Pager, Panel, SearchBox, StatusPill, td, th } from "../ui";
import { Flash, UserActions } from "./UserActions";

export default function AdminUsers() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const load = () => adminApi(`/users?q=${encodeURIComponent(q)}&role=${role}&status=${status}&page=${page}`).then(setData).catch((e) => setError(e.message));

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [q, role, status, page]);

  return (
    <>
      <PageHeader title="Users" description="Everyone who can sign in to RegRadar, across all companies." />
      <Flash msg={msg} />
      <ErrorNote error={error} />
      <Panel flush>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-4">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by name, email or company" />
          <select className="input w-auto" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} aria-label="Role">
            <option value="">All roles</option><option value="admin">Admins</option><option value="member">Members</option>
          </select>
          <select className="input w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            <option value="all">Any status</option><option value="active">Active</option><option value="suspended">Suspended</option>
          </select>
        </div>
        {!data ? <div className="p-5"><Spinner /></div> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/70"><tr>
                  <th className={th}>User</th><th className={th}>Company</th><th className={th}>Role</th>
                  <th className={th}>Questions</th><th className={th}>Last sign-in</th><th className={th}>Status</th><th className={th}><span className="sr-only">Actions</span></th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.users.length === 0 && <EmptyRow cols={7}>No users match.</EmptyRow>}
                  {data.users.map((u: any) => (
                    <tr key={u.id} className="hover:bg-slate-50/60">
                      <td className={td}>
                        <div className="flex items-center gap-3">
                          <Avatar name={u.name} />
                          <div className="min-w-0"><div className="truncate font-medium text-slate-900">{u.name}</div><div className="truncate text-xs text-slate-500">{u.email}</div></div>
                        </div>
                      </td>
                      <td className={td}><Link to={`/admin/companies/${u.org_id}`} className="text-slate-700 hover:text-brand-700">{u.org_name}</Link></td>
                      <td className={`${td} capitalize`}>{u.role}</td>
                      <td className={`${td} tabular-nums`}>{u.questions}</td>
                      <td className={`${td} text-slate-600`}>{ago(u.last_login)}</td>
                      <td className={td}>
                        {u.suspended_at ? <StatusPill tone="bad">Suspended</StatusPill>
                          : u.org_suspended_at ? <StatusPill tone="warn">Company suspended</StatusPill>
                          : <StatusPill tone="good">Active</StatusPill>}
                      </td>
                      <td className={`${td} text-right`}><UserActions u={u} onDone={load} onMessage={setMsg} /></td>
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
