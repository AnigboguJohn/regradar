/** Live checklist for a new password: the same rules the API enforces. */
import { Icon } from "./icons";

export function passwordRules(password: string, confirm: string) {
  return [
    { ok: password.length >= 10, text: "At least 10 characters" },
    { ok: /[A-Za-z]/.test(password) && /\d/.test(password), text: "Letters and numbers" },
    { ok: !!password && password === confirm, text: "Both passwords match" },
  ];
}

export function PasswordRules({ password, confirm }: { password: string; confirm: string }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs" aria-label="Password requirements">
      {passwordRules(password, confirm).map((r) => (
        <li key={r.text} className={`flex items-center gap-1.5 ${r.ok ? "text-emerald-700" : "text-slate-500"}`}>
          <span className={`flex h-4 w-4 items-center justify-center rounded-full ${r.ok ? "bg-emerald-100" : "bg-slate-100"}`}>
            {r.ok && <Icon name="check" className="h-3 w-3" />}
          </span>
          {r.text}
        </li>
      ))}
    </ul>
  );
}
