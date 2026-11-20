#!/bin/sh
# 내 서재 — 로컬 검증 실행 (Playwright 필요)
set -e
cd "$(dirname "$0")/.."
PORT="${PORT:-8123}"
BASE_URL="http://127.0.0.1:${PORT}/"

python3 -m http.server "$PORT" >/tmp/nae-seoje-serve.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT INT TERM
sleep 1.2

python3 tests/e2e.py
python3 tests/offline.py
