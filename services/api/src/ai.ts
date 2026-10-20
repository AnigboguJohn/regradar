/**
 * HTTP client for the internal Python AI service.
 * Every call sends the shared INTERNAL_TOKEN; the AI service is never exposed to
 * the internet. Errors are converted to AiError so routes can return clear messages.
 */
import { config } from "./config.js";

export class AiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 120_000);
  try {
    const res = await fetch(`${config.aiUrl}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { "x-internal-token": config.internalToken, ...(init.headers ?? {}) },
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) throw new AiError(res.status, typeof body.detail === "string" ? body.detail : "AI service error");
    return body as T;
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError(502, (e as Error).name === "AbortError" ? "AI service timed out" : "AI service unavailable");
  } finally {
    clearTimeout(timer);
  }
}

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export interface Citation {
  n: number;
  chunk_id: number;
  document_id: string;
  title: string;
  regulator: string | null;
  ref_no: string | null;
  published_at: string | null;
  page: number | null;
  url: string | null;
  kind: "regulation" | "policy";
  excerpt: string;
}

export const ai = {
  health: () => call<{ ok: boolean; llm: boolean; llm_provider?: string | null; embeddings: boolean; sources?: string[] }>("/health", { timeoutMs: 5000 }),
  answer: (b: { org_id: string; question: string; scope?: string; regulators?: string[]; history?: { question: string; answer: string }[] }) =>
    call<{ answer: string; citations: Citation[]; mode: "llm" | "extractive" | "chat"; retrieved: number }>("/answer", json(b)),
  search: (b: { org_id: string; query: string; scope?: string; k?: number }) =>
    call<{ results: any[] }>("/search", json(b)),
  runIngest: (b: { sources?: string[]; limit?: number } = {}) =>
    call<{ runs: { source_id: string; new_document_ids: string[]; failed: any[]; error: string | null }[] }>(
      "/ingest/run", { ...json(b), timeoutMs: 15 * 60_000 }),
  upload: (form: FormData) => call<{ document_id: string }>("/ingest/upload", { method: "POST", body: form, timeoutMs: 5 * 60_000 }),
  /** Index a file for an existing regulator circular whose automatic download failed. */
  attach: (form: FormData) => call<{ document_id: string }>("/ingest/attach", { method: "POST", body: form, timeoutMs: 5 * 60_000 }),
  impact: (b: { org_id: string; regulation_id: string }) =>
    call<{ findings: any[] }>("/impact", { ...json(b), timeoutMs: 5 * 60_000 }),
};
