/**
 * Sends crashes in the browser to the API (/api/client-errors), where they appear in
 * Admin → Errors. Catches uncaught errors, failed promises and React render crashes.
 * Each distinct error is sent once per page load, at most 10 per page, and only the
 * message, stack and page path are sent (no form contents or personal data).
 */
import { DEMO } from "./api";

const BASE = (import.meta.env.VITE_API_URL ?? "") + "/api";
const sent = new Set<string>();

export function reportError(error: unknown, component?: string) {
  if (DEMO || sent.size >= 10) return;
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error ?? "Unknown error"));
  const key = `${err.message}|${(err.stack ?? "").split("\n")[1] ?? ""}`;
  if (sent.has(key)) return;
  sent.add(key);
  const body = JSON.stringify({
    message: `${err.name && err.name !== "Error" ? `${err.name}: ` : ""}${err.message}`.slice(0, 2000),
    stack: err.stack?.slice(0, 8000),
    url: location.pathname,           // path only: no query strings (they can hold tokens)
    component: component?.slice(0, 2000),
  });
  try {
    // keepalive lets the report finish even if the page is closing.
    fetch(`${BASE}/client-errors`, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  } catch { /* reporting must never cause another error */ }
}

export function installGlobalErrorHandlers() {
  window.addEventListener("error", (e) => {
    // Ignore failed <img>/<script> loads (no error object) and cross-origin "Script error." noise.
    if (e.error) reportError(e.error);
  });
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason));
}
