/**
 * Small overlay pieces: a dropdown menu opened from a trigger button, and a
 * confirmation dialog. Both render into <body> so scrolling containers (like the
 * sidebar's conversation list) can't clip them, and both close on Escape.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";

export type MenuEntry = { label: string; icon: IconName; onSelect: () => void; danger?: boolean } | "divider";

const MENU_WIDTH = 208;

export function Menu({ trigger, items, label, align = "start" }: {
  trigger: (props: { open: boolean; toggle: () => void; ref: React.RefObject<HTMLButtonElement> }) => ReactNode;
  items: MenuEntry[]; label: string; align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = (refocus = true) => { setOpen(false); if (refocus) btn.current?.focus(); };

  // Place the menu under the trigger, or above it when there isn't room below.
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = menu.current?.offsetHeight ?? 260;
    const top = r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6;
    const left = align === "end" ? r.right - MENU_WIDTH : r.left;
    setPos({ top, left: Math.min(Math.max(8, left), window.innerWidth - MENU_WIDTH - 8) });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const list = [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        list[(i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
      }
    };
    const onScroll = () => close(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <>
      {trigger({ open, toggle: () => setOpen((o) => !o), ref: btn })}
      {open && createPortal(
        <div ref={menu} role="menu" aria-label={label}
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: MENU_WIDTH }}
          className="fixed z-50 rounded-xl border border-slate-200 bg-white p-1 shadow-[0_12px_32px_-8px_rgba(15,23,42,0.18)]">
          {items.map((it, i) => it === "divider"
            ? <div key={i} className="my-1 border-t border-slate-100" role="separator" />
            : (
              <button key={it.label} role="menuitem" type="button"
                onClick={() => { close(false); it.onSelect(); }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition ${it.danger
                  ? "text-red-600 hover:bg-red-50 focus:bg-red-50"
                  : "text-slate-700 hover:bg-slate-100 focus:bg-slate-100"}`}>
                <Icon name={it.icon} className="h-4 w-4 shrink-0" /> {it.label}
              </button>
            ))}
        </div>, document.body)}
    </>
  );
}

export function ConfirmDialog({ title, children, confirmLabel, danger, onConfirm, onCancel }: {
  title: string; children: ReactNode; confirmLabel: string; danger?: boolean;
  onConfirm: () => void | Promise<void>; onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-[2px]" onMouseDown={onCancel}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <h2 id="confirm-title" className="text-base font-semibold text-slate-900">{title}</h2>
        <div className="mt-1.5 text-sm leading-relaxed text-slate-500">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" ref={confirmBtn} disabled={busy}
            className={danger ? "btn bg-red-600 text-white hover:bg-red-700" : "btn-primary"}
            onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>, document.body);
}
