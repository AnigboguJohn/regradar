/** The ⋯ menu for one user, shared by the Users page and a company's page. */
import { useState } from "react";
import { Icon } from "../../components/icons";
import { ConfirmDialog, Menu } from "../../components/Menu";
import { adminPatch, adminPost } from "../adminApi";

export interface AdminUserRow { id: string; name: string; email: string; role: "admin" | "member"; suspended_at: string | null }

export function UserActions({ u, onDone, onMessage }: { u: AdminUserRow; onDone: () => void; onMessage: (m: { text: string; error?: boolean }) => void }) {
  const [confirm, setConfirm] = useState<null | "suspend" | "signout">(null);
  const run = async (p: Promise<any>, ok: string) => {
    try { const r = await p; onMessage({ text: r?.message ?? ok }); onDone(); }
    catch (e) { onMessage({ text: (e as Error).message, error: true }); }
  };

  return (
    <>
      <Menu label={`Actions for ${u.name}`} align="end" items={[
        u.role === "admin"
          ? { label: "Make member", icon: "user", onSelect: () => run(adminPatch(`/users/${u.id}`, { role: "member" }), `${u.name} is now a member.`) }
          : { label: "Make admin", icon: "users", onSelect: () => run(adminPatch(`/users/${u.id}`, { role: "admin" }), `${u.name} is now an admin.`) },
        { label: "Send password reset", icon: "mail", onSelect: () => run(adminPost(`/users/${u.id}/reset-password`, {}), `Reset code sent to ${u.email}.`) },
        { label: "Sign out everywhere", icon: "logout", onSelect: () => setConfirm("signout") },
        "divider",
        u.suspended_at
          ? { label: "Unsuspend", icon: "check", onSelect: () => run(adminPatch(`/users/${u.id}`, { suspended: false }), `${u.name} can sign in again.`) }
          : { label: "Suspend", icon: "x", danger: true, onSelect: () => setConfirm("suspend") },
      ]} trigger={({ open, toggle, ref }) => (
        <button ref={ref} onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${u.name}`}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><Icon name="dots" /></button>
      )} />
      {confirm === "suspend" && (
        <ConfirmDialog title={`Suspend ${u.name}?`} confirmLabel="Suspend" danger onCancel={() => setConfirm(null)}
          onConfirm={async () => { await run(adminPatch(`/users/${u.id}`, { suspended: true }), `${u.name} is suspended and was signed out.`); setConfirm(null); }}>
          They'll be signed out straight away and can't sign in until you unsuspend them. Their data is kept.
        </ConfirmDialog>
      )}
      {confirm === "signout" && (
        <ConfirmDialog title={`Sign ${u.name} out everywhere?`} confirmLabel="Sign out" onCancel={() => setConfirm(null)}
          onConfirm={async () => { await run(adminPost(`/users/${u.id}/sign-out`, {}), `${u.name} was signed out on every device.`); setConfirm(null); }}>
          Every browser and device they're signed in on will need to sign in again. Use this if a device was lost or shared.
        </ConfirmDialog>
      )}
    </>
  );
}

export function Flash({ msg }: { msg: { text: string; error?: boolean } | null }) {
  if (!msg) return null;
  return (
    <div role="status" className={`mb-4 rounded-xl border px-3 py-2.5 text-sm ${msg.error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
      {msg.text}
    </div>
  );
}
