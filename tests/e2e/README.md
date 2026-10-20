# End-to-end tests

Run against a running stack (`docker compose up`, or the three dev servers).

```bash
pip install requests && python tests/e2e/api_e2e.py      # 34 API checks: auth, uploads, cited answers, impact, roles, tenant isolation, cron security
npm i -D playwright && npx playwright install chromium
node tests/e2e/ui_e2e.mjs                                 # clicks through every screen, saves screenshots to tests/e2e/shots
```

`API_URL`, `WEB_URL` and `CRON_SECRET` can be set as environment variables. Run on a fresh database: the sign-in rate limit allows 20 attempts per 15 minutes.
