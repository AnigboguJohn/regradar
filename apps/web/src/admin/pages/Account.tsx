/** The signed-in admin's own account: details, password change and how 2FA recovery works. */
import { useState, type FormEvent } from "react";
import { PasswordField } from "../../components/AuthFields";
import { passwordRules, PasswordRules } from "../../components/PasswordRules";
import { ErrorNote } from "../../components/ui";
import { useAdmin } from "../AdminAuth";
import { adminPost, adminToken } from "../adminApi";
import { PageHeader, Panel, fmtWhen } from "../ui";
import { Flash } from "./UserActions";

export default function AdminAccount() {
  const { admin } = useAdmin();
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string } | null>(null);
  const ready = !!f.current && f.next.length >= 14 && passwordRules(f.next, f.confirm).every((r) => r.ok);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setMsg(null);
    try {
      const r = await adminPost<{ token: string }>("/me/password", { current: f.current, next: f.next });
      adminToken.set(r.token);   // other admin sessions end; this one continues
      setF({ current: "", next: "", confirm: "" });
      setMsg({ text: "Password changed. Any other admin sessions were signed out." });
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="My admin account" />
      <Flash msg={msg} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Account">
          <dl className="space-y-3 text-sm">
            <div><dt className="text-slate-500">Name</dt><dd className="font-medium text-slate-900">{admin?.name}</dd></div>
            <div><dt className="text-slate-500">Email</dt><dd className="font-medium text-slate-900">{admin?.email}</dd></div>
            <div><dt className="text-slate-500">Previous sign-in</dt><dd className="text-slate-900">{fmtWhen(admin?.last_login_at)}</dd></div>
            <div><dt className="text-slate-500">Two-step sign-in</dt><dd className="text-slate-900">On (authenticator app)</dd></div>
          </dl>
          <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
            Lost your phone? Someone with server access runs <code className="font-mono">admin.js reset-2fa --email {admin?.email}</code>,
            and your next sign-in shows a new QR code. See <code className="font-mono">docs/ADMIN.md</code>.
          </p>
        </Panel>
        <form onSubmit={save}>
          <Panel title="Change password" description="Admin passwords need at least 14 characters, with letters and numbers.">
            <div className="space-y-4">
              <ErrorNote error={error} />
              <PasswordField label="Current password" id="cur" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
              <PasswordField label="New password" id="new" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })}
                hint={f.next && f.next.length < 14 ? `${14 - f.next.length} more character(s) needed for an admin password` : undefined} />
              <PasswordField label="Confirm new password" id="conf" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
              <PasswordRules password={f.next} confirm={f.confirm} />
              <button className="btn-primary" disabled={!ready || busy}>{busy ? "Saving…" : "Change password"}</button>
            </div>
          </Panel>
        </form>
      </div>
    </>
  );
}
