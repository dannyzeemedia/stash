#!/bin/bash
# Send your changes to every machine running Stash.
#   ~/zm-hub/ship.sh "what changed"
# Their machines pull each morning, or whenever they run Update Stash.
set -euo pipefail
cd "$(dirname "$0")"

msg="${1:-}"
if [ -z "$msg" ]; then
  echo "Say what changed:  ./ship.sh \"fixed the duplicate card bug\""
  exit 1
fi

if [ -z "$(git status --porcelain)" ]; then
  echo "Nothing to ship - no changes."
  exit 0
fi

git add -A
git commit -q -m "$msg"
git push -q origin main
echo "Shipped: $msg"
echo "Anyone running Stash picks it up at their next update."
