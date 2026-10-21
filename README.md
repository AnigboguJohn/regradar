# RegRadar: Real-time Regulatory Compliance Assistant

**Live demo:** `https://<your-github-username>.github.io/regradar/` (browser-only preview with sample data; see [Publish to GitHub](#publish-to-github))

RegRadar monitors financial regulators around the clock, indexes every new circular, and lets compliance teams:

1. **Ask questions in plain English** and get answers grounded in the actual regulations, with every claim **cited to the exact document, reference number and page**.
2. **Get automatic impact analysis**: each new regulation is checked against the company's own internal policies, and conflicts are flagged with severity, evidence and a recommended fix.
3. **Receive alerts**: an email digest whenever a relevant regulation is published.
4. **Keep an audit trail** of every question, answer and action, which regulators expect.

The first source is the **Central Bank of Nigeria (CBN)** circulars feed. Adding more regulators (SEC Nigeria, NDPC, FCA, RBI…) means adding one small module (see [Adding a regulator](#adding-a-regulator)), and organisations can also upload any regulation manually.

---

New to the code? Start with the [code tour](docs/CODE_TOUR.md). **Free live link:** [deploy on Render](docs/DEPLOY_RENDER.md) (website, API and Remi in one free service). Running the service? See the [admin console guide](docs/ADMIN.md) (`/admin`) and [monitoring and testing](docs/MONITORING_AND_TESTING.md).

## Architecture

```
                 ┌──────────────────────────── AWS ───────────────────────────────┐
 Browser ──HTTPS─► CloudFront ──► S3 (React app)                                  │
                 │      └─ /api/* ──► ALB ──► ECS Fargate: API (Node.js/Express)  │
                 │                               │   auth · tenants · audit       │
                 │                               │   alerts · scheduling          │
                 │                               ▼                                │
                 │                    ECS Fargate: AI service (Python/FastAPI)    │
                 │                      ingest · chunk · hybrid search · RAG      │
                 │                      impact analysis ──► Claude API            │
                 │                               │                                │
                 │            RDS PostgreSQL 16 + pgvector (data, full-text,      │
                 │                                          embeddings)           │
                 │ EventBridge (every 3h) ──► /internal/cron/monitor               │
                 └────────────────────────────────────────────────────────────────┘
```

| Layer | Tech | Where |
|---|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind | `apps/web` |
| Backend API | Node.js 22, Express, TypeScript, zod, JWT, pg | `services/api` |
| AI engineering | Python 3.12, FastAPI, pdfplumber, Postgres FTS + pgvector, RRF fusion; Claude, Groq, Gemini or Ollama | `services/ai` |
| Database | PostgreSQL 16 + pgvector | `db/migrations` |
| Cloud | Terraform: VPC, ECS Fargate, ALB, RDS, S3, CloudFront, EventBridge, Secrets Manager, ECR | `infra/terraform` |
| CI/CD | GitHub Actions (tests on every PR, deploy on `main`) | `.github/workflows` |

### How the RAG pipeline works

1. **Ingest:** the scheduler calls the AI service, which pulls the CBN circular listing (`/api/GetAllCirculars`), skips anything already indexed, and downloads new PDFs. One broken PDF never stops a run, and scanned PDFs keep their metadata searchable.
2. **Chunk:** `chunking.py` splits text on section headings (e.g. "4.2 Customer Due Diligence"), keeps each chunk's heading and page number, and overlaps chunks so rules spanning a boundary are still found.
3. **Retrieve:** hybrid search combines **Postgres full-text** (great for exact terms like "BVN", "Tier 1", reference numbers) and, optionally, **pgvector semantic search**, merged with **Reciprocal Rank Fusion** and capped per document so one long circular can't dominate.
4. **Generate:** Claude answers **only from the retrieved sources**, cites `[n]` per sentence, quotes figures exactly, and says so when the sources don't answer the question. The citations are returned as structured data and shown in the UI with the original excerpt and a PDF link.
5. **Impact:** for each new regulation, the most related passages of each organisation's policies are retrieved, Claude compares them and returns structured findings (severity, summary, recommendation, quote), and hallucinated excerpt ids are rejected by the parser.

**Multi-tenancy:** regulations are shared; policies, findings, chats and audit logs are private per organisation, enforced in every SQL query.

**Free to run.** With no AI key, RegRadar runs in *extractive mode* and shows the best-matching cited passages. For written AI answers at no cost, set `LLM_PROVIDER=groq` or `gemini` (free tiers, no credit card) or `ollama` (runs on your own computer) in `.env`; see `.env.example`. Claude (`ANTHROPIC_API_KEY`) is the paid option with the best quality. On free tiers RegRadar sends shorter prompts to stay within rate limits, retries when rate-limited, and falls back to extractive mode if the provider is unavailable.

---

## Run it locally (about 10 minutes)

Prerequisites: [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
cp .env.example .env          # optionally paste your ANTHROPIC_API_KEY
docker compose up --build
```

Open **http://localhost:8080**, create a workspace, then go to **Settings → Check now** to pull the latest CBN circulars. Upload a policy under **Our policies**, open a regulation and click **Check impact on our policies**.

### Developing without Docker

```bash
# database
docker run -d -p 5432:5432 -e POSTGRES_USER=regradar -e POSTGRES_PASSWORD=regradar -e POSTGRES_DB=regradar pgvector/pgvector:pg16
# API (runs migrations on start)          → http://localhost:4000
cd services/api && npm install && npm run dev
# AI service                               → http://localhost:8000/docs
cd services/ai && pip install -r requirements.txt && uvicorn app.main:app --reload
# Web                                      → http://localhost:5173
cd apps/web && npm install && npm run dev
```

### Tests

```bash
cd services/ai && python -m pytest -q      # chunking, CBN parser, fusion, citations, impact JSON parsing
cd services/api && npm test                # alert matching and digest
python tests/e2e/api_e2e.py                # 34 end-to-end API checks against a running stack
node tests/e2e/ui_e2e.mjs                  # browser walkthrough of every screen (Playwright)
```

CI runs the unit tests, type checks, migration check and web build on every push.

## Publish to GitHub

```bash
gh auth login                     # once
./scripts/push-to-github.sh       # creates the repo, pushes, and turns on GitHub Pages
```

The `Demo on GitHub Pages` workflow then publishes the browser-only demo (`npm run build:demo`: the real UI with in-browser sample data) at `https://<username>.github.io/regradar/`. The full product (API, AI service, database) needs a server: see [Deploy to AWS](#deploy-to-aws).

---

## Deploy to AWS

1. Create an AWS account and an IAM user with admin rights, then run `aws configure`.
2. Install [Terraform](https://developer.hashicorp.com/terraform/install), Docker and Node 22.
3. `cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars` and fill it in.
4. `./scripts/deploy-aws.sh`

It prints your app URL (`https://xxxx.cloudfront.net`). **Estimated cost: about $45–70/month** idle (RDS micro + ALB + 2 small Fargate tasks); there's no NAT gateway, to keep it cheap. Remove everything with `terraform -chdir=infra/terraform destroy`.

**Automatic deploys:** in GitHub → Settings → Secrets and variables → Actions, add secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, plus variables `DEPLOY_ENABLED=true`, `AWS_REGION`, `WEB_BUCKET` and `CLOUDFRONT_ID` (from `terraform output`). Every push to `main` then tests and deploys.

**Before real customers:** attach your own domain with an ACM certificate (HTTPS from CloudFront to the ALB), set up Amazon SES for email, and move the Terraform state to S3.

---

## Adding a regulator

Create `services/ai/app/sources/<name>.py` with `SOURCE_ID` and `fetch_listing(http) -> list[SourceItem]`, then register it in `sources/__init__.py`. Keep parsing in a pure function and unit test it with a saved sample response, like `parse_listing` in `cbn.py`.

## API overview

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | Create a workspace / sign in (JWT) |
| POST | `/api/ask` | Cited answer (`scope`: all, regulations or policies) |
| GET | `/api/regulations`, `/api/regulations/:id` | Feed, document text and findings |
| POST | `/api/regulations/upload` | Add a private regulation (PDF/DOCX/TXT) |
| GET/POST/DELETE | `/api/policies` | Manage internal policies |
| POST | `/api/impact/run` · GET `/api/impact` · PATCH `/api/impact/:id` | Impact analysis and triage |
| GET/PUT | `/api/alerts` | Email alert settings |
| GET/POST | `/api/team` · GET `/api/audit` | Team members and audit log (admins) |
| POST | `/internal/cron/monitor` | Scheduled monitoring cycle (secret header) |

## Roadmap

- More regulators: SEC Nigeria, NDPC, NAICOM, then FCA (UK), RBI (India) and the EU AI Act
- SSO (Google/Microsoft) and HTTP-only cookie sessions
- Slack and Microsoft Teams alerts
- OCR for scanned circulars (Amazon Textract)
- Automatic answer-quality evals on a fixed question set
- Per-seat billing (Paystack/Stripe)

## Disclaimer

RegRadar helps compliance teams find and track regulatory requirements. It does not provide legal advice; always confirm with the original documents.

## License

MIT © 2026 John Anigbogu
