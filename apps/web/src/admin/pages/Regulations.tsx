/**
 * Regulations & sync: every regulation (regulator feed and company uploads), failed
 * downloads with the reason, "Attach PDF" to fix a failed one, publishing a circular for
 * every company, a manual regulator check, and the history of automatic checks.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Icon } from "../../components/icons";
import { ConfirmDialog } from "../../components/Menu";
import { ErrorNote, Spinner } from "../../components/ui";
import { adminApi, adminDelete, adminPost } from "../adminApi";
import { ago, EmptyRow, fmtWhen, PageHeader, Pager, Panel, SearchBox, StatusPill, td, th } from "../ui";
import { Flash } from "./UserActions";

export default function AdminRegulations() {
  const [params] = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(params.get("status") ?? "all");
  const [scope, setScope] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [runs, setRuns] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachTarget = useRef<any>(null);

  const load = () => {
    adminApi(`/regulations?q=${encodeURIComponent(q)}&status=${status}&scope=${scope}&page=${page}`).then(setData).catch((e) => setError(e.message));
    adminApi("/ingest-runs").then((r) => setRuns(r.runs)).catch(() => setRuns([]));
  };
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [q, status, scope, page]);

  const sync = async () => {
    setBusy("sync"); setMsg(null);
    try {
      const r = await adminPost("/sync", {});
      const failed = (r.runs ?? []).reduce((n: number, run: any) => n + (run.failed?.length ?? 0), 0);
      setMsg(r.skipped ? { text: "A check is already running. Try again in a few minutes." }
        : { text: `Check finished: ${r.newDocuments ?? 0} new regulation(s) indexed.${failed ? ` ${failed} failed to download (see the Failed filter).` : ""}` });
      load();
    } catch (e) { setMsg({ text: (e as Error).message, error: true }); } finally { setBusy(null); }
  };

  const pickFile = (r: any) => { attachTarget.current = r; fileInput.current?.click(); };
  const attach = async (file: File) => {
    const r = attachTarget.current;
    setBusy(r.id); setMsg(null);
    const form = new FormData(); form.append("file", file);
    try {
      await adminApi(`/regulations/${r.id}/attach`, { method: "POST", body: form });
      setMsg({ text: `“${r.title}” is now searchable for every company.` });
      load();
    } catch (e) { setMsg({ text: (e as Error).message, error: true }); } finally { setBusy(null); }
  };

  const c = data?.counts;
  return (
    <>
      <PageHeader title="Regulations & sync" description="What Remi can search, where it came from, and what failed."
        actions={<>
          <button className="btn-ghost" onClick={() => setPublishOpen(!publishOpen)}><Icon name="plus" /> Publish a circular</button>
          <button className="btn-primary" onClick={sync} disabled={busy === "sync"}><Icon name="refresh" /> {busy === "sync" ? "Checking regulators…" : "Check regulators now"}</button>
        </>} />
      <Flash msg={msg} />
      <ErrorNote error={error} />
      {publishOpen && <PublishForm onDone={(t) => { setPublishOpen(false); setMsg({ text: t }); load(); }} />}

      <input ref={fileInput} type="file" accept=".pdf,.docx,.txt,.md" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) attach(f); }} />

      <Panel flush>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-4">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by title or reference number" />
          <select className="input w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            <option value="all">Any status{c ? ` (${c.ready + c.failed})` : ""}</option>
            <option value="ready">Searchable{c ? ` (${c.ready})` : ""}</option>
            <option value="failed">Failed{c ? ` (${c.failed})` : ""}</option>
          </select>
          <select className="input w-auto" value={scope} onChange={(e) => { setScope(e.target.value); setPage(1); }} aria-label="Source">
            <option value="all">All sources</option>
            <option value="public">Regulator feed & published{c ? ` (${c.public})` : ""}</option>
            <option value="private">Company uploads{c ? ` (${c.private})` : ""}</option>
          </select>
        </div>
        {status === "failed" && (
          <p className="border-b border-slate-100 bg-amber-50/60 px-5 py-2.5 text-sm text-amber-900">
            Download each failed circular in your browser using its link, then use <strong>Attach PDF</strong>. The text becomes searchable for every company.
          </p>
        )}
        {!data ? <div className="p-5"><Spinner /></div> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/70"><tr>
                  <th className={th}>Regulation</th><th className={th}>Published</th><th className={th}>Source</th><th className={th}>Status</th><th className={th}><span className="sr-only">Actions</span></th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.regulations.length === 0 && <EmptyRow cols={5}>No regulations match.</EmptyRow>}
                  {data.regulations.map((r: any) => (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <td className={`${td} max-w-md`}>
                        <div className="font-medium text-slate-900">{r.title}</div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {[r.regulator, r.ref_no].filter(Boolean).join(" · ")}
                          {r.url && <> · <a href={r.url} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">original ↗</a></>}
                        </div>
                        {r.status === "failed" && r.error && <div className="mt-1 text-xs text-red-600">{r.error.split("\n")[0].replace(/ for url .*/, "")}</div>}
                      </td>
                      <td className={`${td} whitespace-nowrap text-slate-600`}>{r.published_at ? fmtWhen(r.published_at).split(",").slice(0, 2).join(",") : "—"}</td>
                      <td className={`${td} text-slate-600`}>{r.org_id ? <>Uploaded by <span className="text-slate-900">{r.org_name}</span> (private)</> : r.source_id === "upload" ? "Published by admin" : "Regulator feed"}</td>
                      <td className={td}>
                        {r.status === "ready" ? <StatusPill tone="good">Searchable · {r.chunks} passages</StatusPill> : <StatusPill tone="bad">Failed</StatusPill>}
                      </td>
                      <td className={`${td} whitespace-nowrap text-right`}>
                        {!r.org_id && (
                          <button className="btn-ghost px-2.5 py-1 text-xs" disabled={busy === r.id} onClick={() => pickFile(r)}>
                            {busy === r.id ? "Indexing…" : r.status === "failed" ? "Attach PDF" : "Replace file"}
                          </button>
                        )}
                        <button className="ml-1 rounded-lg p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600" aria-label={`Delete ${r.title}`} onClick={() => setConfirmDelete(r)}>
                          <Icon name="trash" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
          </>
        )}
      </Panel>

      <div className="mt-5">
        <Panel title="Automatic checks" description="Each run looks for new circulars from the regulators' websites." flush>
          {!runs ? <div className="p-5"><Spinner /></div> : (
            <ul className="divide-y divide-slate-100">
              {runs.length === 0 && <li className="px-5 py-8 text-center text-sm text-slate-500">No checks have run yet.</li>}
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <span className="text-slate-900">{fmtWhen(r.started_at)} <span className="text-slate-500">· {r.source_id}</span></span>
                  {r.error ? <StatusPill tone="bad">Error: {r.error.slice(0, 60)}</StatusPill>
                    : !r.finished_at ? <StatusPill tone="warn">Started {ago(r.started_at)}, not finished</StatusPill>
                    : <StatusPill tone={r.new_docs ? "good" : "neutral"}>{r.new_docs} new</StatusPill>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {confirmDelete && (
        <ConfirmDialog title="Delete this regulation?" confirmLabel="Delete" danger onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            try { await adminDelete(`/regulations/${confirmDelete.id}`); setMsg({ text: `Deleted “${confirmDelete.title}”.` }); load(); }
            catch (e) { setMsg({ text: (e as Error).message, error: true }); }
            setConfirmDelete(null);
          }}>
          “{confirmDelete.title}” and its impact findings are removed for {confirmDelete.org_id ? confirmDelete.org_name : "every company"}.
          {!confirmDelete.org_id && confirmDelete.source_id !== "upload" && " The next automatic check may download it again."}
        </ConfirmDialog>
      )}
    </>
  );
}

