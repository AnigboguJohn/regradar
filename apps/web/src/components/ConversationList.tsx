/**
 * The sidebar's saved conversations: pinned ones first, the rest grouped by day.
 * Each row has a ⋯ menu to pin, rename, export, archive or delete the conversation.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  CONVERSATIONS_EVENT, deleteConversation, exportConversation, listConversations, updateConversation, type Conversation,
} from "../lib/conversations";
import { Icon } from "./icons";
import { ConfirmDialog, Menu } from "./Menu";

// Group conversations the way chat apps do: Today, Yesterday, Earlier (by last activity).
function groupByDay(items: Conversation[]) {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = day(new Date());
  const groups: Record<string, Conversation[]> = { Today: [], Yesterday: [], Earlier: [] };
  for (const r of items) {
    const diff = r.updated_at ? (today - day(new Date(r.updated_at))) / 86_400_000 : 2;
    groups[diff < 1 ? "Today" : diff < 2 ? "Yesterday" : "Earlier"].push(r);
  }
  return Object.entries(groups).filter(([, list]) => list.length > 0);
}

/** openId: the conversation open on the Ask page. onClosed: called when that one is archived or deleted. */
export function ConversationList({ openId, onClosed }: { openId: string | null; onClosed: () => void }) {
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Conversation | null>(null);
  const toastTimer = useRef<number>();

  useEffect(() => {
    const load = () => listConversations().then(setConvos).catch(() => undefined);
    load();
    window.addEventListener(CONVERSATIONS_EVENT, load);
    return () => window.removeEventListener(CONVERSATIONS_EVENT, load);
  }, []);

  const flash = (text: string, undo?: () => void) => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  };
  const fail = (e: unknown) => flash((e as Error).message || "Something went wrong");

  const archive = async (c: Conversation) => {
    try {
      await updateConversation(c.id, { archived: true });
      if (c.id === openId) onClosed();
      flash("Conversation archived", () => updateConversation(c.id, { archived: false }).catch(fail));
    } catch (e) { fail(e); }
  };

  const pinned = convos.filter((c) => c.pinned_at);
  const rest = convos.filter((c) => !c.pinned_at);

  return (
    <>
      {convos.length === 0 && <p className="px-3 text-xs leading-relaxed text-slate-500">Your conversations with Remi are saved here.</p>}
      {pinned.length > 0 && (
        <Group label="Pinned">
          {pinned.map((c) => <Row key={c.id} c={c} active={c.id === openId} onArchive={archive} onDelete={setConfirmDelete} onError={fail} />)}
        </Group>
      )}
      {groupByDay(rest).map(([label, list]) => (
        <Group key={label} label={label}>
          {list.map((c) => <Row key={c.id} c={c} active={c.id === openId} onArchive={archive} onDelete={setConfirmDelete} onError={fail} />)}
        </Group>
      ))}

      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg">
          {toast.text}
          {toast.undo && (
            <button className="font-semibold text-brand-200 hover:text-white" onClick={() => { toast.undo!(); setToast(null); }}>Undo</button>
          )}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog title="Delete this conversation?" confirmLabel="Delete" danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const c = confirmDelete;
            try {
              await deleteConversation(c.id);
              if (c.id === openId) onClosed();
              flash("Conversation deleted");
            } catch (e) { fail(e); }
            setConfirmDelete(null);
          }}>
          “{confirmDelete.title}” will be removed from your chats. This can't be undone.
        </ConfirmDialog>
      )}
    </>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="px-3 pb-1 text-[11px] font-medium text-slate-500">{label}</div>
      {children}
    </div>
  );
}

function Row({ c, active, onArchive, onDelete, onError }: {
  c: Conversation; active: boolean;
  onArchive: (c: Conversation) => void; onDelete: (c: Conversation) => void; onError: (e: unknown) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(c.title);
  useEffect(() => setTitle(c.title), [c.title]);

  const saveTitle = async () => {
    setEditing(false);
    const t = title.trim();
    if (!t || t === c.title) return setTitle(c.title);
    try { await updateConversation(c.id, { title: t }); } catch (e) { setTitle(c.title); onError(e); }
  };

  if (editing) {
    return (
      <input autoFocus value={title} maxLength={120} aria-label="Conversation name"
        onClick={(e) => e.stopPropagation()} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setTitle(c.title); setEditing(false); } }}
        className="w-full rounded-lg border border-brand-300 bg-white px-3 py-1.5 text-[13px] text-slate-900 outline-none ring-4 ring-brand-100" />
    );
  }

  return (
    <div className={`group relative flex items-center rounded-lg ${active ? "bg-slate-100" : "hover:bg-slate-100/80"}`}>
      <Link to={`/ask?c=${c.id}`} title={c.title}
        className={`min-w-0 flex-1 truncate py-1.5 pl-3 pr-1 text-[13px] ${active ? "font-medium text-slate-900" : "text-slate-600 group-hover:text-slate-900"}`}>
        {c.title}
      </Link>
      <Menu label={`Options for ${c.title}`} align="start" items={[
        { label: c.pinned_at ? "Unpin" : "Pin", icon: "pin", onSelect: () => updateConversation(c.id, { pinned: !c.pinned_at }).catch(onError) },
        { label: "Rename", icon: "pencil", onSelect: () => setEditing(true) },
        "divider",
        { label: "Export as PDF", icon: "printer", onSelect: () => exportConversation(c.id, "pdf").catch(onError) },
        { label: "Export as text", icon: "download", onSelect: () => exportConversation(c.id, "txt").catch(onError) },
        "divider",
        { label: "Archive", icon: "archive", onSelect: () => onArchive(c) },
        { label: "Delete", icon: "trash", danger: true, onSelect: () => onDelete(c) },
      ]} trigger={({ open, toggle, ref }) => (
        <button ref={ref} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Options for ${c.title}`}
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          className={`mr-1 shrink-0 rounded-md p-1 text-slate-500 transition hover:bg-white hover:text-slate-900 focus:opacity-100 ${open ? "bg-white text-slate-900 opacity-100" : "md:opacity-0 md:group-hover:opacity-100"}`}>
          <Icon name="dots" className="h-4 w-4" />
        </button>
      )} />
    </div>
  );
}
