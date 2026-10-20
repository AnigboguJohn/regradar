/**
 * Admin console sign-in: email + password + reCAPTCHA, then a 6-digit code from an
 * authenticator app. The first time, the admin scans a QR code to set the app up.
 */
import { useRef, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { AuthField, PasswordField } from "../components/AuthFields";
import { AuthError, Notice } from "../components/AuthShell";
import { Logo } from "../components/Layout";
import { Recaptcha, useRecaptchaSiteKey, type RecaptchaHandle } from "../components/Recaptcha";
import { ApiError } from "../lib/api";
import { useAdmin, type Admin } from "./AdminAuth";
import { adminPost } from "./adminApi";

type Step =
  | { kind: "password" }
  | { kind: "code"; challenge: string }
  | { kind: "setup"; challenge: string; secret: string; qr: string };

export default function AdminLogin() {
  const { admin, signIn } = useAdmin();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const siteKey = useRecaptchaSiteKey();
  const captchaRef = useRef<RecaptchaHandle>(null);
  const [step, setStep] = useState<Step>({ kind: "password" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (admin) return <Navigate to="/admin" replace />;

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (siteKey && !captcha) return setError("Please tick “I'm not a robot” and try again.");
    setBusy(true); setError(null);
    try {
      const r = await adminPost<{ step: "code" | "setup"; challenge: string; secret?: string; qr?: string }>("/auth/login", { email, password, captcha: captcha ?? undefined });
      setStep(r.step === "setup" ? { kind: "setup", challenge: r.challenge, secret: r.secret!, qr: r.qr! } : { kind: "code", challenge: r.challenge });
      setPassword("");
    } catch (err) {
      setError((err as Error).message);
      captchaRef.current?.reset();
    } finally { setBusy(false); }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (step.kind === "password") return;
    setBusy(true); setError(null);
    try {
      const r = await adminPost<{ token: string; admin: Admin }>("/auth/verify", { challenge: step.challenge, code });
      signIn(r.token, r.admin);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError((err as Error).message); setCode("");
      if ((err as ApiError).code === "challenge_expired") setStep({ kind: "password" });
    } finally { setBusy(false); }
  };

  const codeField = (
    <AuthField label="6-digit code" id="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
      placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
      className="text-center font-mono text-lg tracking-[0.5em]" />
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-[26rem]">
        <div className="mb-6 flex items-center justify-center gap-3 [&_span]:text-white">
          <Logo />
          <span className="rounded-md border border-white/15 px-2 py-0.5 text-xs font-medium uppercase tracking-wider !text-slate-300">Admin</span>
        </div>
        <div className="rounded-[20px] bg-white p-6 shadow-2xl sm:p-8">
          {step.kind === "password" && (
            <form onSubmit={submitPassword} className="space-y-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Admin console</h1>
                <p className="mt-1.5 text-sm text-slate-500">For RegRadar platform administrators only.</p>
              </div>
              {params.get("expired") && !error && <Notice tone="info">Your admin session ended. Please sign in again.</Notice>}
              <AuthError message={error} />
              <AuthField label="Email" id="email" type="email" required autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
              <PasswordField label="Password" id="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              {siteKey && <Recaptcha ref={captchaRef} siteKey={siteKey} onChange={setCaptcha} />}
              <button className="btn-primary w-full py-2.5" disabled={busy || siteKey === undefined}>{busy ? "Checking…" : "Continue"}</button>
            </form>
          )}

          {step.kind === "code" && (
            <form onSubmit={submitCode} className="space-y-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Enter your code</h1>
                <p className="mt-1.5 text-sm text-slate-500">Open your authenticator app and enter the 6-digit code for <strong className="text-slate-700">RegRadar Admin</strong>.</p>
              </div>
              <AuthError message={error} />
              {codeField}
              <button className="btn-primary w-full py-2.5" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Sign in"}</button>
              <button type="button" className="w-full text-center text-sm text-slate-500 hover:text-slate-800" onClick={() => { setStep({ kind: "password" }); setError(null); }}>Start again</button>
            </form>
          )}

          {step.kind === "setup" && (
            <form onSubmit={submitCode} className="space-y-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Set up two-step sign-in</h1>
                <p className="mt-1.5 text-sm text-slate-500">Admin accounts need a code from your phone on every sign-in. This is a one-time setup.</p>
              </div>
              <ol className="space-y-3 text-sm text-slate-700">
                <li><span className="font-semibold">1.</span> Install an authenticator app: Google Authenticator, Microsoft Authenticator or 1Password.</li>
                <li><span className="font-semibold">2.</span> In the app, add an account and scan this QR code:</li>
              </ol>
              <div className="flex justify-center rounded-xl border border-slate-200 bg-white p-3">
                <img src={step.qr} alt="QR code for your authenticator app" width={200} height={200} />
              </div>
              <details className="text-xs text-slate-500">
                <summary className="cursor-pointer font-medium text-slate-600">Can't scan? Enter this key instead</summary>
                <code className="mt-2 block break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-[13px] tracking-wider text-slate-800">{step.secret.match(/.{1,4}/g)!.join(" ")}</code>
              </details>
              <p className="text-sm text-slate-700"><span className="font-semibold">3.</span> Enter the 6-digit code the app shows:</p>
              <AuthError message={error} />
              {codeField}
              <button className="btn-primary w-full py-2.5" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Turn on and sign in"}</button>
            </form>
          )}
        </div>
        <p className="mt-5 text-center text-xs text-slate-500">Every admin sign-in and action is recorded.</p>
      </div>
    </div>
  );
}
