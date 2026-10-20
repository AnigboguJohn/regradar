#!/usr/bin/env bash
# Browser tests from start to finish: build and start the throwaway test stack (port 8090,
# empty database, no reCAPTCHA/email), run the Playwright tests, then remove the stack.
# Your normal RegRadar on port 8080 is not touched.
#
#   ./scripts/e2e.sh              run all browser tests
#   KEEP=1 ./scripts/e2e.sh       leave the test stack running afterwards (to look around)
#
# Report with screenshots/videos of any failure: tests/browser/playwright-report/index.html
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE="docker compose -p regradar-test -f docker-compose.test.yml"

cleanup() { [ "${KEEP:-}" = "1" ] || $COMPOSE down -v --remove-orphans > /dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> Starting the test stack (http://localhost:8090)"
$COMPOSE up -d --build --wait

echo "==> Installing the browser test tools"
cd tests/browser
npm install --no-audit --no-fund --loglevel=error
npx playwright install chromium

echo "==> Running browser tests"
COMPOSE="$COMPOSE" npx playwright test "$@"
