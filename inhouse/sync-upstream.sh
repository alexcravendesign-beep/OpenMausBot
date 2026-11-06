#!/usr/bin/env bash
# Daily: bring main up to upstream, rebase inhouse on top, typecheck, run the vitest files
# affected by our diff against main (vitest --changed main), push. Stops on conflict and says so.
# Upstream CI covers upstream's own changes. The whole suite (~3.5 h here) is inhouse/full-test.sh,
# which gates release.sh. Logs: inhouse/logs/<step>.log
set -euo pipefail
export PATH=$HOME/.local/bin:$PATH NODE_OPTIONS=--max-old-space-size=8192
cd "$(dirname "$0")/.."
LOG=inhouse/logs; mkdir -p "$LOG"
if [ -n "$(git status --porcelain)" ]; then echo "working tree not clean; commit or stash first" >&2; exit 2; fi
git fetch -q upstream
git checkout -q main && git merge -q --ff-only upstream/main
git checkout -q inhouse
before=$(git rev-parse --short HEAD)
if ! git rebase -q main; then
  echo "REBASE CONFLICT: fix the files, git add, git rebase --continue (or git rebase --abort)" >&2; exit 3
fi
echo "inhouse: $before -> $(git rev-parse --short HEAD) on upstream $(git rev-parse --short main) (v$(node -p 'require("./package.json").version'))"
step() {
  local name=$1; shift
  if "$@" >"$LOG/$name.log" 2>&1; then echo "ok   $name"
  else echo "FAIL $name  (full log: $LOG/$name.log)"; grep -E "FAIL|Error|failed" "$LOG/$name.log" | head -n 30; tail -n 15 "$LOG/$name.log"; exit 1; fi
}
step install       pnpm install --frozen-lockfile
step typecheck     pnpm typecheck
step changed-tests pnpm vitest run --changed main --reporter=dot
git push -q origin main inhouse --force-with-lease && echo "pushed main + inhouse to the fork" || { echo "push FAILED" >&2; exit 4; }
