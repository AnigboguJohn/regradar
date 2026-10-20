/**
 * Renders an AI answer with clickable citations.
 * The answer text contains markers like [1] or [2]; each becomes a button that
 * opens the matching source below (document, reference number, page and the exact
 * excerpt), so users can check every claim against the original regulation.
 */
import { Fragment, useState, type ReactNode } from "react";
import { fmtDate, type Citation } from "../lib/api";
import { Badge } from "./ui";

/** Render **bold** and [n] citation markers inside one line of text. */
function inline(text: string, onCite: (n: number) => void, known: Set<number>): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d{1,2}\])/g);
  return parts.map((p, i) => {
    const cite = p.match(/^\[(\d{1,2})\]$/);
    if (cite && known.has(Number(cite[1]))) {
      const n = Number(cite[1]);
      return (
        <button key={i} onClick={() => onCite(n)} title={`Show source ${n}`}
          className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-brand-100 px-1 align-text-top text-[11px] font-semibold text-brand-900 hover:bg-brand-500 hover:text-white">
          {n}
        </button>
      );
    }
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

export function Answer({ text, citations }: { text: string; citations: Citation[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const known = new Set(citations.map((c) => c.n));
  const lines = text.split("\n");

  return (
    <div>
      <div className="space-y-2 text-[15px] leading-relaxed text-slate-800">
        {lines.map((line, i) => {
          const t = line.trim();
          if (!t) return null;
          if (/^#{1,3}\s/.test(t)) return <p key={i} className="pt-2 font-semibold">{inline(t.replace(/^#+\s/, ""), setOpen, known)}</p>;
          if (/^[-*•]\s/.test(t)) return <p key={i} className="pl-4 -indent-3">• {inline(t.slice(2), setOpen, known)}</p>;
          if (t === "This is not legal advice.") return <p key={i} className="pt-1 text-xs italic text-slate-500">{t}</p>;
          return <p key={i}>{inline(t, setOpen, known)}</p>;
        })}
      </div>

      {citations.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sources</div>
          {citations.map((c) => (
            <div key={c.n} className={`rounded-lg border p-3 text-sm ${open === c.n ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>
              <button className="flex w-full items-start gap-2 text-left" onClick={() => setOpen(open === c.n ? null : c.n)}>
                <span className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-slate-800 px-1 text-[11px] font-semibold text-white">{c.n}</span>
                <span className="flex-1">
                  <span className="font-medium text-slate-900">{c.title}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {c.kind === "policy" ? <Badge>Your policy</Badge> : c.regulator && <Badge>{c.regulator}</Badge>}
                    {c.ref_no && <Badge>{c.ref_no}</Badge>}
                    {c.published_at && <Badge>{fmtDate(c.published_at)}</Badge>}
                    {c.page && <Badge>p. {c.page}</Badge>}
                  </span>
                </span>
              </button>
              {open === c.n && (
                <div className="mt-2 pl-7">
                  <blockquote className="border-l-2 border-brand-500 pl-3 text-slate-700">{c.excerpt}{c.excerpt.length >= 600 ? "…" : ""}</blockquote>
                  {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-medium text-brand-700 hover:underline">Open original document ↗</a>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
