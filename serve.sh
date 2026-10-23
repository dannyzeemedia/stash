#!/bin/bash
# Keep Stash up. Starts it if it isn't running; does nothing if it is.
# Cron runs this at boot and every 5 minutes, the same way Nestegg stays up.
set -u
cd "$(dirname "$0")" || exit 1

if curl -fsS -o /dev/null --max-time 4 http://127.0.0.1:8800/api/board; then
  exit 0
fi

mkdir -p logs
echo "=== starting $(date '+%Y-%m-%d %H:%M %Z') ===" >> logs/server.log
nohup /usr/bin/python3 server.py >> logs/server.log 2>&1 &
