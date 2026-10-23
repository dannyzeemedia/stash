#!/bin/bash
# Push any change to Stash automatically, so nothing waits on you remembering.
# Runs nightly from cron. Only touches code - the board is not in the repo.
set -uo pipefail
cd "$(dirname "$0")" || exit 1
mkdir -p logs

say() { echo "$(date '+%Y-%m-%d %H:%M') $*" >> logs/autoship.log; }

if [ -z "$(git status --porcelain)" ]; then
  exit 0
fi

# Summarise what changed, so the history reads like something a person wrote.
files=$(git status --porcelain | awk '{print $2}' | sed 's|/.*||' | sort -u | tr '\n' ' ')
n=$(git status --porcelain | wc -l)

git add -A
git commit -q -m "Changes to ${files% } ($n file(s))

Shipped automatically.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" || { say "commit failed"; exit 1; }

if git push -q origin main 2>>logs/autoship.log; then
  say "shipped $n file(s): ${files% }"
else
  say "PUSH FAILED - will retry tomorrow"
  exit 1
fi
