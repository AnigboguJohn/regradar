#!/usr/bin/env bash
# API unit + integration tests against a throwaway "regradar_test" database inside your local
# Docker database (needs `docker compose up` running). Runs in a Linux container on the same
# Docker network, so it works the same on Windows, macOS and Linux, and never touches the
# real "regradar" database.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose exec -T db sh -c 'psql -U regradar -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '"'"'regradar_test'"'"'" | grep -q 1 \
  || createdb -U regradar regradar_test; psql -U regradar -d regradar_test -qc "CREATE EXTENSION IF NOT EXISTS vector"'

NET=$(docker inspect "$(docker compose ps -q db)" -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}')
SRC="$PWD"; command -v cygpath > /dev/null && SRC="$(cygpath -w "$PWD")"

MSYS_NO_PATHCONV=1 docker run --rm --network "$NET" -v "$SRC:/repo:ro" \
  -e TEST_DATABASE_URL=postgresql://regradar:regradar@db:5432/regradar_test node:22-alpine sh -c '
    mkdir -p /work /db && cd /repo/services/api && cp -r package.json package-lock.json tsconfig.json src test assets /work/ \
    && cp -r /repo/db/migrations /db/ && cd /work && npm ci --no-audit --no-fund --loglevel=error > /dev/null && npm test'
