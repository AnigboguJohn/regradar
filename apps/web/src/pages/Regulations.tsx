/**
 * Regulations feed (search, paging, manual upload) and the detail page for one
 * regulation: its indexed text plus the button that runs impact analysis
 * against the company's policies.
 */
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, Empty, ErrorNote, Severity, Spinner } from "../components/ui";
import { api, fmtDate, post } from "../lib/api";

export function Regulations() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  const load = (p = page, query = q) =>
    api(`/regulations?page=${p}&q=${encodeURIComponent(query)}`).then((r) => setRows(r.regulations)).catch((e) => setError(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page]);

  const search = (e: FormEvent) => { e.preventDefault(); setPage(1); load(1, q); };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">Regulations</h1>
          <p className="mt-1 text-sm text-slate-500">Monitored automatically from regulator websites, newest first.</p>
        </div>
        <button className="btn-ghost" onClick={() => setShowUpload(!showUpload)}>Add a regulation manually</button>
      </div>
      {showUpload && <UploadRegulation onDone={() => { setShowUpload(false); load(1); }} />}
      <form onSubmit={search} className="flex gap-2">
        <input className="input" placeholder="Search by title or reference number" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-ghost">Search</button>
      </form>
      <ErrorNote error={error} />
      {!rows ? <Spinner /> : rows.length === 0 ? <Empty title="No regulations found" /> : (
        <div className="card divide-y divide-slate-100">
          {rows.map((r) => (
            <Link key={r.id} to={`/regulations/${r.id}`} className="flex flex-col gap-1 p-4 hover:bg-slate-50 md:flex-row md:items-center md:gap-4">
              <div className="flex-1">
                <div className="font-medium text-slate-900">{r.title}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge>{r.regulator ?? "Uploaded"}</Badge>{r.ref_no && <Badge>{r.ref_no}</Badge>}{r.private && <Badge>Private</Badge>}
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm text-slate-500">
                {r.open_findings > 0 && <span className="font-medium text-red-600">{r.open_findings} finding(s)</span>}
                <span className="tabular-nums">{fmtDate(r.published_at)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      <div className="flex justify-between">
        <button className="btn-ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>← Newer</button>
        <button className="btn-ghost" disabled={!rows || rows.length < 25} onClick={() => setPage(page + 1)}>Older →</button>
      </div>
    </div>
  );
}

function UploadRegulation({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api("/regulations/upload", { method: "POST", body: new FormData(e.currentTarget) });
      onDone();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="card grid gap-3 p-5 md:grid-cols-2">
      <div className="md:col-span-2"><ErrorNote error={error} /></div>
      <div><label className="label">Title</label><input name="title" className="input" required /></div>
      <div><label className="label">Regulator</label><input name="regulator" className="input" placeholder="e.g. SEC, NDPC, FCA" /></div>
      <div><label className="label">Reference no.</label><input name="ref_no" className="input" /></div>
      <div><label className="label">Date issued</label><input name="published_at" type="date" className="input" /></div>
      <div className="md:col-span-2"><label className="label">File (PDF, DOCX, TXT)</label><input name="file" type="file" accept=".pdf,.docx,.txt,.md" required className="file-input" /></div>
      <div className="md:col-span-2"><button className="btn-primary" disabled={busy}>{busy ? "Indexing…" : "Add regulation"}</button>
        <span className="ml-3 text-xs text-slate-500">Visible only to your organisation.</span></div>
    </form>
  );
}

export function RegulationDetail() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = () => api(`/regulations/${id}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // Run impact analysis for this regulation, then reload so new findings appear on the page.
  const analyse = async () => {
    setRunning(true); setError(null);
    try { await post("/impact/run", { regulationId: id }); await load(); }
    catch (e) { setError((e as Error).message); } finally { setRunning(false); }
  };

  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;
  const r = data.regulation;
  return (
    <div className="space-y-5">
      <Link to="/regulations" className="text-sm text-brand-700 hover:underline">← All regulations</Link>
      <div>
        <h1 className="h1">{r.title}</h1>
        <div className="mt-2 flex flex-wrap gap-1"><Badge>{r.regulator ?? "Uploaded"}</Badge>{r.ref_no && <Badge>{r.ref_no}</Badge>}<Badge>Issued {fmtDate(r.published_at)}</Badge>{r.page_count && <Badge>{r.page_count} pages</Badge>}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {r.url && <a className="btn-ghost" href={r.url} target="_blank" rel="noreferrer">Open original ↗</a>}
          <button className="btn-primary" onClick={analyse} disabled={running}>{running ? "Checking your policies…" : "Check impact on our policies"}</button>
        </div>
      </div>
      <ErrorNote error={error} />
      {data.findings.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Impact on your policies</h2>
          <ul className="space-y-3">
            {data.findings.map((f: any) => (
              <li key={f.id} className="text-sm">
                <div className="flex items-center gap-2"><Severity level={f.severity} /><span className="text-xs text-slate-500">{f.policy_title}</span>{f.status !== "open" && <Badge>{f.status}</Badge>}</div>
                <p className="mt-1 text-slate-800">{f.summary}</p>
                {f.recommendation && <p className="mt-1 text-slate-600"><span className="font-medium">Recommended:</span> {f.recommendation}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="card p-5">
        <h2 className="mb-3 font-semibold">Indexed text</h2>
        <div className="space-y-4 text-sm leading-relaxed text-slate-700">
          {data.chunks.map((c: any) => (
            <div key={c.ordinal}>
              {c.heading && <div className="font-semibold text-slate-900">{c.heading}</div>}
              <p className="whitespace-pre-line">{c.content}</p>
              {c.page && <div className="mt-1 text-xs text-slate-500">Page {c.page}</div>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
