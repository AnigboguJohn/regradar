/** Form fields used on the sign-in, sign-up and password-reset pages. */
import { useState, type InputHTMLAttributes, type ReactNode } from "react";

export function AuthField({ label, id, aside, hint, ...input }: {
  label: string; id: string; aside?: ReactNode; hint?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-slate-700">{label}</label>
        {aside}
      </div>
      <input id={id} {...input} className={`input py-2.5 ${input.className ?? ""}`} />
      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Password input with a Show / Hide switch. */
export function PasswordField(props: { label: string; id: string; aside?: ReactNode; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const [shown, setShown] = useState(false);
  const { label, id, aside, hint, ...input } = props;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-slate-700">{label}</label>
        {aside}
      </div>
      <div className="relative">
        <input id={id} type={shown ? "text" : "password"} {...input} className="input py-2.5 pr-16" />
        <button type="button" onClick={() => setShown(!shown)} aria-controls={id} aria-pressed={shown}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800">
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
