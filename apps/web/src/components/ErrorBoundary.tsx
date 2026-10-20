/**
 * If a page crashes while rendering, show a friendly message with a way out instead of a
 * blank screen, and report the crash (Admin → Errors).
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "../lib/errorReporting";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, info.componentStack ?? undefined);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="panel w-full max-w-md p-8 text-center">
          <div className="orb mx-auto h-12 w-12" aria-hidden />
          <h1 className="mt-5 text-xl font-semibold text-slate-900">Something went wrong on this page</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            We've been told about it automatically. Reloading usually fixes it; your conversations and settings are safe.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <button className="btn-primary" onClick={() => location.reload()}>Reload the page</button>
            <a className="btn-ghost" href="/">Go to dashboard</a>
          </div>
        </div>
      </div>
    );
  }
}
