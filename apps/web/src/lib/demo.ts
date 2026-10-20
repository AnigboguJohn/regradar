/**
 * Demo mode: an in-browser stand-in for the RegRadar API, used for the shareable preview
 * (build with VITE_DEMO=1). All data is clearly-labelled sample data, not real regulations.
 * Search and answers work the same way as the real service's no-AI mode: keyword retrieval
 * plus cited passages.
 */
import type { Citation } from "./api";

type Chunk = { id: number; docId: string; page: number; heading: string | null; content: string };
type Doc = {
  id: string; kind: "regulation" | "policy"; title: string; regulator: string | null; ref_no: string | null;
  url: string | null; published_at: string | null; ingested_at: string; page_count: number;
};
type Finding = {
  id: number; regulation_id: string; policy_id: string; severity: string; summary: string; recommendation: string;
  evidence: { policy_excerpt: string; policy_section: string | null; regulation_quote: string }; status: string; created_at: string;
};

const now = () => new Date().toISOString();
const today = new Date();
const daysAgo = (n: number) => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10);
let seq = 100;
const uid = () => `demo-${++seq}`;

const docs: Doc[] = [];
const chunks: Chunk[] = [];
const findings: Finding[] = [];
const history: any[] = [];
type DemoConversation = { id: string; title: string; created_at: string; updated_at: string; pinned_at: string | null; archived_at: string | null; deleted?: boolean };
const conversations: DemoConversation[] = [];
const invites: { id: string; email: string; role: string; created_at: string; expires_at: string; invited_by_name: string }[] = [];
const audit: any[] = [];
let user = { id: "u1", orgId: "o1", orgName: "Demo Bank Plc", email: "ada@demobank.example", name: "Ada Obi", role: "admin" as const };
let alerts = { emails: ["compliance@demobank.example"], regulators: [] as string[], keywords: ["KYC", "foreign exchange"], enabled: true };
const team = [
  { id: "u1", name: "Ada Obi", email: "ada@demobank.example", role: "admin", created_at: daysAgo(20) },
  { id: "u2", name: "Bayo Adeyemi", email: "bayo@demobank.example", role: "member", created_at: daysAgo(12) },
];

/** Split text on numbered / ALL-CAPS headings, like the real chunker (simplified). */
function chunkText(text: string): { heading: string | null; content: string }[] {
  const out: { heading: string | null; content: string }[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  const flush = () => { if (buf.join(" ").trim()) out.push({ heading, content: buf.join(" ").trim() }); buf = []; };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(\d+(\.\d+)*\.?\s+[A-Z][^.]{2,90}|[A-Z][A-Z0-9 ,&/()-]{4,90})$/.test(line)) { flush(); heading = line; continue; }
    buf.push(line);
  }
  flush();
  return out;
}

function addDoc(d: Omit<Doc, "id" | "ingested_at" | "page_count"> & { id?: string; ingested_at?: string }, text: string) {
  const id = d.id ?? uid();
  const parts = chunkText(text);
  docs.unshift({ ...d, id, ingested_at: d.ingested_at ?? now(), page_count: Math.max(1, Math.ceil(text.length / 2500)) });
  parts.forEach((p) => chunks.push({ id: ++seq, docId: id, page: 1, heading: p.heading, content: p.content }));
  return id;
}