function PublishForm({ onDone }: { onDone: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const form = new FormData(e.currentTarget);
      await adminApi("/regulations/upload", { method: "POST", body: form });
      onDone(`“${form.get("title") || (form.get("file") as File).name}” is published and searchable for every company.`);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="mb-5">
      <Panel title="Publish a circular for every company" description="Use this for circulars the automatic check can't download. Company uploads stay private; this one is shared.">
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2"><ErrorNote error={error} /></div>
          <label className="text-sm font-medium text-slate-700 md:col-span-2">Title<input name="title" required className="input mt-1.5" placeholder="e.g. Revised Tier 1 KYC Account Limits" /></label>
          <label className="text-sm font-medium text-slate-700">Regulator<input name="regulator" className="input mt-1.5" placeholder="CBN" defaultValue="CBN" /></label>
          <label className="text-sm font-medium text-slate-700">Reference number<input name="ref_no" className="input mt-1.5" placeholder="BSD/DIR/GEN/..." /></label>
          <label className="text-sm font-medium text-slate-700">Date issued<input name="published_at" type="date" className="input mt-1.5" /></label>
          <label className="text-sm font-medium text-slate-700">File (PDF, DOCX or TXT)<input name="file" type="file" required accept=".pdf,.docx,.txt,.md" className="file-input mt-2 block" /></label>
          <div className="md:col-span-2"><button className="btn-primary" disabled={busy}>{busy ? "Indexing…" : "Publish"}</button></div>
        </form>
      </Panel>
    </div>
  );
}
