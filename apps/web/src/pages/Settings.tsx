/**
 * Settings, split into sections with their own menu (?tab=...):
 *   Account, Security, Notifications and Chats for everyone;
 *   Team, Data & sync and Audit log for admins only (the API enforces this too).
 * Every control here is wired to a real API call.
 */
import { useEffect, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Icon, type IconName } from "../components/icons";
import { ConfirmDialog } from "../components/Menu";
import { passwordRules, PasswordRules } from "../components/PasswordRules";
import { Avatar, ErrorNote, Spinner, Toggle } from "../components/ui";
import { api, del, fmtDate, patch, post, put, type User } from "../lib/api";
import { useAuth } from "../lib/auth";
import { CONVERSATIONS_EVENT, deleteConversation, listConversations, updateConversation, type Conversation } from "../lib/conversations";

type Tab = "account" | "security" | "notifications" | "chats" | "team" | "data" | "audit";
const TABS: { id: Tab; label: string; icon: IconName; title: string; blurb: string; admin?: boolean }[] = [
  { id: "account", label: "Account", icon: "user", title: "Account settings", blurb: "Your profile and your organisation." },
  { id: "security", label: "Security", icon: "lock", title: "Security", blurb: "Your password and this browser's session." },
  { id: "notifications", label: "Notifications", icon: "bell", title: "Notifications", blurb: "Email alerts when regulators publish something new." },
  { id: "chats", label: "Chats", icon: "chat", title: "Chats", blurb: "Archived conversations and how Remi remembers." },
  { id: "team", label: "Team", icon: "users", title: "Team", blurb: "Invite colleagues and see who can sign in to your workspace.", admin: true },
  { id: "data", label: "Data & sync", icon: "database", title: "Data & sync", blurb: "Regulator feeds, AI status and manual checks.", admin: true },
  { id: "audit", label: "Audit log", icon: "clipboard", title: "Audit log", blurb: "A record of sign-ins, questions and changes.", admin: true },
];

