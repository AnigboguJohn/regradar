/**
 * The company's internal policies. Uploaded files are text-extracted and indexed
 * by the AI service, stay private to the organisation, and are compared with
 * every new regulation during impact analysis.
 */
import { useEffect, useState, type FormEvent } from "react";
import { Empty, ErrorNote, Spinner } from "../components/ui";
import { api, fmtDate } from "../lib/api";

export default function Policies() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api("/policies").then((r) => setRows(r.policies)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const upload = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true); setError(null);
    try {
      await api("/policies", { method: "POST", body: new FormData(form) });
      form.reset();
      await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  const [confirming, setConfirming] = useState<string | null>(null);
  const remove = async (id: string) => {
    if (confirming !== id) return setConfirming(id); // first click asks, second click deletes
    setConfirming(null);
    try { await api(`/policies/${id}`, { method: "DELETE" }); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">Our policies</h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload internal policies (KYC/AML, onboarding, data protection, FX…). They stay private to your organisation
          and are checked against every new regulation.
        </p>
      </div>
      <form onSubmit={upload} className="card flex flex-col gap-3 p-5 md:flex-row md:items-end">
        <div className="flex-1"><label className="label" htmlFor="ptitle">Title (optional)</label><input id="ptitle" name="title" className="input" placeholder="e.g. Customer Due Diligence Policy v3" /></div>
        <div><label className="label" htmlFor="pfile">File</label><input id="pfile" name="file" type="file" accept=".pdf,.docx,.txt,.md" required className="file-input" /></div>
        <button className="btn-primary" disabled={busy}>{busy ? "Indexing…" : "Upload"}</button>
      </form>
      <ErrorNote error={error} />
      {!rows ? <Spinner /> : rows.length === 0 ? (
        <Empty title="No policies yet">Upload your first policy to switch on impact analysis.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="p-3">Policy</th><th className="p-3">Sections</th><th className="p-3">Open findings</th><th className="p-3">Uploaded</th><th className="p-3" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="p-3 font-medium text-slate-900">{p.title}</td>
                  <td className="p-3 tabular-nums">{p.sections}</td>
                  <td className={`p-3 tabular-nums ${p.open_findings ? "font-semibold text-red-600" : ""}`}>{p.open_findings}</td>
                  <td className="p-3 text-slate-500">{fmtDate(p.ingested_at)}</td>
                  <td className="p-3 text-right"><button onClick={() => remove(p.id)} onBlur={() => setConfirming(null)}
                      className={`text-xs font-medium ${confirming === p.id ? "text-red-600" : "text-slate-500 hover:text-red-600"}`}>
                      {confirming === p.id ? "Confirm delete (removes its findings)" : "Delete"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
