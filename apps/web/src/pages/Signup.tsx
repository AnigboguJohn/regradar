/**
 * Sign up: creates the company and its first user (an admin). On success the
 * user goes to the sign-in page with the email pre-filled and a green notice.
 */
import { useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { AuthError, AuthShell } from "../components/AuthShell";
import { AuthField, PasswordField } from "../components/AuthFields";
import { passwordRules, PasswordRules } from "../components/PasswordRules";
import { Recaptcha, useRecaptchaSiteKey, type RecaptchaHandle } from "../components/Recaptcha";
import { ApiError, DEMO } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { AuthNavState } from "./Login";

export default function Signup() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const prefill = ((useLocation().state ?? {}) as AuthNavState).email ?? "";
  const siteKey = useRecaptchaSiteKey();
  const captchaRef = useRef<RecaptchaHandle>(null);
  const [f, setF] = useState(DEMO
    ? { orgName: "Demo Bank Plc", name: "Ada Obi", email: "ada@demobank.example", password: "demo-password-1", confirmPassword: "demo-password-1" }
    : { orgName: "", name: "", email: prefill, password: "", confirmPassword: "" });
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const broken = passwordRules(f.password, f.confirmPassword).find((r) => !r.ok);
    if (broken) return setError({ message: broken.text === "Both passwords match" ? "The two passwords don't match." : `Password needs: ${broken.text.toLowerCase()}.` });
    if (siteKey && !captcha) return setError({ message: "Please tick “I'm not a robot” and try again." });
    setBusy(true); setError(null);
    try {
      await register({ ...f, captcha });
      navigate("/login", { state: { notice: "Account created. Sign in to continue.", email: f.email.trim().toLowerCase() } satisfies AuthNavState });
    } catch (err) {
      setError({ message: (err as Error).message, code: (err as ApiError).code });
      captchaRef.current?.reset();
    } finally { setBusy(false); }
  };

  return (
    <AuthShell title="Create your account" subtitle="Set up a workspace for your company. You'll be its admin."
      footer={<>Already have an account? <Link to="/login" className="font-medium text-brand-700 hover:underline">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <AuthError message={error?.code === "email_taken" ? "An account with this email already exists." : error?.message ?? null}>
          {error?.code === "email_taken" && (
            <Link to="/login" state={{ email: f.email.trim().toLowerCase() } satisfies AuthNavState}
              className="rounded-md bg-red-100 px-2 py-1 font-semibold text-red-800 hover:bg-red-200">
              Sign in instead?
            </Link>
          )}
        </AuthError>
        <AuthField label="Company name" id="org" required minLength={2} maxLength={120} autoComplete="organization" autoFocus
          value={f.orgName} onChange={set("orgName")} />
        <AuthField label="Your name" id="name" required minLength={2} maxLength={120} autoComplete="name" value={f.name} onChange={set("name")} />
        <AuthField label="Work email" id="email" type="email" required autoComplete="email" value={f.email} onChange={set("email")} />
        <PasswordField label="Password" id="password" required autoComplete="new-password" value={f.password} onChange={set("password")} />
        <PasswordField label="Confirm password" id="confirm" required autoComplete="new-password" value={f.confirmPassword} onChange={set("confirmPassword")} />
        <PasswordRules password={f.password} confirm={f.confirmPassword} />
        {siteKey && <Recaptcha ref={captchaRef} siteKey={siteKey} onChange={setCaptcha} />}
        <button className="btn-primary w-full py-2.5" disabled={busy || siteKey === undefined}>{busy ? "Creating account…" : "Create account"}</button>
      </form>
    </AuthShell>
  );
}