// ---------------- Sample data (clearly labelled) ----------------
addDoc({ id: "reg-fx", kind: "regulation", title: "Sample Circular: Foreign Exchange Documentation for Bureau De Change Operators", regulator: "DEMO", ref_no: "DEMO/FX/2026/004", url: null, published_at: daysAgo(9) }, `SAMPLE CIRCULAR (DEMO DATA)
1. Purpose
This sample circular sets documentation requirements for foreign exchange purchases by bureau de change operators through authorised dealer banks.
2. Documentation
Each purchase request shall be supported by the customer's valid identification, Bank Verification Number and evidence of the purpose of the transaction.
3. Limits
No single customer may purchase more than USD 4,000 per quarter for personal travel allowance.
4. Reporting
Authorised dealer banks shall report all bureau de change transactions to the regulator weekly, every Monday by 12 noon.`);
addDoc({ id: "reg-kyc", kind: "regulation", title: "Sample Circular: Revised Tiered KYC Requirements", regulator: "DEMO", ref_no: "DEMO/KYC/2026/001", url: null, published_at: daysAgo(4) }, `SAMPLE CIRCULAR (DEMO DATA)
1. Introduction
This sample circular revises the tiered Know Your Customer (KYC) requirements for all deposit-taking institutions and payment service banks.
2. Tier 1 Accounts
Tier 1 accounts shall have a maximum single deposit of N50,000 and a maximum cumulative balance of N300,000. Tier 1 accounts may be opened without a Bank Verification Number (BVN) but must be linked to a verified phone number.
3. Tier 2 Accounts
Tier 2 accounts shall have a maximum single deposit of N100,000 and a maximum cumulative balance of N500,000. A BVN or National Identification Number (NIN) is mandatory.
4. Record Keeping
Institutions shall retain customer identification records for a minimum of ten (10) years after the end of the business relationship.
5. Effective Date
All institutions shall comply with this circular not later than 31 March 2027. Non-compliance shall attract sanctions.`);
addDoc({ id: "pol-kyc", kind: "policy", title: "Customer Onboarding & KYC Policy v2.1", regulator: null, ref_no: null, url: null, published_at: null, ingested_at: daysAgo(3) + "T10:00:00Z" }, `Customer Onboarding and KYC Policy (Demo Bank, v2.1)
1. Purpose
This policy sets out how Demo Bank verifies customers before opening accounts.
2. Account Tiers
Tier 1 savings accounts may receive single deposits of up to N100,000 and hold a maximum cumulative balance of N500,000. A BVN is not required for Tier 1.
3. Tier 2 Accounts
Tier 2 accounts require a BVN and allow a maximum cumulative balance of N500,000.
4. Record Retention
Customer identification records are retained for five (5) years after the account is closed.`);

const chunkOf = (docId: string, heading: string) => chunks.find((c) => c.docId === docId && c.heading === heading)!;
findings.push(
  { id: 1, regulation_id: "reg-kyc", policy_id: "pol-kyc", severity: "high", status: "open", created_at: daysAgo(3) + "T11:00:00Z",
    summary: "Tier 1 limits in the policy (N100,000 deposit, N500,000 balance) exceed the new caps of N50,000 and N300,000.",
    recommendation: "Lower Tier 1 limits to a N50,000 single deposit and N300,000 cumulative balance before 31 March 2027.",
    evidence: { policy_excerpt: chunkOf("pol-kyc", "2. Account Tiers").content, policy_section: "2. Account Tiers", regulation_quote: chunkOf("reg-kyc", "2. Tier 1 Accounts").content } },
  { id: 2, regulation_id: "reg-kyc", policy_id: "pol-kyc", severity: "medium", status: "open", created_at: daysAgo(3) + "T11:00:00Z",
    summary: "Records are kept for 5 years after closure; the circular requires at least 10 years.",
    recommendation: "Extend the retention period in section 4 to ten years after the end of the relationship.",
    evidence: { policy_excerpt: chunkOf("pol-kyc", "4. Record Retention").content, policy_section: "4. Record Retention", regulation_quote: chunkOf("reg-kyc", "4. Record Keeping").content } },
);
audit.push(
  { id: 3, action: "impact_run", created_at: daysAgo(3) + "T11:00:00Z", user_name: "Ada Obi" },
  { id: 2, action: "policy_upload", created_at: daysAgo(3) + "T10:00:00Z", user_name: "Ada Obi" },
  { id: 1, action: "register", created_at: daysAgo(20) + "T09:00:00Z", user_name: "Ada Obi" },
);

// ---------------- Retrieval (keyword scoring, per-document cap) ----------------
const STOP = new Set("the a an of for to and or in on by is are be with what which how does do our we us it this that as at from shall may must any all".split(" "));
const terms = (s: string) => s.toLowerCase().replace(/[^a-z0-9,]+/g, " ").split(" ").map((t) => t.replace(/,/g, "")).filter((t) => t.length > 1 && !STOP.has(t));

function search(q: string, scope = "all", k = 8) {
  const qt = terms(q);
  const scored = chunks
    .map((c) => {
      const d = docs.find((x) => x.id === c.docId)!;
      if (scope === "regulations" && d.kind !== "regulation") return null;
      if (scope === "policies" && d.kind !== "policy") return null;
      const hay = terms((c.heading ?? "") + " " + c.content);
      const head = terms(c.heading ?? "");
      let score = 0;
      for (const t of qt) { if (hay.includes(t)) score += 1 + hay.filter((h) => h === t).length * 0.2; if (head.includes(t)) score += 1; }
      return score > 0 ? { c, d, score } : null;
    })
    .filter(Boolean) as { c: Chunk; d: Doc; score: number }[];
  scored.sort((a, b) => b.score - a.score || (b.d.published_at ?? "").localeCompare(a.d.published_at ?? ""));
  const per: Record<string, number> = {};
  return scored.filter((r) => (per[r.d.id] = (per[r.d.id] ?? 0) + 1) <= 3).slice(0, k);
}

