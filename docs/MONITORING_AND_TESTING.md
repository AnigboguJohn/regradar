# Monitoring and testing

## How you find out something is wrong

| Layer | What it watches | Where you hear about it |
|---|---|---|
| **Error tracking** (built in) | Server errors, AI service failures, and crashes in users' browsers. Identical errors are grouped, with a count, the page and the stack trace. | Admin console → **Errors**. A crashed page shows users "Something went wrong" with a Reload button instead of a blank screen. |
| **App alerts** (built in, every 5 min) | Database or AI service down, error spikes and new errors, regulator check failing or stale, new failed downloads, email login failing, repeated failed admin sign-ins. | Email to every platform admin (or `OPS_ALERT_EMAILS`), with reminders while it continues (hourly if critical, daily for warnings) and an "all clear" when it stops. Also Admin → **System health → Alerts**, with **Run checks now** and **Send test alert**. |
| **AWS alarms** (Terraform, `infra/terraform/monitoring.tf`) | Things the app can't report itself: site unreachable, no healthy API server, a service with no running task, 5xx spikes, slow responses, CPU/memory high, database storage or memory low. | Email from AWS SNS to `alert_email` (confirm the subscription email AWS sends once). |
| **Uptime from outside** | `GET /api/health/ready` returns 200 only if the database **and** AI service answer. | AWS Route 53 checks it every 30 s from several regions (alarm above). The free GitHub workflow `.github/workflows/uptime.yml` also checks every 10 minutes and GitHub emails you when it fails (set the repository variable `APP_URL`). Any other monitor (UptimeRobot, Better Stack) can use the same address. |
| **Logs** | Every request as structured JSON (passwords and tokens removed). | `docker compose logs api` locally; CloudWatch Logs on AWS (kept 30 days). |

Settings (in `.env`, or Terraform variables on AWS):

| Setting | Default | Meaning |
|---|---|---|
| `OPS_ALERT_EMAILS` | every platform admin | Comma-separated list of who gets alert emails |
| `OPS_MONITOR_MINUTES` | `5` | How often the app runs its checks (`0` turns them off) |
| `SYNC_STALE_HOURS` | `24` | Warn when no regulator check has succeeded for this long |
| `alert_email` (Terraform) | none | Where AWS alarms go; also used as `OPS_ALERT_EMAILS` on AWS |

## Tests

| Suite | What it covers | Run it |
|---|---|---|
| **AI service** (pytest, 14 tests) | Chunking, retrieval scoring, citations, small talk, conversation memory | `docker compose exec ai python -m pytest -q` |
| **API unit** (8 tests) | Alert rules, authenticator codes against the official RFC 6238 test values | `cd services/api && npm test` |
| **API integration** (22 tests) | The real API on a real database with a fake AI service: sign-up rules, wrong password vs unknown email, remember me, reset codes (countdown, lock, expiry, reuse, signing out old sessions), conversations (memory, rename, pin, archive, delete, privacy between companies), invites, admin console (two-step sign-in, token separation, suspension, last-admin protection), error tracking, readiness and alerts firing then clearing | `./scripts/test-api.sh` (uses a separate `regradar_test` database; your real data is never touched) |
| **Browser** (Playwright, real Chromium) | Sign-up → sign-in, wrong password / unknown email messages, forgot password, expired session, remember me, chatting with Remi (memory, rename, export, archive, delete), team invite end to end, profile edit, the admin console with QR-code setup, **accessibility** (WCAG 2.1 AA checks with axe-core) and **phone layout** | `./scripts/e2e.sh` (starts a throwaway copy on port 8090, runs the tests, removes it; report in `tests/browser/playwright-report`) |

All of these run automatically on GitHub for every pull request and every push to `main`
(`.github/workflows/ci.yml`). Deploys only happen when they all pass. When browser tests fail,
the run keeps a report with screenshots and videos for 14 days.
