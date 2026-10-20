/**
 * Activity & audit: every company's audit log in one place (filter by company, action,
 * person and dates; export to CSV), plus a separate log of what admins did in this console.
 */
import { useEffect, useState } from "react";
import { Icon } from "../../components/icons";
import { ErrorNote, Spinner } from "../../components/ui";
import { adminApi, adminDownload } from "../adminApi";
import { EmptyRow, fmtWhen, PageHeader, Pager, Panel, SearchBox, td, th } from "../ui";

const pretty = (a: string) => a.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const detailText = (d: any) => {
  if (!d) return "";
  const { ip, ...rest } = d;
  const s = Object.entries(rest).filter(([, v]) => v !== null && v !== "" && typeof v !== "object").map(([k, v]) => `${k}: ${v}`).join(" · ");
  return [s, ip ? `IP ${ip}` : ""].filter(Boolean).join(" · ");
};

export default function AdminActivity() {
  const [tab, setTab] = useState<"company" | "admin">("company");
  return (
    <>
      <PageHeader title="Activity & audit" description="Who did what, when. Kept for compliance and investigations." />
      <div className="mb-4 inline-flex rounded-xl bg-slate-200/60 p-1 text-sm" role="tablist">
        {([["company", "Company activity"], ["admin", "Admin actions"]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-lg px-3.5 py-1.5 font-medium ${tab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>{label}</button>
        ))}
      </div>
      {tab === "company" ? <CompanyActivity /> : <AdminActions />}
    </>
  );
}

function CompanyActivity() {
  const [f, setF] = useState({ q: "", action: "", from: "", to: "", company: "" });
  const [companies, setCompanies] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const qs = () => new URLSearchParams({ ...f, page: String(page) }).toString();

  useEffect(() => { adminApi("/companies?page=1").then((r) => setCompanies(r.companies)).catch(() => undefined); }, []);
  useEffect(() => {
    const t = setTimeout(() => adminApi(`/audit?${qs()}`).then(setData).catch((e) => setError(e.message)), 200);
    return () => clearTimeout(t);
  }, [f, page]);
  const set = (k: keyof typeof f) => (v: string) => { setF({ ...f, [k]: v }); setPage(1); };

  const exportCsv = async () => {
    setExporting(true);
    try { await adminDownload(`/audit.csv?${qs()}`, "regradar-audit.csv"); } catch (e) { setError((e as Error).message); } finally { setExporting(false); }
  };

  return (
    <Panel flush>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
        <SearchBox value={f.q} onChange={set("q")} placeholder="Search person or company" />
        <select className="input w-auto" value={f.company} onChange={(e) => set("company")(e.target.value)} aria-label="Company">
          <option value="">All companies</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input w-auto" value={f.action} onChange={(e) => set("action")(e.target.value)} aria-label="Action">
          <option value="">All actions</option>
          {(data?.actions ?? []).map((a: string) => <option key={a} value={a}>{pretty(a)}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">From <input type="date" className="input w-auto" value={f.from} onChange={(e) => set("from")(e.target.value)} /></label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">to <input type="date" className="input w-auto" value={f.to} onChange={(e) => set("to")(e.target.value)} /></label>
        <button className="btn-ghost ml-auto" onClick={exportCsv} disabled={exporting}><Icon name="download" /> {exporting ? "Exporting…" : "Export CSV"}</button>
      </div>
      <ErrorNote error={error} />
      {!data ? <div className="p-5"><Spinner /></div> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/70"><tr><th className={th}>When</th><th className={th}>Company</th><th className={th}>Who</th><th className={th}>What</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.events.length === 0 && <EmptyRow cols={4}>No activity matches these filters.</EmptyRow>}
                {data.events.map((e: any) => (
                  <tr key={e.id} className="hover:bg-slate-50/60">
                    <td className={`${td} whitespace-nowrap text-slate-500`}>{fmtWhen(e.created_at)}</td>
                    <td className={td}>{e.org_name ?? "—"}</td>
                    <td className={td}><div className="text-slate-900">{e.user_name ?? "System"}</div>{e.user_email && <div className="text-xs text-slate-500">{e.user_email}</div>}</td>
                    <td className={td}><div className="text-slate-900">{pretty(e.action)}</div><div className="text-xs text-slate-500">{detailText(e.details)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
        </>
      )}
    </Panel>
  );
}

function AdminActions() {
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState<any[] | null>(null);
  useEffect(() => { adminApi(`/admin-audit?page=${page}`).then((r) => setEvents(r.events)).catch(() => setEvents([])); }, [page]);
  return (
    <Panel flush>
      {!events ? <div className="p-5"><Spinner /></div> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/70"><tr><th className={th}>When</th><th className={th}>Admin</th><th className={th}>What</th><th className={th}>From</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {events.length === 0 && <EmptyRow cols={4}>No admin actions yet.</EmptyRow>}
                {events.map((e) => (
                  <tr key={e.id} className={e.action.endsWith("_failed") ? "bg-red-50/40" : "hover:bg-slate-50/60"}>
                    <td className={`${td} whitespace-nowrap text-slate-500`}>{fmtWhen(e.created_at)}</td>
                    <td className={td}>{e.admin_name ?? <span className="text-slate-500">Unknown ({e.details?.email ?? "no account"})</span>}</td>
                    <td className={td}><div className="text-slate-900">{pretty(e.action)}</div><div className="text-xs text-slate-500">{detailText(e.details)}</div></td>
                    <td className={`${td} text-slate-500`}>{e.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
            <button className="btn-ghost px-3 py-1.5" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <button className="btn-ghost px-3 py-1.5" disabled={events.length < 50} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </>
      )}
    </Panel>
  );
}
