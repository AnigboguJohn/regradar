/**
 * Small shared UI pieces (severity badge, stat tile, empty state, error box,
 * spinner, demo banner) so every page looks and behaves the same way.
 */
import type { ReactNode } from "react";

const SEV: Record<string, string> = {
  high: "bg-red-50 text-red-700 ring-red-200",
  medium: "bg-amber-50 text-amber-800 ring-amber-200",
  low: "bg-sky-50 text-sky-700 ring-sky-200",
  info: "bg-slate-100 text-slate-700 ring-slate-200",
};

export function Severity({ level }: { level: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold uppercase ring-1 ring-inset ${SEV[level] ?? SEV.info}`}>
      {level}
    </span>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">{children}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card p-10 text-center">
      <p className="font-medium text-slate-800">{title}</p>
      {children && <div className="mt-2 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-700" />
      {label}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "red" }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums ${tone === "red" ? "text-red-600" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}

export function DemoBanner() {
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
      Demo preview with sample data. Nothing you enter leaves your browser, and the sample circulars are not real regulations.
    </div>
  );
}

/** Initials in a violet circle, standing in for a profile photo. */
export function Avatar({ name, size = "md" }: { name?: string; size?: "md" | "lg" }) {
  const letters = (name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 font-semibold text-white ${
      size === "lg" ? "h-16 w-16 text-xl" : "h-9 w-9 text-xs"}`}>
      {letters}
    </span>
  );
}

/** An on/off switch. */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-brand-600" : "bg-slate-300"}`}>
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`} />
    </button>
  );
}
