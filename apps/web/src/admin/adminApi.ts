/**
 * API client for the platform admin console. Admin sessions are separate from company
 * sessions: their own token, kept in sessionStorage only (gone when the browser closes),
 * and an expired session returns to /admin/login rather than the company sign-in page.
 */
import { ApiError } from "../lib/api";

const BASE = (import.meta.env.VITE_API_URL ?? "") + "/api/admin";
const KEY = "regradar.admin";

export const adminToken = {
  get: () => { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set: (t: string | null) => { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch { /* ignore */ } },
};

async function request(path: string, init: RequestInit = {}) {
  const token = adminToken.get();
  const isForm = init.body instanceof FormData;
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      ...(isForm || !init.body ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 401 && token && !path.startsWith("/auth/")) {
    adminToken.set(null);
    window.location.assign("/admin/login?expired=1");
  }
  return res;
}

export async function adminApi<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await request(path, init);
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`, body.code);
  return body as T;
}

export const adminPost = <T = any>(path: string, body: unknown) => adminApi<T>(path, { method: "POST", body: JSON.stringify(body) });
export const adminPatch = <T = any>(path: string, body: unknown) => adminApi<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const adminDelete = (path: string) => adminApi(path, { method: "DELETE" });

/** Download a file from an admin endpoint (the token can't go in a plain link). */
export async function adminDownload(path: string, fallbackName: string) {
  const res = await request(path);
  if (!res.ok) throw new ApiError(res.status, "Download failed");
  const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}
