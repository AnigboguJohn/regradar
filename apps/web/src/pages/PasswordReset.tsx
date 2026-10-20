/**
 * Forgot password (ask for a code) and Reset password (enter the code and a new password).
 * An email with no account is told to sign up instead. The code expires after
 * 5 minutes and locks after 5 wrong tries.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { AuthError, AuthShell, Notice } from "../components/AuthShell";
import { AuthField, PasswordField } from "../components/AuthFields";
import { passwordRules, PasswordRules } from "../components/PasswordRules";
import { Recaptcha, useRecaptchaSiteKey, type RecaptchaHandle } from "../components/Recaptcha";
import { ApiError, post } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { AuthNavState } from "./Login";

interface ResetNavState { email?: string; message?: string; sentAt?: number }
const RESEND_SECONDS = 60;

function requestCode(email: string, captcha: string | null) {
  return post<{ message: string; resendAfterSeconds: number }>("/auth/forgot", { email, captcha: captcha ?? undefined });
}

export function ForgotPassword() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as AuthNavState;
  const siteKey = useRecaptchaSiteKey();
  const captchaRef = useRef<RecaptchaHandle>(null);
  const [email, setEmail] = useState(state.email ?? "");
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (siteKey && !captcha) return setError({ message: "Please tick “I'm not a robot” and try again." });
    setBusy(true); setError(null);
    try {
      const r = await requestCode(email, captcha);
      navigate("/reset-password", { state: { email: email.trim().toLowerCase(), message: r.message, sentAt: Date.now() } satisfies ResetNavState });
    } catch (err) {
      setError({ message: (err as Error).message, code: (err as ApiError).code });
      captchaRef.current?.reset();
    } finally { setBusy(false); }
  };

  return (
    <AuthShell title="Reset your password" subtitle="Enter your account's email and we'll send you a 6-digit code."
      footer={<Link to="/login" state={{ email } satisfies AuthNavState} className="font-medium text-brand-700 hover:underline">Back to sign in</Link>}>
      <form onSubmit={submit} className="space-y-4">
        <AuthError message={error?.message ?? null}>
          {error?.code === "no_account" && (
            <Link to="/signup" state={{ email } satisfies AuthNavState} className="inline-block rounded-md bg-red-100 px-2 py-1 font-semibold text-red-800 hover:bg-red-200">
              Create an account
            </Link>
          )}
        </AuthError>
        <AuthField label="Email" id="email" type="email" required autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        {siteKey && <Recaptcha ref={captchaRef} siteKey={siteKey} onChange={setCaptcha} />}
        <button className="btn-primary w-full py-2.5" disabled={busy || siteKey === undefined}>{busy ? "Sending…" : "Send code"}</button>
      </form>
    </AuthShell>
  );
}

export function ResetPassword() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as ResetNavState;
  const siteKey = useRecaptchaSiteKey();
  const captchaRef = useRef<RecaptchaHandle>(null);
  const [email, setEmail] = useState(state.email ?? "");
  const [f, setF] = useState({ code: "", password: "", confirm: "" });
  const [info, setInfo] = useState<string | null>(state.message ?? null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Resend becomes available 60 seconds after the last code was requested.
  const [sentAt, setSentAt] = useState(state.sentAt ?? 0);
  const [now, setNow] = useState(Date.now());
  const [resending, setResending] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (user) return <Navigate to="/" replace />;

  const wait = Math.max(0, RESEND_SECONDS - Math.floor((now - sentAt) / 1000));
  const needsNewCode = error?.code === "expired" || error?.code === "locked" || error?.code === "no_code";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const broken = passwordRules(f.password, f.confirm).find((r) => !r.ok);
    if (!/^\d{6}$/.test(f.code)) return setError({ message: "Enter the 6-digit code from the email." });
    if (broken) return setError({ message: broken.text === "Both passwords match" ? "The two new passwords don't match." : `New password needs: ${broken.text.toLowerCase()}.` });
    setBusy(true); setError(null); setInfo(null);
    try {
      await post("/auth/reset", { email, code: f.code, password: f.password, confirmPassword: f.confirm });
      navigate("/login", { replace: true, state: { notice: "Password changed. Sign in with your new password.", email } satisfies AuthNavState });
    } catch (err) {
      setError({ message: (err as Error).message, code: (err as ApiError).code });
      if ((err as ApiError).code === "wrong_code") setF((v) => ({ ...v, code: "" }));
    } finally { setBusy(false); }
  };

  const resend = async () => {
    if (siteKey && !captcha) return setError({ message: "Please tick “I'm not a robot” to get a new code." });
    setBusy(true); setError(null);
    try {
      const r = await requestCode(email, captcha);
      setInfo(r.message); setSentAt(Date.now()); setResending(false); setF((v) => ({ ...v, code: "" }));
    } catch (err) {
      setError({ message: (err as Error).message });
      captchaRef.current?.reset();
    } finally { setBusy(false); }
  };

  return (
    <AuthShell title="Enter your code" subtitle={email ? <>We sent a 6-digit code to <span className="font-medium text-slate-700">{email}</span>. It expires in 5 minutes.</> : "Enter the email you used and the code we sent you."}
      footer={<Link to="/login" state={{ email } satisfies AuthNavState} className="font-medium text-brand-700 hover:underline">Back to sign in</Link>}>
      <form onSubmit={submit} className="space-y-4">
        {info && !error && <Notice tone="info">{info}</Notice>}
        <AuthError message={error?.message ?? null}>
          {needsNewCode && (
            <button type="button" onClick={() => { setResending(true); setError(null); }}
              className="rounded-md bg-red-100 px-2 py-1 font-semibold text-red-800 hover:bg-red-200">Request a new code</button>
          )}
        </AuthError>
        {!state.email && (
          <AuthField label="Email" id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        )}
        <AuthField label="6-digit code" id="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}"
          autoFocus={!!state.email} placeholder="••••••" value={f.code}
          onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, "").slice(0, 6) })}
          className="text-center font-mono text-lg tracking-[0.5em]" />
        <PasswordField label="New password" id="new-password" required autoComplete="new-password" value={f.password}
          onChange={(e) => setF({ ...f, password: e.target.value })} />
        <PasswordField label="Confirm new password" id="confirm-password" required autoComplete="new-password" value={f.confirm}
          onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        <PasswordRules password={f.password} confirm={f.confirm} />
        <button className="btn-primary w-full py-2.5" disabled={busy}>{busy ? "Please wait…" : "Change password"}</button>

        <div className="border-t border-slate-100 pt-4 text-center text-sm text-slate-500">
          {resending ? (
            <div className="space-y-3 text-left">
              {siteKey && <Recaptcha ref={captchaRef} siteKey={siteKey} onChange={setCaptcha} />}
              <div className="flex gap-2">
                <button type="button" className="btn-ghost flex-1" onClick={() => setResending(false)}>Cancel</button>
                <button type="button" className="btn-primary flex-1" disabled={busy || !email || wait > 0} onClick={resend}>
                  {wait > 0 ? `Send new code in ${wait}s` : "Send new code"}
                </button>
              </div>
            </div>
          ) : wait > 0 ? (
            <>Didn't get it? You can resend the code in <span className="font-medium tabular-nums text-slate-700">{wait}s</span>.</>
          ) : (
            <>Didn't get it? <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setResending(true)}>Resend code</button></>
          )}
        </div>
      </form>
    </AuthShell>
  );
}