const fmtDateTime = (d?: string | null) =>
  d ? new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export default function Settings() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((t) => !t.admin || isAdmin);
  const tab = tabs.find((t) => t.id === params.get("tab")) ?? tabs[0];

  return (
    <div>
      <div className="text-sm text-slate-500">Settings <span className="mx-1 text-slate-300">/</span> <span className="text-slate-900">{tab.label}</span></div>
      <h1 className="h1 mt-1">{tab.title}</h1>
      <p className="mt-1 text-sm text-slate-500">{tab.blurb}</p>

      <div className="mt-6 grid gap-6 md:grid-cols-[200px_minmax(0,1fr)] md:gap-8">
        <nav aria-label="Settings sections" className="-mx-1 flex gap-1 overflow-x-auto pb-1 md:mx-0 md:block md:space-y-0.5 md:overflow-visible">
          {tabs.map((t) => {
            const active = t.id === tab.id;
            return (
              <button key={t.id} onClick={() => setParams({ tab: t.id })} aria-current={active ? "page" : undefined}
                className={`relative flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition md:w-full ${active
                  ? "bg-brand-50 text-brand-900" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>
                {active && <span className="absolute -left-1 top-2 bottom-2 hidden w-[3px] rounded-full bg-brand-600 md:block" aria-hidden />}
                <Icon name={t.icon} className="h-[18px] w-[18px]" /> {t.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 space-y-5">
          {tab.id === "account" && <AccountSection />}
          {tab.id === "security" && <SecuritySection />}
          {tab.id === "notifications" && <NotificationsSection canEdit={isAdmin} />}
          {tab.id === "chats" && <ChatsSection />}
          {tab.id === "team" && <TeamSection />}
          {tab.id === "data" && <DataSection />}
          {tab.id === "audit" && <AuditSection />}
        </div>
      </div>
    </div>
  );
}

// ---------------- Building blocks ----------------
function Card({ icon, title, description, children, footer }: {
  icon: IconName; title: string; description?: string; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <header className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200/70">
          <Icon name={icon} className="h-4 w-4" />
        </span>
        <div>
          <h2 className="font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
      </header>
      <div className="p-5">{children}</div>
      {footer && <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-3">{footer}</div>}
    </section>
  );
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function IconInput({ icon, ...props }: { icon: IconName } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"><Icon name={icon} /></span>
      <input {...props} className={`input pl-9 disabled:bg-slate-50 disabled:text-slate-500 ${props.className ?? ""}`} />
    </div>
  );
}

function Saved({ show }: { show: boolean }) {
  return show ? <span className="mr-auto flex items-center gap-1.5 text-sm text-emerald-700"><Icon name="check" /> Saved</span> : null;
}

/** A list of short values (emails, keywords) edited as removable chips. */
function TagInput({ values, onChange, placeholder, disabled, validate, label }: {
  values: string[]; onChange: (v: string[]) => void; placeholder: string; disabled?: boolean;
  validate?: (v: string) => string | null; label: string;
}) {
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const add = () => {
    const parts = draft.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return;
    const bad = validate && parts.map(validate).find(Boolean);
    if (bad) return setProblem(bad);
    onChange([...values, ...parts.filter((p) => !values.some((v) => v.toLowerCase() === p.toLowerCase()))]);
    setDraft(""); setProblem(null);
  };
  return (
    <div>
      <div className={`flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-xl border bg-white px-2 py-1.5 transition focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-100 ${problem ? "border-red-300" : "border-slate-200"} ${disabled ? "bg-slate-50" : ""}`}>
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 py-1 pl-2.5 pr-1 text-sm text-slate-700">
            {v}
            {!disabled && (
              <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}
                className="rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700"><Icon name="x" className="h-3.5 w-3.5" /></button>
            )}
          </span>
        ))}
        {!disabled && (
          <input value={draft} aria-label={label} placeholder={values.length ? "" : placeholder}
            onChange={(e) => { setDraft(e.target.value); setProblem(null); }} onBlur={add}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
              if (e.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
            }}
            className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-slate-400" />
        )}
        {disabled && !values.length && <span className="px-1 text-sm text-slate-500">{placeholder}</span>}
      </div>
      {problem && <p className="mt-1.5 text-xs text-red-600">{problem}</p>}
    </div>
  );
}

// ---------------- Account ----------------
function AccountSection() {
  const { user, updateUser } = useAuth();
  const [f, setF] = useState({ name: user?.name ?? "", email: user?.email ?? "" });
  const [org, setOrg] = useState(user?.orgName ?? "");
  const [state, setState] = useState<{ busy?: "profile" | "org"; saved?: "profile" | "org"; error?: string; orgError?: string }>({});
  const isAdmin = user?.role === "admin";
  const dirty = f.name.trim() !== user?.name || f.email.trim().toLowerCase() !== user?.email;

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setState({ busy: "profile" });
    try {
      const r = await patch<{ token: string; user: User }>("/me", { name: f.name, email: f.email });
      updateUser(r.user, r.token);
      setF({ name: r.user.name, email: r.user.email });
      setState({ saved: "profile" });
    } catch (err) { setState({ error: (err as Error).message }); }
  };

  const saveOrg = async (e: FormEvent) => {
    e.preventDefault();
    setState({ busy: "org" });
    try {
      const r = await patch<{ name: string }>("/organization", { name: org });
      if (user) updateUser({ ...user, orgName: r.name });
      setState({ saved: "org" });
    } catch (err) { setState({ orgError: (err as Error).message }); }
  };

  return (
    <>
      <form onSubmit={saveProfile}>
        <Card icon="user" title="Personal profile" description="How you appear to your team and on exported chats."
          footer={<><Saved show={state.saved === "profile" && !dirty} />
            <button className="btn-primary" disabled={!dirty || state.busy === "profile"}>{state.busy === "profile" ? "Saving…" : "Save changes"}</button></>}>
          <div className="grid gap-6 sm:grid-cols-[150px_minmax(0,1fr)]">
            <div className="flex flex-col items-center gap-2 text-center sm:items-start sm:text-left">
              <Avatar name={f.name || user?.name} size="lg" />
              <div className="text-sm font-medium text-slate-900">{user?.name}</div>
              <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium capitalize text-brand-700">{user?.role}</span>
              {user?.createdAt && <div className="text-xs text-slate-500">Member since {fmtDate(user.createdAt)}</div>}
            </div>
            <div className="space-y-4">
              <ErrorNote error={state.error ?? null} />
              <Field label="Full name" htmlFor="pf-name">
                <IconInput id="pf-name" icon="user" required minLength={2} maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              </Field>
              <Field label="Email" htmlFor="pf-email" hint="You sign in with this address, and alerts can be sent to it.">
                <IconInput id="pf-email" icon="mail" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
              </Field>
            </div>
          </div>
        </Card>
      </form>

      <form onSubmit={saveOrg}>
        <Card icon="building" title="Organisation" description="Your workspace. Policies and conversations stay private to it."
          footer={isAdmin ? <><Saved show={state.saved === "org"} />
            <button className="btn-primary" disabled={!org.trim() || org.trim() === user?.orgName || state.busy === "org"}>{state.busy === "org" ? "Saving…" : "Save name"}</button></> : undefined}>
          <div className="space-y-4">
            <ErrorNote error={state.orgError ?? null} />
            <Field label="Organisation name" htmlFor="org-name" hint={isAdmin ? undefined : "Only admins can rename the organisation."}>
              <IconInput id="org-name" icon="building" required minLength={2} maxLength={120} disabled={!isAdmin} value={org} onChange={(e) => setOrg(e.target.value)} />
            </Field>
          </div>
        </Card>
      </form>
    </>
  );
}

// ---------------- Security ----------------
function SecuritySection() {
  const { user, logout, updateUser } = useAuth();
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [state, setState] = useState<{ busy?: boolean; saved?: boolean; error?: string }>({});
  const ready = !!f.current && passwordRules(f.next, f.confirm).every((r) => r.ok);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setState({ busy: true });
    try {
      // Other devices are signed out; the fresh token keeps this browser signed in.
      const r = await post<{ token: string }>("/me/password", { current: f.current, next: f.next });
      if (user) updateUser(user, r.token);
      setF({ current: "", next: "", confirm: "" });
      setState({ saved: true });
    } catch (err) { setState({ error: (err as Error).message }); }
  };

  return (
    <>
      <form onSubmit={save}>
        <Card icon="lock" title="Password" description="Changing it signs you out on every other device."
          footer={<><Saved show={!!state.saved} />
            <button className="btn-primary" disabled={!ready || state.busy}>{state.busy ? "Updating…" : "Update password"}</button></>}>
          <div className="space-y-4">
            <ErrorNote error={state.error ?? null} />
            <Field label="Current password" htmlFor="pw-current">
              <IconInput id="pw-current" icon="lock" type="password" autoComplete="current-password" value={f.current}
                onChange={(e) => { setF({ ...f, current: e.target.value }); setState({}); }} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="New password" htmlFor="pw-next">
                <IconInput id="pw-next" icon="lock" type="password" autoComplete="new-password" value={f.next}
                  onChange={(e) => { setF({ ...f, next: e.target.value }); setState({}); }} />
              </Field>
              <Field label="Confirm new password" htmlFor="pw-confirm">
                <IconInput id="pw-confirm" icon="lock" type="password" autoComplete="new-password" value={f.confirm}
                  onChange={(e) => { setF({ ...f, confirm: e.target.value }); setState({}); }} />
              </Field>
            </div>
            <PasswordRules password={f.next} confirm={f.confirm} />
          </div>
        </Card>
      </form>

      <Card icon="logout" title="Session" description="You stay signed in on this browser until you sign out or the session expires.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600">Signed in as <span className="font-medium text-slate-900">{user?.email}</span></div>
          <button className="btn-ghost" onClick={logout}><Icon name="logout" /> Sign out</button>
        </div>
      </Card>
    </>
  );
}

// ---------------- Notifications ----------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function NotificationsSection({ canEdit }: { canEdit: boolean }) {
  const [f, setF] = useState<{ emails: string[]; regulators: string[]; keywords: string[]; enabled: boolean } | null>(null);
  const [saved, setSaved] = useState<typeof f>(null);
  const [state, setState] = useState<{ busy?: boolean; done?: boolean; error?: string }>({});

  useEffect(() => {
    api("/alerts").then((s) => { const v = { emails: s.emails, regulators: s.regulators, keywords: s.keywords, enabled: s.enabled }; setF(v); setSaved(v); })
      .catch((e) => setState({ error: e.message }));
  }, []);

  const dirty = JSON.stringify(f) !== JSON.stringify(saved);
  const save = async () => {
    setState({ busy: true });
    try { await put("/alerts", f); setSaved(f); setState({ done: true }); }
    catch (err) { setState({ error: (err as Error).message }); }
  };

  return (
    <Card icon="bell" title="Email alerts" description="A digest when new regulations are published, with any impact on your policies."
      footer={canEdit && f ? <><Saved show={!!state.done && !dirty} />
        <button className="btn-primary" disabled={!dirty || state.busy} onClick={save}>{state.busy ? "Saving…" : "Save changes"}</button></> : undefined}>
      {!f ? (state.error ? <ErrorNote error={state.error} /> : <Spinner />) : (
        <div className="space-y-5">
          <ErrorNote error={state.error ?? null} />
          {!canEdit && <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">Only admins can change alert settings. Ask an admin on your team if something should change.</p>}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-slate-900">Send alert emails</div>
              <p className="mt-0.5 text-sm text-slate-500">Turn off to pause every alert without losing these settings.</p>
            </div>
            <Toggle label="Send alert emails" checked={f.enabled} disabled={!canEdit} onChange={(enabled) => setF({ ...f, enabled })} />
          </div>
          <div className="border-t border-slate-100" />
          <Field label="Send to" hint="Press Enter or comma after each address.">
            <TagInput label="Add recipient email" values={f.emails} disabled={!canEdit} placeholder="compliance@yourbank.com"
              validate={(v) => (EMAIL_RE.test(v) ? null : `“${v}” isn't a valid email address`)} onChange={(emails) => setF({ ...f, emails })} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Regulators" hint="Leave empty to hear about every regulator.">
              <TagInput label="Add regulator" values={f.regulators} disabled={!canEdit} placeholder="All regulators"
                onChange={(regulators) => setF({ ...f, regulators: regulators.map((r) => r.toUpperCase()) })} />
            </Field>
            <Field label="Keywords in the title" hint="Leave empty to hear about every topic.">
              <TagInput label="Add keyword" values={f.keywords} disabled={!canEdit} placeholder="All topics" onChange={(keywords) => setF({ ...f, keywords })} />
            </Field>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------- Chats ----------------
function ChatsSection() {
  const [items, setItems] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Conversation | null>(null);

  useEffect(() => {
    const load = () => listConversations(true).then(setItems).catch((e) => setError(e.message));
    load();
    window.addEventListener(CONVERSATIONS_EVENT, load);
    return () => window.removeEventListener(CONVERSATIONS_EVENT, load);
  }, []);

  const act = (p: Promise<unknown>) => p.catch((e) => setError((e as Error).message));

  return (
    <>
      <Card icon="archive" title="Archived conversations" description="Archived chats are hidden from the sidebar. Restore one to bring it back.">
        <ErrorNote error={error} />
        {!items ? <Spinner /> : items.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm font-medium text-slate-700">Nothing archived</p>
            <p className="mt-1 text-sm text-slate-500">Use the ⋯ menu next to a conversation in the sidebar to archive it.</p>
          </div>
        ) : (
          <ul className="-my-2 divide-y divide-slate-100">
            {items.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <Link to={`/ask?c=${c.id}`} className="block truncate text-sm font-medium text-slate-900 hover:text-brand-700">{c.title}</Link>
                  <div className="text-xs text-slate-500">
                    Archived {fmtDate(c.archived_at)} · {c.message_count} {c.message_count === 1 ? "message" : "messages"}
                  </div>
                </div>
                <button className="btn-ghost px-3 py-1.5" onClick={() => act(updateConversation(c.id, { archived: false }))}>Restore</button>
                <button className="btn px-3 py-1.5 text-red-600 hover:bg-red-50" onClick={() => setConfirm(c)}>
                  <Icon name="trash" /> Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card icon="sparkle" title="How Remi remembers" description="What is saved, and what Remi reads when it answers.">
        <ul className="space-y-2 text-sm text-slate-600">
          <li className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> Every conversation is saved to your account and reopens where you left off.</li>
          <li className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> When answering, Remi reads the last 10 exchanges of the conversation, so follow-up questions keep their context.</li>
          <li className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> Conversations are private to you. Questions are also kept in the audit log, as regulators expect.</li>
        </ul>
      </Card>

      {confirm && (
        <ConfirmDialog title="Delete this conversation?" confirmLabel="Delete" danger onCancel={() => setConfirm(null)}
          onConfirm={async () => { await act(deleteConversation(confirm.id)); setConfirm(null); }}>
          “{confirm.title}” will be removed from your chats. This can't be undone.
        </ConfirmDialog>
      )}
    </>
  );
}

// ---------------- Team ----------------
function TeamSection() {
  const { user } = useAuth();
  const [users, setUsers] = useState<any[] | null>(null);
  const [invites, setInvites] = useState<any[] | null>(null);
  const [f, setF] = useState({ email: "", role: "member" });
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});
  // After sending: the link (shown once) so it can also be shared another way, e.g. WhatsApp.
  const [sent, setSent] = useState<{ email: string; link: string; emailSent: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<any | null>(null);

  const load = () => {
    api("/team").then((r) => setUsers(r.users)).catch((e) => setState({ error: e.message }));
    api("/team/invites").then((r) => setInvites(r.invites)).catch((e) => setState({ error: e.message }));
  };
  useEffect(load, []);

  const showSent = (email: string, r: { link: string; emailSent: boolean }) => { setSent({ email, link: r.link, emailSent: r.emailSent }); setCopied(false); };

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setState({ busy: true }); setSent(null);
    try {
      const r = await post<{ link: string; emailSent: boolean }>("/team/invites", f);
      showSent(f.email.trim().toLowerCase(), r);
      setF({ email: "", role: f.role });
      setState({});
      load();
    } catch (err) { setState({ error: (err as Error).message }); }
  };

  const resend = async (inv: any) => {
    setState({}); setSent(null);
    try { showSent(inv.email, await post(`/team/invites/${inv.id}/resend`, {})); load(); }
    catch (err) { setState({ error: (err as Error).message }); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(sent!.link); setCopied(true); }
    catch { window.prompt("Copy this invite link:", sent!.link); }
  };

  const ago = (d: string) => {
    const h = Math.round((Date.now() - new Date(d).getTime()) / 3_600_000);
    return h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
  };

  return (
    <>
      <form onSubmit={invite}>
        <Card icon="mail" title="Invite someone" description="They get an email with a link to join. They choose their own name and password."
          footer={<button className="btn-primary" disabled={state.busy || !f.email.trim()}>
            <Icon name="mail" /> {state.busy ? "Sending invite…" : "Send invite"}</button>}>
          <div className="space-y-4">
            <ErrorNote error={state.error ?? null} />
            {sent && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                <div className="flex items-start gap-2">
                  <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    {sent.emailSent
                      ? <>Invite sent to <strong>{sent.email}</strong>. You can also share the link yourself:</>
                      : <>Invite created for <strong>{sent.email}</strong>, but the email couldn't be sent. Share this link with them yourself:</>}
                    <div className="mt-2 flex gap-2">
                      <input readOnly value={sent.link} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link"
                        className="input min-w-0 flex-1 bg-white py-1.5 font-mono text-xs" />
                      <button type="button" className="btn-ghost shrink-0 px-3 py-1.5" onClick={copy}>{copied ? "Copied ✓" : "Copy link"}</button>
                    </div>
                    <p className="mt-1.5 text-xs text-emerald-800/80">The link works once and expires in 7 days.</p>
                  </div>
                </div>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
              <Field label="Email address" htmlFor="inv-email">
                <IconInput id="inv-email" icon="mail" type="email" required placeholder="colleague@yourbank.com"
                  value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
              </Field>
              <Field label="Role" htmlFor="inv-role">
                <select id="inv-role" className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                  <option value="member">Member</option><option value="admin">Admin</option>
                </select>
              </Field>
            </div>
            <p className="text-xs text-slate-500">
              {f.role === "admin"
                ? "Admins can do everything members can, plus invite people, change alert settings and see the audit log."
                : "Members can ask Remi, read regulations, upload policies and review impact findings."}
            </p>
          </div>
        </Card>
      </form>

      <Card icon="clock" title="Pending invites" description="Invites that haven't been accepted yet.">
        {!invites ? <Spinner /> : invites.length === 0 ? (
          <p className="py-2 text-center text-sm text-slate-500">No pending invites.</p>
        ) : (
          <ul className="-my-2 divide-y divide-slate-100">
            {invites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-500"><Icon name="mail" /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">{inv.email}</div>
                  <div className="text-xs text-slate-500">
                    <span className="capitalize">{inv.role}</span> · invited {ago(inv.created_at)}{inv.invited_by_name ? ` by ${inv.invited_by_name}` : ""} · expires {fmtDate(inv.expires_at)}
                  </div>
                </div>
                <button className="btn-ghost px-3 py-1.5" onClick={() => resend(inv)}>Resend</button>
                <button className="btn px-3 py-1.5 text-red-600 hover:bg-red-50" onClick={() => setConfirmRevoke(inv)}>Cancel</button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card icon="users" title="Members" description={users ? `${users.length} ${users.length === 1 ? "person" : "people"} in your workspace.` : undefined}>
        {!users ? <Spinner /> : (
          <ul className="-my-2 divide-y divide-slate-100">
            {users.map((u) => (
              <li key={u.id} className="flex items-center gap-3 py-3">
                <Avatar name={u.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">
                    {u.name} {u.id === user?.id && <span className="ml-1 text-xs font-normal text-slate-500">(you)</span>}
                  </div>
                  <div className="truncate text-xs text-slate-500">{u.email}</div>
                </div>
                <span className={`rounded-md px-2 py-0.5 text-xs font-medium capitalize ${u.role === "admin" ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-600"}`}>{u.role}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {confirmRevoke && (
        <ConfirmDialog title="Cancel this invite?" confirmLabel="Cancel invite" danger onCancel={() => setConfirmRevoke(null)}
          onConfirm={async () => {
            try { await del(`/team/invites/${confirmRevoke.id}`); load(); }
            catch (err) { setState({ error: (err as Error).message }); }
            setConfirmRevoke(null);
          }}>
          The link sent to {confirmRevoke.email} will stop working. You can invite them again later.
        </ConfirmDialog>
      )}
    </>
  );
}

// ---------------- Data & sync ----------------
function DataSection() {
  const [status, setStatus] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [sync, setSync] = useState<{ busy?: boolean; result?: string; error?: string }>({});
  const load = () => {
    api("/status").then(setStatus).catch(() => setStatus({ ai: null }));
    api("/stats").then(setStats).catch(() => undefined);
  };
  useEffect(load, []);

  const run = async () => {
    setSync({ busy: true });
    try {
      const r = await post("/admin/sync", {});
      setSync({ result: r.skipped ? "A check is already running." : `Done: ${r.newDocuments} new regulation(s) indexed.` });
      load();
    } catch (e) { setSync({ error: (e as Error).message }); }
  };

  const last = status?.lastIngest;
  const rows: { label: string; value: ReactNode; ok?: boolean; hint?: string }[] = status ? [
    { label: "AI written answers", ok: !!status.ai?.llm,
      value: status.ai?.llm ? `On${status.ai.llm_provider ? ` · ${status.ai.llm_provider}` : ""}` : "Off",
      hint: status.ai?.llm ? undefined : "Remi shows matching passages only. Add an AI provider key (Gemini, Groq, Claude or a local Ollama model) in the server's .env file to get written, cited answers." },
    { label: "Meaning-based search", ok: !!status.ai?.embeddings, value: status.ai?.embeddings ? "On" : "Off",
      hint: status.ai?.embeddings ? undefined : "Search matches keywords. An embeddings key also finds passages with similar meaning." },
    { label: "Last regulator check", ok: !!last?.finished_at && !last?.error,
      value: !last ? "Never" : last.finished_at ? fmtDateTime(last.finished_at) : `Started ${fmtDateTime(last.started_at)}, not finished`,
      hint: last?.error ? `Error: ${last.error}` : undefined },
    { label: "Regulations indexed", ok: (stats?.regulations ?? 0) > 0, value: stats ? String(stats.regulations) : "…",
      hint: stats && stats.regulations === 0 ? "Nothing to search yet. Upload circulars under Regulations → Add a regulation manually." : undefined },
  ] : [];

  return (
    <Card icon="database" title="Status" description="Where Remi's knowledge comes from, and whether everything is running."
      footer={<>{sync.result && <span className="mr-auto text-sm text-slate-600">{sync.result}</span>}
        <button className="btn-primary" onClick={run} disabled={sync.busy}><Icon name="refresh" /> {sync.busy ? "Checking regulators…" : "Check for new regulations"}</button></>}>
      <ErrorNote error={sync.error ?? null} />
      {!status ? <Spinner /> : (
        <dl className="-my-2 divide-y divide-slate-100">
          {rows.map((r) => (
            <div key={r.label} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-3">
              <dt className="flex-1 text-sm text-slate-600">
                {r.label}
                {r.hint && <p className="mt-0.5 text-xs text-slate-500">{r.hint}</p>}
              </dt>
              <dd className="flex items-center gap-2 text-sm font-medium text-slate-900">
                <span className={`h-2 w-2 rounded-full ${r.ok ? "bg-emerald-500" : "bg-amber-400"}`} aria-hidden />
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

// ---------------- Audit log ----------------
const ACTIONS: Record<string, string> = {
  login: "Signed in", register: "Created the workspace", ask: "Asked Remi a question",
  regulation_upload: "Uploaded a regulation", policy_upload: "Uploaded a policy", policy_delete: "Deleted a policy",
  team_add: "Added a team member", manual_sync: "Checked for new regulations", alerts_update: "Changed alert settings",
  impact_run: "Ran an impact check", finding_status: "Updated an impact finding",
  conversation_update: "Changed a conversation", conversation_delete: "Deleted a conversation",
  profile_update: "Updated their profile", password_change: "Changed their password", organization_update: "Renamed the organisation",
  password_reset_requested: "Asked for a password reset code", password_reset: "Reset their password with a code",
  invite_sent: "Invited someone to the team", invite_revoked: "Cancelled a team invite", invite_accepted: "Joined the team from an invite",
};
const describe = (a: string) => ACTIONS[a] ?? a.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function AuditSection() {
  const [events, setEvents] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api("/audit").then((r) => setEvents(r.events)).catch((e) => { setError(e.message); setEvents([]); }); }, []);
  return (
    <Card icon="clipboard" title="Recent activity" description="The latest 200 events in your workspace.">
      <ErrorNote error={error} />
      {!events ? <Spinner /> : events.length === 0 ? <p className="py-4 text-center text-sm text-slate-500">No activity yet.</p> : (
        <div className="-mx-5 -my-5 max-h-[28rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-xs font-medium text-slate-500 shadow-[0_1px_0_#f1f5f9]">
              <tr><th className="px-5 py-2.5 font-medium">When</th><th className="px-2 py-2.5 font-medium">Who</th><th className="px-5 py-2.5 font-medium">What</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {events.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50/60">
                  <td className="whitespace-nowrap px-5 py-2.5 text-slate-500">{fmtDateTime(e.created_at)}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-slate-900">{e.user_name ?? "System"}</td>
                  <td className="px-5 py-2.5 text-slate-700">{describe(e.action)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