function answer(question: string, scope: string) {
  const rows = search(question, scope, 4);
  const citations: Citation[] = rows.map((r, i) => ({
    n: i + 1, chunk_id: r.c.id, document_id: r.d.id, title: r.d.title, regulator: r.d.regulator, ref_no: r.d.ref_no,
    published_at: r.d.published_at, page: r.c.page, url: r.d.url, kind: r.d.kind, excerpt: r.c.content.slice(0, 600),
  }));
  const text = rows.length
    ? ["Most relevant passages (demo preview: with a Claude API key the live app writes a summarised answer citing these sources):", "",
        ...rows.map((r, i) => `- ${r.c.content.length > 350 ? r.c.content.slice(0, 350) + "…" : r.c.content} [${i + 1}]`), "", "This is not legal advice."].join("\n")
    : "I couldn't find anything in the indexed documents about that. Try different keywords, such as “Tier 1”, “BVN”, “record keeping” or “foreign exchange”.\n\nThis is not legal advice.";
  return { answer: text, citations, mode: "extractive" as const, retrieved: rows.length };
}

// ---------------- Router ----------------
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fail = (status: number, error: string) => { throw Object.assign(new Error(error), { status }); };
const regRow = (d: Doc) => ({ ...d, private: d.regulator === null || d.id.startsWith("demo-"),
  open_findings: findings.filter((f) => f.regulation_id === d.id && f.status === "open").length });
const log = (action: string) => audit.unshift({ id: ++seq, action, created_at: now(), user_name: user.name });

async function readUpload(body: FormData) {
  const file = body.get("file") as File | null;
  if (!file) fail(400, "Attach a file");
  const name = file!.name.toLowerCase();
  if (!/\.(pdf|docx|txt|md)$/.test(name)) fail(422, "Unsupported file type: use PDF, DOCX, TXT or MD");
  const text = /\.(txt|md)$/.test(name)
    ? await file!.text()
    : `${file!.name}\n1. Document text\nIn this demo preview only TXT and MD files are read in the browser. The live app extracts the full text of PDF and DOCX files on the server.`;
  return { file: file!, text };
}

