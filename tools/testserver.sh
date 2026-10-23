#!/bin/bash
# A throwaway Stash on :8801 with its own data file, for testing against.
# Never point tests at the real board.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="${STASH_TEST_DIR:-${TMPDIR:-/tmp}/stash-test}"
mkdir -p "$T/backups"
[ -f "$ROOT/hub.json" ] && cp "$ROOT/hub.json" "$T/hub.json"
ss -lptnH 'sport = :8801' 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | head -1 | xargs -r kill
cd "$ROOT" || exit 1
STASH_PORT=8801 STASH_DATA="$T/hub.json" STASH_BACKUPS="$T/backups" \
  nohup /usr/bin/python3 server.py > "$T/server.log" 2>&1 &
sleep 3
curl -fsS -o /dev/null http://127.0.0.1:8801/api/board && echo "test instance up on :8801 (data in $T)" || echo "FAILED"
