/** Pure helpers for deciding who gets alerted and what the email says (unit tested). */

export type AlertSettings = {
  emails: string[];
  regulators: string[];
  keywords: string[];
  enabled: boolean;
}

export type NewDoc = {
  id: string;
  title: string;
  regulator: string | null;
  ref_no: string | null;
  published_at: string | null;
  url: string | null;
}

export type FindingSummary = {
  regulation_id: string;
  severity: string;
  summary: string;
}

export function matchesAlert(s: AlertSettings, doc: NewDoc): boolean {
  if (!s.enabled || s.emails.length === 0) return false;
  if (s.regulators.length && !s.regulators.map((r) => r.toUpperCase()).includes((doc.regulator ?? "").toUpperCase())) {
    return false;
  }
  if (s.keywords.length) {
    const t = doc.title.toLowerCase();
    return s.keywords.some((k) => k.trim() && t.includes(k.trim().toLowerCase()));
  }
  return true;
}

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };

export function buildDigest(docs: NewDoc[], findings: FindingSummary[], appUrl: string) {
  const high = findings.filter((f) => f.severity === "high").length;
  const subject =
    `RegRadar: ${docs.length} new regulation${docs.length === 1 ? "" : "s"}` +
    (high ? ` · ${high} high-impact finding${high === 1 ? "" : "s"}` : "");
  const lines: string[] = [];
  for (const d of docs) {
    lines.push(`• ${d.title}`);
    const meta = [d.regulator, d.ref_no, d.published_at].filter(Boolean).join(" · ");
    if (meta) lines.push(`  ${meta}`);
    if (d.url) lines.push(`  ${d.url}`);
    const fs = findings
      .filter((f) => f.regulation_id === d.id)
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
    for (const f of fs) lines.push(`  [${f.severity.toUpperCase()}] ${f.summary}`);
    lines.push("");
  }
  lines.push(`Review and ask questions: ${appUrl}`);
  return { subject, text: lines.join("\n") };
}
