/**
 * Landing page for a team invite link (/invite/:token). The invitee sees who invited
 * them and to which company, chooses their name and password, and is then sent to
 * sign in with their email pre-filled. Used, cancelled or expired links explain what to do.
 */
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AuthError, AuthShell } from "../components/AuthShell";
import { AuthField, PasswordField } from "../components/AuthFields";
import { passwordRules, PasswordRules } from "../components/PasswordRules";
import { Spinner } from "../components/ui";
import { api, ApiError, post } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { AuthNavState } from "./Login";

interface Invite { email: string; role: "admin" | "member"; orgName: string; inviterName: string }

export default function AcceptInvite() {
  const { token = "" } = useParams();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [problem, setProblem] = useState<{ message: string; code?: string } | null>(null);
  const [f, setF] = useState({ name: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Invite>(`/auth/invites/${encodeURIComponent(token)}`)
      .then(setInvite)
      .catch((e: ApiError) => setProblem({ message: e.message, code: e.code }));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const broken = passwordRules(f.password, f.confirm).find((r) => !r.ok);
    if (broken) return setError(broken.text === "Both passwords match" ? "The two passwords don't match." : `Password needs: ${broken.text.toLowerCase()}.`);
    setBusy(true); setError(null);
    try {
      await post(`/auth/invites/${encodeURIComponent(token)}/accept`, { name: f.name, password: f.password, confirmPassword: f.confirm });
      navigate("/login", { replace: true, state: { notice: `You've joined ${invite!.orgName}. Sign in to continue.`, email: invite!.email } satisfies AuthNavState });
    } catch (err) {
      const e = err as ApiError;
      // A link that stopped working while the form was open: show the full-page explanation.
      if (e.code && ["invalid", "revoked", "used", "expired", "account_exists"].includes(e.code)) setProblem({ message: e.message, code: e.code });
      else setError(e.message);
    } finally { setBusy(false); }
  };

  if (user) {
    return (
      <AuthShell title="You're already signed in" subtitle={<>You're signed in as <span className="font-medium text-slate-700">{user.email}</span>.</>}>
        <p className="text-sm text-slate-600">To accept this invite with a different email, sign out first and then open the invite link again.</p>
        <div className="mt-5 flex gap-2">
          <Link to="/" className="btn-ghost flex-1">Go to dashboard</Link>
          <button className="btn-primary flex-1" onClick={logout}>Sign out</button>
        </div>
      </AuthShell>
    );
  }

  if (problem) {
    const signIn = problem.code === "used" || problem.code === "account_exists";
    return (
      <AuthShell title={signIn ? "Invite already used" : "This invite can't be used"}>
        <AuthError message={problem.message} />
        <Link to={signIn ? "/login" : "/signup"} className="btn-primary mt-5 w-full py-2.5">{signIn ? "Go to sign in" : "Create your own account instead"}</Link>
      </AuthShell>
    );
  }

  if (!invite) return <AuthShell title="Opening your invite…"><Spinner /></AuthShell>;

  return (
    <AuthShell title={`Join ${invite.orgName}`}
      subtitle={<><span className="font-medium text-slate-700">{invite.inviterName}</span> invited you to RegRadar as {invite.role === "admin" ? "an admin" : "a member"}. Choose your name and password to join.</>}
      footer={<>Already have an account? <Link to="/login" className="font-medium text-brand-700 hover:underline">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <AuthError message={error} />
        <AuthField label="Email" id="email" type="email" value={invite.email} readOnly disabled
          hint="The invite was sent to this address. You'll sign in with it." className="bg-slate-50 text-slate-500" />
        <AuthField label="Your name" id="name" required minLength={2} maxLength={120} autoComplete="name" autoFocus
          value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <PasswordField label="Password" id="password" required autoComplete="new-password" value={f.password}
          onChange={(e) => setF({ ...f, password: e.target.value })} />
        <PasswordField label="Confirm password" id="confirm" required autoComplete="new-password" value={f.confirm}
          onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        <PasswordRules password={f.password} confirm={f.confirm} />
        <button className="btn-primary w-full py-2.5" disabled={busy}>{busy ? "Joining…" : `Join ${invite.orgName}`}</button>
      </form>
    </AuthShell>
  );
}