export async function demoApi(path: string, init: RequestInit = {}): Promise<any> {
  await delay(path.startsWith("/ask") && init.method === "POST" ? 700 : 150);
  const method = (init.method ?? "GET").toUpperCase();
  const url = new URL(path, "http://demo");
  const p = url.pathname;
  const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;

  if (p === "/auth/login" || p === "/auth/register") {
    if (p === "/auth/register") {
      if (!body.password || body.password.length < 10) fail(400, "Password must be at least 10 characters");
      user = { ...user, name: body.name, email: body.email, orgName: body.orgName };
      team[0] = { ...team[0], name: body.name, email: body.email };
    } else if (!body.email || !body.password) fail(401, "Incorrect email or password");
    log(p === "/auth/login" ? "login" : "register");
    return { token: "demo-token", user };
  }
  if (p === "/auth/config") return { recaptchaSiteKey: null };
  if (p === "/auth/forgot") return { message: "We've sent a 6-digit code to your email. It expires in 5 minutes. (Demo: use 123456.)", resendAfterSeconds: 60 };
  if (p === "/auth/reset") {
    if (body.code !== "123456") fail(400, "That code is wrong. 4 attempts left. (Demo: use 123456.)");
    if (!body.password || body.password.length < 10 || !/[A-Za-z]/.test(body.password) || !/\d/.test(body.password)) fail(400, "Password must be at least 10 characters, with letters and numbers");
    if (body.password !== body.confirmPassword) fail(400, "The two new passwords don't match");
    log("password_reset");
    return { ok: true };
  }
  if (p === "/me" && method === "PATCH") {
    user = { ...user, name: String(body.name).trim(), email: String(body.email).trim().toLowerCase() };
    team[0] = { ...team[0], name: user.name, email: user.email };
    log("profile_update");
    return { token: "demo-token", user };
  }
  if (p === "/me/password") {
    if (!body.current) fail(400, "Your current password is incorrect");
    if (!body.next || body.next.length < 10 || !/[A-Za-z]/.test(body.next) || !/\d/.test(body.next)) fail(400, "Password must be at least 10 characters, with letters and numbers");
    log("password_change");
    return { token: "demo-token" };
  }
  if (p === "/organization") { user = { ...user, orgName: String(body.name).trim() }; log("organization_update"); return { name: user.orgName }; }
  if (p === "/me") return { user };
  if (p === "/status") return { ai: { ok: true, llm: false, embeddings: false }, lastIngest: { finished_at: now(), started_at: now(), error: null } };
  if (p === "/stats") {
    const regs = docs.filter((d) => d.kind === "regulation");
    const open = findings.filter((f) => f.status === "open");
    return { regulations: regs.length, regulations_30d: regs.length, policies: docs.filter((d) => d.kind === "policy").length,
      open_findings: open.length, high_findings: open.filter((f) => f.severity === "high").length, questions: history.length };
  }
  if (p === "/ask" && method === "POST") {
    const out = answer(body.question, body.scope ?? "all");
    let convo = conversations.find((c) => c.id === String(body.conversation_id ?? "") && !c.deleted);
    if (body.conversation_id && !convo) fail(404, "Conversation not found");
    if (!convo) {
      const t = body.question.replace(/\s+/g, " ").trim();
      convo = { id: String(++seq), title: t.length > 80 ? t.slice(0, 77) + "…" : t, created_at: now(), updated_at: now(), pinned_at: null, archived_at: null };
      conversations.unshift(convo);
    }
    convo.updated_at = now(); convo.archived_at = null;
    const msg = { id: ++seq, conversation_id: convo.id, created_at: now(), question: body.question, ...out };
    history.unshift(msg); log("ask");
    return msg;
  }
  if (p === "/ask/history") return { messages: [...history] };
  if (p === "/conversations") {
    const archived = url.searchParams.get("archived") === "1";
    return { conversations: conversations.filter((c) => !c.deleted && !!c.archived_at === archived)
      .sort((a, b) => (b.pinned_at ?? "").localeCompare(a.pinned_at ?? "") || b.updated_at.localeCompare(a.updated_at))
      .map((c) => ({ ...c, message_count: history.filter((m) => m.conversation_id === c.id).length })) };
  }
  if (p.startsWith("/conversations/")) {
    const convo = conversations.find((c) => c.id === p.split("/")[2] && !c.deleted);
    if (!convo) fail(404, "Conversation not found");
    if (method === "PATCH") {
      if (body.title) convo!.title = String(body.title).trim().slice(0, 120);
      if (typeof body.pinned === "boolean") convo!.pinned_at = body.pinned ? convo!.pinned_at ?? now() : null;
      if (typeof body.archived === "boolean") convo!.archived_at = body.archived ? convo!.archived_at ?? now() : null;
      log("conversation_update");
      return { conversation: convo };
    }
    if (method === "DELETE") { convo!.deleted = true; log("conversation_delete"); return undefined; }
    return { conversation: convo, messages: history.filter((m) => m.conversation_id === convo!.id).reverse() };
  }

  if (p === "/regulations" && method === "GET") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    return { regulations: docs.filter((d) => d.kind === "regulation" && (!q || d.title.toLowerCase().includes(q) || (d.ref_no ?? "").toLowerCase().includes(q))).map(regRow), page: 1 };
  }
  if (p === "/regulations/upload") {
    const { text } = await readUpload(body as FormData);
    const f = body as FormData;
    const id = addDoc({ kind: "regulation", title: String(f.get("title") || "Uploaded regulation"), regulator: String(f.get("regulator") || "") || null,
      ref_no: String(f.get("ref_no") || "") || null, url: null, published_at: String(f.get("published_at") || "") || daysAgo(0) }, text);
    log("regulation_upload");
    return { id };
  }
  const regMatch = p.match(/^\/regulations\/(.+)$/);
  if (regMatch) {
    const d = docs.find((x) => x.id === regMatch[1] && x.kind === "regulation") ?? fail(404, "Not found");
    return {
      regulation: d,
      chunks: chunks.filter((c) => c.docId === d.id).map((c, i) => ({ ordinal: i, page: c.page, heading: c.heading, content: c.content })),
      findings: findings.filter((f) => f.regulation_id === d.id).map((f) => ({ ...f, policy_title: docs.find((x) => x.id === f.policy_id)?.title })),
    };
  }

  if (p === "/policies" && method === "GET") {
    return { policies: docs.filter((d) => d.kind === "policy").map((d) => ({ ...d, sections: chunks.filter((c) => c.docId === d.id).length,
      open_findings: findings.filter((f) => f.policy_id === d.id && f.status === "open").length })) };
  }
  if (p === "/policies" && method === "POST") {
    const { file, text } = await readUpload(body as FormData);
    const id = addDoc({ kind: "policy", title: String((body as FormData).get("title") || file.name.replace(/\.\w+$/, "")), regulator: null, ref_no: null, url: null, published_at: null }, text);
    log("policy_upload");
    return { id };
  }
  const polMatch = p.match(/^\/policies\/(.+)$/);
  if (polMatch && method === "DELETE") {
    const i = docs.findIndex((d) => d.id === polMatch[1] && d.kind === "policy");
    if (i < 0) fail(404, "Not found");
    docs.splice(i, 1);
    for (let j = chunks.length - 1; j >= 0; j--) if (chunks[j].docId === polMatch[1]) chunks.splice(j, 1);
    for (let j = findings.length - 1; j >= 0; j--) if (findings[j].policy_id === polMatch[1]) findings.splice(j, 1);
    log("policy_delete");
    return undefined;
  }

  if (p === "/impact/run") {
    const reg = docs.find((d) => d.id === body.regulationId) ?? fail(404, "Regulation not found");
    const regChunks = chunks.filter((c) => c.docId === reg!.id);
    const pol = search(regChunks.map((c) => c.content).join(" "), "policies", 3);
    for (let j = findings.length - 1; j >= 0; j--) if (findings[j].regulation_id === reg!.id && findings[j].status === "open" && findings[j].severity === "info") findings.splice(j, 1);
    const hasSample = findings.some((f) => f.regulation_id === reg!.id && f.severity !== "info");
    const created = hasSample ? [] : pol.map((r) => {
      const match = search(r.c.content, "regulations", 8).find((m) => m.d.id === reg!.id);
      const f: Finding = { id: ++seq, regulation_id: reg!.id, policy_id: r.d.id, severity: "info", status: "open", created_at: now(),
        summary: `${r.c.heading ?? "This section"} of '${r.d.title}' covers the same topic as the new regulation. Review it against the rule.`,
        recommendation: "Compare the two passages and update the policy if it no longer matches.",
        evidence: { policy_excerpt: r.c.content, policy_section: r.c.heading, regulation_quote: match?.c.content ?? "" } };
      findings.push(f);
      return f;
    });
    log("impact_run");
    return { findings: created };
  }
  if (p === "/impact" && method === "GET") {
    const status = url.searchParams.get("status") ?? "open";
    const order: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };
    return { findings: findings.filter((f) => f.status === status).sort((a, b) => order[a.severity] - order[b.severity]).map((f) => {
      const r = docs.find((d) => d.id === f.regulation_id)!;
      return { ...f, regulation_title: r.title, ref_no: r.ref_no, regulator: r.regulator, regulation_url: r.url,
        policy_title: docs.find((d) => d.id === f.policy_id)?.title };
    }) };
  }
  const impMatch = p.match(/^\/impact\/(\d+)$/);
  if (impMatch && method === "PATCH") {
    const f = findings.find((x) => x.id === Number(impMatch[1])) ?? fail(404, "Not found");
    f!.status = body.status; log("finding_status");
    return { ok: true };
  }

  if (p === "/alerts") {
    if (method === "PUT") { alerts = body; log("alerts_update"); }
    return alerts;
  }
  if (p === "/team" && method === "GET") return { users: team };
  if (p === "/team/invites" && method === "GET") return { invites };
  if (p === "/team/invites" && method === "POST") {
    if (team.some((t) => t.email === body.email)) fail(409, "This person is already on your team.");
    const inv = { id: String(++seq), email: String(body.email).trim().toLowerCase(), role: body.role ?? "member", created_at: now(),
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), invited_by_name: user.name };
    invites.splice(0, invites.length, ...invites.filter((i) => i.email !== inv.email), inv);
    log("invite_sent");
    return { invite: inv, link: `${location.origin}/#/invite/demo-${inv.id}`, emailSent: false };
  }
  if (p.startsWith("/team/invites/")) {
    const inv = invites.find((i) => i.id === p.split("/")[3]);
    if (!inv) return fail(404, "Invite not found");
    if (method === "DELETE") { invites.splice(invites.indexOf(inv), 1); log("invite_revoked"); return undefined; }
    log("invite_sent");
    return { invite: inv, link: `${location.origin}/#/invite/demo-${inv.id}`, emailSent: false };
  }
  if (p === "/team" && method === "POST") {
    if (!body.password || body.password.length < 10) fail(400, "Password must be at least 10 characters");
    const u = { id: uid(), name: body.name, email: body.email, role: body.role, created_at: now() };
    team.push(u); log("team_add");
    return u;
  }
  if (p === "/audit") return { events: audit };
  if (p === "/admin/sync") { await delay(900); log("manual_sync"); return { newDocuments: 0 }; }
  fail(404, "Not found");
}
