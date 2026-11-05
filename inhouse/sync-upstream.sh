#!/usr/bin/env bash
# Bring main up to upstream and rebase inhouse on top. Stops on conflict and says so.
set -euo pipefail
export PATH=$HOME/.local/bin:$PATH NODE_OPTIONS=--max-old-space-size=8192
cd "$(dirname "$0")/.."
if [ -n "$(git status --porcelain)" ]; then echo "working tree not clean; commit or stash first" >&2; exit 2; fi
git fetch -q upstream
git checkout -q main && git merge -q --ff-only upstream/main
git checkout -q inhouse
before=$(git rev-parse --short HEAD)
if ! git rebase -q main; then
  echo "REBASE CONFLICT: fix the files, git add, git rebase --continue (or git rebase --abort)" >&2; exit 3
fi
echo "inhouse: $before -> $(git rev-parse --short HEAD) on upstream $(git rev-parse --short main) (v$(node -p 'require("./package.json").version'))"
pnpm install --frozen-lockfile 2>&1 | tail -n 1
pnpm typecheck 2>&1 | tail -n 3
pnpm test 2>&1 | tail -n 5
git push -q origin main inhouse --force-with-lease 2>/dev/null && echo "pushed main + inhouse to the fork" || echo "push skipped (no credentials?)"
