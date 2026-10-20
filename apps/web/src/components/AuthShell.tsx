/**
 * Layout shared by the sign-in, sign-up and password-reset pages: a short product
 * story on the left (hidden on phones) and the form card on the right.
 */
import type { ReactNode } from "react";
import { DEMO } from "../lib/api";
import { ComplianceIllustration } from "./ComplianceIllustration";
import { Icon } from "./icons";
import { Logo } from "./Layout";
import { DemoBanner } from "./ui";

export function AuthShell({ title, subtitle, children, footer }: {
  title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <>
      {DEMO && <DemoBanner />}
      <div className="flex min-h-screen gap-5 p-3 md:p-5">
        <section className="panel hidden flex-1 flex-col justify-between p-10 md:flex">
          <Logo />
          <div>
            <ComplianceIllustration className="mx-auto w-full max-w-md" />
            <h2 className="mx-auto mt-8 max-w-md text-center text-2xl font-semibold tracking-tight text-slate-900">
              Stay ahead of every new regulation
            </h2>
            <p className="mx-auto mt-3 max-w-md text-center text-sm leading-relaxed text-slate-600">
              RegRadar tracks new circulars as they're published, Remi answers your questions with citations,
              and you see which of your policies a new rule affects.
            </p>
          </div>
          <span className="text-center text-xs text-slate-500">Built for compliance teams at banks, fintechs and payment companies.</span>
        </section>

        <section className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-[26rem]">
            <div className="mb-6 flex justify-center md:hidden"><Logo /></div>
            <div className="panel p-6 sm:p-8">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
              {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
              <div className="mt-6">{children}</div>
            </div>
            {footer && <div className="mt-5 text-center text-sm text-slate-600">{footer}</div>}
          </div>
        </section>
      </div>
    </>
  );
}

/** Green confirmation banner (e.g. "Account created. Sign in to continue."). */
export function Notice({ children, tone = "success" }: { children: ReactNode; tone?: "success" | "info" }) {
  return (
    <div role="status" className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm ${tone === "success"
      ? "border border-emerald-200 bg-emerald-50 text-emerald-800" : "border border-brand-200 bg-brand-50 text-brand-900"}`}>
      <Icon name={tone === "success" ? "check" : "mail"} className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** Red error banner with an optional follow-up action under the message. */
export function AuthError({ message, children }: { message: string | null; children?: ReactNode }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
      {message}
      {children && <div className="mt-1.5">{children}</div>}
    </div>
  );
}
