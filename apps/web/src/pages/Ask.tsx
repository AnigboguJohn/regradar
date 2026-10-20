/**
 * Chat with Remi. Conversations are saved: opening Ask resumes the most recent one,
 * the sidebar reopens any other (/ask?c=<id>), and "New chat" starts a fresh one on
 * a greeting with suggested questions. Each question goes to /api/ask with the
 * conversation id, so Remi sees the earlier turns. The scope chips limit the search
 * to regulations, the company's own policies, or both.
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Answer } from "../components/Answer";
import { Icon, type IconName } from "../components/icons";
import { Menu } from "../components/Menu";
import { ErrorNote, Spinner } from "../components/ui";
import { api, post, type Citation } from "../lib/api";
import { useAuth } from "../lib/auth";
import { CONVERSATIONS_EVENT, getConversation, notifyConversations } from "../lib/conversations";
import { exportAsPdf, exportAsText } from "../lib/exportChat";

interface Msg { id: number | string; conversation_id?: string; question: string; answer: string; citations: Citation[]; mode: string }

// Long questions are fine (whole clauses can be pasted in); this matches the server limit.
const MAX_QUESTION = 20_000;

const SUGGESTIONS: { icon: IconName; title: string; question: string }[] = [
  { icon: "gauge", title: "Check a limit", question: "What are the current transaction limits for Tier 1 KYC accounts?" },
  { icon: "refresh", title: "What changed", question: "What changed in the latest foreign exchange circulars?" },
  { icon: "shield", title: "Policy check", question: "Does our customer onboarding policy meet the latest CBN requirements?" },
];

const SCOPES = [
  { value: "all", label: "Regulations + policies" },
  { value: "regulations", label: "Regulations" },
  { value: "policies", label: "Our policies" },
];

function Composer({ value, onChange, onSubmit, scope, onScope, busy, autoFocus }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void;
  scope: string; onScope: (s: string) => void; busy: boolean; autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Grow with the text, up to about six lines.
  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; }
  }, [value]);
  const canSend = !busy && value.trim().length >= 3;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (canSend) onSubmit(); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); if (canSend) onSubmit(); };

  return (
    <form onSubmit={submit} className="rounded-[20px] border border-slate-200/80 bg-white shadow-[0_2px_6px_rgba(16,24,40,0.04),0_12px_32px_-16px_rgba(76,29,149,0.25)] transition focus-within:border-brand-300">
      <textarea ref={ref} rows={1} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey}
        autoFocus={autoFocus} maxLength={MAX_QUESTION} placeholder="Ask Remi about any regulation or policy…" aria-label="Your question"
        className="block w-full resize-none bg-transparent px-5 pb-2 pt-4 text-[15px] text-slate-900 outline-none placeholder:text-slate-400" />
      <div className="flex items-center gap-2 px-3 pb-3">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Search scope">
          {SCOPES.map((s) => (
            <button key={s.value} type="button" role="radio" aria-checked={scope === s.value} onClick={() => onScope(s.value)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${scope === s.value
                ? "border-brand-200 bg-brand-50 text-brand-700"
                : "border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700"}`}>
              {s.label}
            </button>
          ))}
        </div>
        <button type="submit" disabled={!canSend} aria-label="Send"
          className="orb ml-auto flex h-9 w-9 shrink-0 items-center justify-center text-white transition hover:brightness-105 disabled:opacity-40 disabled:shadow-none">
          <Icon name="send" className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}

export default function Ask() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const openId = params.get("c");
  const fresh = Boolean((location.state as { fresh?: number } | null)?.fresh);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(!fresh);
  const [title, setTitle] = useState("");
  const createdId = useRef<string | null>(null);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // ?c=<id> opens that conversation. "New chat" starts empty. Otherwise resume the most recent
  // conversation, so coming back to Ask carries on where the user left off.
  useEffect(() => {
    let live = true;
    setError(null);
    if (openId && openId === createdId.current) { createdId.current = null; return; }   // just created here: already shown
    if (!openId && fresh) { setMsgs([]); setTitle(""); setLoading(false); return; }
    setLoading(true);
    const load = openId
      ? getConversation(openId).then((r) => { if (live) { setMsgs(r.messages); setTitle(r.conversation.title); } })
      : api<{ conversations: { id: string }[] }>("/conversations").then((r) => {
          if (!live) return;
          if (r.conversations.length) navigate(`/ask?c=${r.conversations[0].id}`, { replace: true });
          else setMsgs([]);
        });
    load.catch(() => { if (live) setMsgs([]); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [openId, location.key]);
  // Keep the title current when the conversation is renamed from the sidebar.
  useEffect(() => {
    if (!openId) return;
    const refresh = () => getConversation(openId).then((r) => setTitle(r.conversation.title)).catch(() => undefined);
    window.addEventListener(CONVERSATIONS_EVENT, refresh);
    return () => window.removeEventListener(CONVERSATIONS_EVENT, refresh);
  }, [openId]);
  // Braces matter: newer browsers return a Promise from scrollIntoView, and React would treat it as a cleanup function.
  useEffect(() => { if (msgs.length || busy) endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length, busy]);

  // Send a question; on failure, put it back in the box so the user doesn't have to retype it.
  const ask = async (question: string) => {
    if (question.trim().length < 3 || busy) return;
    setBusy(true); setError(null); setQ("");
    try {
      const r = await post<Msg>("/ask", { question, scope, conversation_id: openId ?? undefined });
      setMsgs((m) => [...m, r]);
      // A new chat gets its id from the first answer; put it in the URL so a refresh reopens it.
      if (!openId && r.conversation_id) {
        createdId.current = String(r.conversation_id);
        setTitle(question.replace(/\s+/g, " ").trim().slice(0, 80));
        navigate(`/ask?c=${r.conversation_id}`, { replace: true });
      }
      notifyConversations();
    } catch (e) {
      setError((e as Error).message); setQ(question);
    } finally { setBusy(false); }
  };

  const firstName = user?.name?.split(/\s+/)[0] ?? "there";
  const empty = msgs.length === 0 && !busy;

  if (loading) return <div className="flex flex-1 items-center justify-center"><Spinner label="Opening your conversation…" /></div>;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 rounded-xl border border-slate-200/80 px-3 py-1.5 text-sm font-medium text-slate-800">
          <span className="orb h-4 w-4" aria-hidden /> Remi
          <span className="hidden text-xs font-normal text-slate-500 sm:inline">· compliance assistant</span>
        </div>
        {title && msgs.length > 0 && <div className="mx-4 hidden min-w-0 flex-1 truncate text-center text-sm text-slate-500 md:block" title={title}>{title}</div>}
        <Menu label="Export chat" align="end" items={[
          { label: "Export as PDF", icon: "printer", onSelect: () => exportAsPdf(title || "Conversation with Remi", msgs) },
          { label: "Export as text", icon: "download", onSelect: () => exportAsText(title || "Conversation with Remi", msgs) },
        ]} trigger={({ open, toggle, ref }) => (
          <button ref={ref} className="btn-ghost px-3 py-1.5" disabled={msgs.length === 0} aria-haspopup="menu" aria-expanded={open} onClick={toggle}
            title={msgs.length === 0 ? "Ask a question first, then export the conversation" : undefined}>
            <Icon name="download" /> Export chat
          </button>
        )} />
      </div>

      {empty ? (
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center py-10">
          <div className="orb-glow mx-auto h-20 w-20" aria-hidden />
          <h1 className="mt-8 text-center text-3xl font-semibold tracking-tight md:text-[34px]">
            <span className="greeting">Hello, {firstName}</span>
            <span className="mt-1 block text-slate-900">How can I help with compliance today?</span>
          </h1>
          <div className="mt-8">
            <ErrorNote error={error} />
            <div className={error ? "mt-2" : ""}>
              <Composer value={q} onChange={setQ} onSubmit={() => ask(q)} scope={scope} onScope={setScope} busy={busy} autoFocus />
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {SUGGESTIONS.map((s) => (
              <button key={s.title} onClick={() => ask(s.question)}
                className="group flex flex-col items-start justify-start rounded-2xl border border-slate-200/80 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[0_8px_24px_-12px_rgba(76,29,149,0.25)]">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-600 group-hover:bg-brand-50 group-hover:text-brand-700">
                  <Icon name={s.icon} className="h-[18px] w-[18px]" />
                </span>
                <span className="mt-3 block text-sm font-semibold text-slate-900">{s.title}</span>
                <span className="mt-1 block text-xs leading-relaxed text-slate-500">{s.question}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="mx-auto w-full max-w-3xl flex-1 space-y-8 py-8">
            {msgs.map((m) => (
              <div key={m.id} className="space-y-4">
                <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand-50 px-4 py-2.5 text-[15px] text-slate-900">{m.question}</div>
                <div className="flex gap-3">
                  <span className="orb mt-0.5 h-7 w-7 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 text-xs font-semibold text-slate-500">Remi</div>
                    <Answer text={m.answer} citations={m.citations} />
                    {m.mode === "extractive" && <p className="mt-3 text-xs text-amber-700">Showing matching passages: AI summarisation is off.</p>}
                  </div>
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-3" role="status">
                <span className="orb-glow h-7 w-7 shrink-0" aria-hidden />
                <span className="text-sm text-slate-500">Remi is searching regulations and writing a cited answer…</span>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <div className="sticky bottom-0 mx-auto w-full max-w-3xl space-y-2 bg-gradient-to-t from-white via-white to-white/0 pb-1 pt-4">
            <ErrorNote error={error} />
            <Composer value={q} onChange={setQ} onSubmit={() => ask(q)} scope={scope} onScope={setScope} busy={busy} />
          </div>
        </>
      )}

      <p className="mt-4 text-center text-xs text-slate-500">
        Remi answers only from your indexed regulations and policies, and cites every claim. Not legal advice.
      </p>
    </div>
  );
}
