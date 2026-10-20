/** Building blocks shared by the admin console pages. */
import { useState, type ReactNode } from "react";
import { Icon } from "../components/icons";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, description, actions, children, flush }: {
  title?: string; description?: string; actions?: ReactNode; children: ReactNode; flush?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {title && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

export function StatTile({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: "warn" }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "warn" ? "text-amber-700" : "text-slate-900"}`}>{value}</div>
      {note && <div className="mt-0.5 text-xs text-slate-500">{note}</div>}
    </div>
  );
}

/** Status with a word and a dot, never colour alone. */
export function StatusPill({ tone, children }: { tone: "good" | "warn" | "bad" | "neutral"; children: ReactNode }) {
  const t = { good: "bg-emerald-50 text-emerald-800 [--dot:#059669]", warn: "bg-amber-50 text-amber-800 [--dot:#d97706]",
    bad: "bg-red-50 text-red-700 [--dot:#dc2626]", neutral: "bg-slate-100 text-slate-600 [--dot:#94a3b8]" }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${t}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--dot)]" aria-hidden />{children}
    </span>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative min-w-[14rem] flex-1">
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
        <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" strokeLinecap="round" />
      </svg>
      <input className="input pl-9" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />
    </div>
  );
}

export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
      <span>{total === 0 ? "No results" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}</span>
      <div className="flex gap-2">
        <button className="btn-ghost px-3 py-1.5" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <button className="btn-ghost px-3 py-1.5" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

export const th = "px-5 py-2.5 text-left text-xs font-medium text-slate-500";
export const td = "px-5 py-3 align-top";

export const fmtWhen = (d?: string | null) =>
  d ? new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export function ago(d?: string | null) {
  if (!d) return "never";
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}

/**
 * Daily bar chart for one series (sign-ups or questions per day). One colour, so no legend:
 * the panel title names it. Rounded tops sit on the baseline, gridlines stay faint, and every
 * bar has a hover tooltip with a hit area wider than the bar. A screen-reader table follows.
 */
export function DailyBars({ data, label }: { data: { day: string; value: number }[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 180, L = 32, B = 22, T = 12;
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const slot = (W - L) / data.length;
  const bw = Math.max(4, slot - 4);
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const day = (s: string) => new Date(s + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${label}: ${total} in the last ${data.length} days`}>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={L} x2={W} y1={y(step * i)} y2={y(step * i)} stroke={i === 0 ? "#cbd5e1" : "#f1f5f9"} strokeWidth={1} />
            <text x={L - 6} y={y(step * i) + 4} textAnchor="end" fontSize="10" fill="#64748b">{step * i}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = L + i * slot + (slot - bw) / 2;
          const h = Math.max(0, y(0) - y(d.value));
          const r = Math.min(4, bw / 2, h);
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={L + i * slot} y={T} width={slot} height={H - T - B} fill="transparent" />
              {h > 0 && (
                <path d={`M${x},${y(0)} V${y(d.value) + r} Q${x},${y(d.value)} ${x + r},${y(d.value)} H${x + bw - r} Q${x + bw},${y(d.value)} ${x + bw},${y(d.value) + r} V${y(0)} Z`}
                  fill="#7c3aed" opacity={hover === null || hover === i ? 1 : 0.45} />
              )}
              {/* A label every 7 days plus the last day, skipping weekly labels too close to the last one. */}
              {((i % 7 === 0 && data.length - 1 - i >= 4) || i === data.length - 1) && (
                <text x={L + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#64748b">{day(d.day)}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow"
          style={{ left: `${((L + hover * slot + slot / 2) / W) * 100}%` }}>
          <div className="text-slate-300">{day(data[hover].day)}</div>
          <div className="font-semibold tabular-nums">{data[hover].value} {label.toLowerCase()}</div>
        </div>
      )}
      <table className="sr-only">
        <caption>{label} per day</caption>
        <tbody>{data.map((d) => <tr key={d.day}><th>{d.day}</th><td>{d.value}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

export function EmptyRow({ cols, children }: { cols: number; children: ReactNode }) {
  return <tr><td colSpan={cols} className="px-5 py-10 text-center text-sm text-slate-500">{children}</td></tr>;
}

export function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
      <Icon name="bell" className="mt-0.5 h-4 w-4 shrink-0" /><div>{children}</div>
    </div>
  );
}
