# Code tour

A guide for developers reading RegRadar for the first time. Every source file starts with a comment explaining what it does; this page shows how the files fit together.

## Read in this order

1. `db/migrations/001_init.sql`: the data model (organisations, users, documents, chunks, findings, audit log).
2. `services/ai/app/main.py`: the AI service's endpoints.
3. `services/ai/app/retrieval.py` and `prompts.py`: how answers are found and cited (the core of the RAG pipeline).
4. `services/api/src/routes.ts`: every endpoint the website calls.
5. `apps/web/src/main.tsx`, then any page in `apps/web/src/pages/`.

## What happens when someone asks a question

```
Ask.tsx  ──POST /api/ask──►  routes.ts (Node)
                               │  checks the sign-in token, validates input, rate-limits
                               ▼
                          ai.ts ──POST /answer──►  main.py (Python)
                                                     │ retrieval.search(): keyword + optional vector search,
                                                     │   limited to public regulations + this company's documents
                                                     │ prompts.build_answer_messages(): numbered sources [1]..[n]
                                                     │ llm.complete(): Claude / Groq / Gemini / Ollama
                                                     │   (falls back to the backup provider, then to cited passages)
                                                     ▼
                          routes.ts saves question + answer + citations, writes the audit log
                               ▼
Answer.tsx shows the text and turns [1], [2] into clickable sources
```

## What happens every few hours (monitoring)

`jobs.ts runMonitoringCycle()`:

1. Calls the AI service `/ingest/run`, where `ingest.py` asks each source in `sources/` (CBN today) for its document list, downloads only new PDFs, extracts text (`extract.py`), splits it into chunks (`chunking.py`) and stores them.
2. For every company with uploaded policies, runs `/impact` (`impact.py`) on each new regulation.
3. Emails each company a digest based on its alert settings (`alerts.ts`, `mailer.ts`).

It is triggered by AWS EventBridge in production, or by `CRON_INTERVAL_MINUTES` with Docker Compose.

## Rules the code relies on

- **Keep companies' data separate.** Every query on company data filters by organisation id: `req.user.orgId` in the API, `org_id` in the AI service. Regulations from regulator feeds have `org_id = NULL` and are shared.
- **The AI service is internal.** Only the Node API calls it, using `INTERNAL_TOKEN`; it is never exposed publicly.
- **Never invent a citation.** The model must cite `[n]` sources; `used_citations()` keeps only numbers that exist, and `parse_findings()` rejects findings that point at excerpts we didn't send.
- **Degrade, don't fail.** If the AI provider is down or rate-limited, users still get the matching cited passages.

## Adding things

| To add… | Change |
|---|---|
| A regulator | New module in `services/ai/app/sources/` with `SOURCE_ID` and `fetch_listing()`; register it in `sources/__init__.py` |
| An API endpoint | `services/api/src/routes.ts`, plus a function call in the page that uses it |
| A page | A file in `apps/web/src/pages/`, a route in `main.tsx`, a menu item in `Layout.tsx` |
| A database column | A new numbered file in `db/migrations/` (never edit one that has already run) |
| An AI provider | A preset in `services/ai/app/config.py` (any OpenAI-compatible API works) |

## Tests

- `services/ai/tests/`: chunking, CBN parsing, search fusion, citations, AI output parsing, provider settings.
- `services/api/test/`: alert matching and email digests.
- `tests/e2e/`: the full stack through the API (34 checks) and through a real browser.
