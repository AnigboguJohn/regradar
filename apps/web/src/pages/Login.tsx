/**
 * Sign in. Shows a green notice when arriving from sign-up or a password reset
 * (with the email pre-filled), a "session expired" notice after ?expired=1, and
 * after a wrong password a link to reset it with an emailed code.
 */
import { useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AuthError, AuthShell, Notice } from "../components/AuthShell";
import { AuthField, PasswordField } from "../components/AuthFields";
import { Recaptcha, useRecaptchaSiteKey, type RecaptchaHandle } from "../components/Recaptcha";
import { ApiError, DEMO } from "../lib/api";
import { useAuth } from "../lib/auth";

export interface AuthNavState { notice?: string; email?: string }

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as AuthNavState;
  const [params] = useSearchParams();
  const siteKey = useRecaptchaSiteKey();
  const captchaRef = useRef<RecaptchaHandle>(null);
  const [email, setEmail] = useState(state.email ?? (DEMO ? "ada@demobank.example" : ""));
  const [password, setPassword] = useState(DEMO ? "demo-password-1" : "");
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const notice = error ? null : state.notice
    ?? (params.get("expired") ? "Your session expired. Please sign in again."
      : params.get("suspended") ? "This account has been suspended. Contact RegRadar support if you think this is a mistake." : null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (siteKey && !captcha) return setError({ message: "Please tick “I'm not a robot” and try again." });
    setBusy(true); setError(null);
    try {
      await login(email, password, captcha, remember);
      navigate("/", { replace: true });
    } catch (err) {
      setError({ message: (err as Error).message, code: (err as ApiError).code });
      captchaRef.current?.reset();
    } finally { setBusy(false); }
  };

  const forgot = () => navigate("/forgot-password", { state: { email } satisfies AuthNavState });

  return (
    <AuthShell title="Sign in" subtitle="Welcome back. Sign in to your RegRadar workspace."
      footer={<>New to RegRadar? <Link to="/signup" className="font-medium text-brand-700 hover:underline">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate={false}>
        {notice && <Notice tone={state.notice ? "success" : "info"}>{notice}</Notice>}
        <AuthError message={error?.message ?? null}>
          {error?.code === "bad_credentials" && (
            <button type="button" onClick={forgot} className="rounded-md bg-red-100 px-2 py-1 font-semibold text-red-800 hover:bg-red-200">
              Forgot your password? Reset it with a code
            </button>
          )}
          {error?.code === "no_account" && (
            <Link to="/signup" state={{ email } satisfies AuthNavState} className="inline-block rounded-md bg-red-100 px-2 py-1 font-semibold text-red-800 hover:bg-red-200">
              Create an account
            </Link>
          )}
        </AuthError>
        <AuthField label="Email" id="email" type="email" required autoComplete="email" autoFocus={!state.email}
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <PasswordField label="Password" id="password" required autoComplete="current-password" autoFocus={!!state.email}
          value={password} onChange={(e) => setPassword(e.target.value)}
          aside={<button type="button" onClick={forgot} className="text-xs font-medium text-brand-700 hover:underline">Forgot password?</button>} />
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-brand-600" />
          Remember me
          <span className="text-xs text-slate-500">· stay signed in for 30 days on this device</span>
        </label>
        {siteKey && <Recaptcha ref={captchaRef} siteKey={siteKey} onChange={setCaptcha} />}
        <button className="btn-primary w-full py-2.5" disabled={busy || siteKey === undefined}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </AuthShell>
  );
}
