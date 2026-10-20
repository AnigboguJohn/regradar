/**
 * One place for every call the web app makes to the API.
 * Adds the sign-in token, turns error responses into ApiError, sends the user
 * back to /login when the session expires, and in demo builds (VITE_DEMO=1)
 * answers from the in-browser sample data in demo.ts instead of a server.
 */
const BASE = (import.meta.env.VITE_API_URL ?? "") + "/api";
const TOKEN_KEY = "regradar.token";

// "Remember me" keeps the session in localStorage (survives closing the browser);
// otherwise it lives in sessionStorage and ends when the browser closes.
export const tokenStore = {
  get: () => {
    try { return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  /** remember: where to keep it. Left out, a refreshed token stays wherever the current one is. */
  set: (t: string | null, remember?: boolean) => {
    try {
      const keep = remember ?? localStorage.getItem(TOKEN_KEY) !== null;
      localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY);
      if (t) (keep ? localStorage : sessionStorage).setItem(TOKEN_KEY, t);
    } catch { /* storage blocked: the session lasts until the page is closed */ }
  },
};

export class ApiError extends Error {
  /** code: a machine-readable reason from the API, e.g. "bad_credentials" or "email_taken". */
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export const DEMO = import.meta.env.VITE_DEMO === "1";

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  if (DEMO) {
    const { demoApi } = await import("./demo");
    try { return await demoApi(path, init); }
    catch (e: any) { throw new ApiError(e.status ?? 500, e.message, e.code); }
  }
  const token = tokenStore.get();
  const isForm = init.body instanceof FormData;
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      ...(isForm || !init.body ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  // Expired session (12 hours) or password changed elsewhere: forget the token and go to sign-in.
  if (res.status === 401 && token && !path.startsWith("/auth/")) {
    tokenStore.set(null);
    window.location.assign("/login?expired=1");
  }
  // The company or the user was suspended by a RegRadar admin.
  if (res.status === 403 && token && !path.startsWith("/auth/")) {
    const peek = await res.clone().json().catch(() => ({}));
    if (peek.code === "suspended") { tokenStore.set(null); window.location.assign("/login?suspended=1"); }
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`, body.code);
  return body as T;
}

export const post = <T = any>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const put = <T = any>(path: string, body: unknown) => api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const patch = <T = any>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const del = <T = any>(path: string) => api<T>(path, { method: "DELETE" });

export interface Citation {
  n: number; chunk_id: number; document_id: string; title: string; regulator: string | null;
  ref_no: string | null; published_at: string | null; page: number | null; url: string | null;
  kind: "regulation" | "policy"; excerpt: string;
}

export interface User { id: string; orgId: string; orgName?: string; email: string; name: string; role: "admin" | "member"; createdAt?: string }

export const fmtDate = (d?: string | null) =>
  d ? new Date(d.length === 10 ? d + "T00:00:00" : d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
