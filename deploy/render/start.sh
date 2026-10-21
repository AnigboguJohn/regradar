#!/usr/bin/env bash
# Starts Remi's AI service (private, 127.0.0.1:8000) and the API + website (public, $PORT)
# in one container. If either stops, the container stops, so the host restarts it cleanly.
set -euo pipefail

cd /srv/ai
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log &
AI_PID=$!

cd /srv/api
node dist/index.js &
API_PID=$!

# Pass "please stop" (sent on every deploy) to both, so they finish their requests first.
trap 'kill -TERM "$AI_PID" "$API_PID" 2>/dev/null; wait' TERM INT

wait -n "$AI_PID" "$API_PID"
echo "A RegRadar process stopped; stopping the container so it restarts." >&2
kill -TERM "$AI_PID" "$API_PID" 2>/dev/null || true
wait
exit 1
