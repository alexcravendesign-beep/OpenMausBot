# inhouse changelog

One entry per feature, newest first. Format: date, title, what, why, core files touched (count + lines), how to verify, kill-question answers.

## 2026-11-06 — first full suite on VM 205 read: 13 failures, 0 in our diff
What: 10 npm-install cases (`server/engine-install.test.ts`, `server/harness/registry.test.ts`)
failed because the test strips PATH to its stand-in npm and `augmentedPath()` re-adds
/usr/local/bin and /opt/homebrew/bin but not /usr/bin, the only place node lived here.
Box fix: `ln -s /usr/bin/node /usr/local/bin/node` (done 6 Nov); 53/53 pass after.
`workspace-backup.test.ts` "rejects authenticated credential metadata..." passed once
given time (each password derivation ~0.9 s on this Xeon E5-2686 v4, the case does ~24), so
`full-test.sh` now runs vitest with `--testTimeout=60000`. Two cloud-lending e2e cases go
into `known-failures.txt`: they poll 15 s (hard-coded) for the engine's turn dump after a
server restart, and 42 sibling cases using the same helper pass, so this reads as the restart
outrunning 15 s on this box (inference, not proven; a longer poll would be a PR-shaped fix).
One extra case failed in the first run only (14 vs 13), name lost: watch for a flake.
Core files touched: 0.

## 2026-11-06 — test policy split: daily affected tests, full suite before release
What: `sync-upstream.sh` now runs typecheck + `vitest --changed main` and logs each step to
`inhouse/logs/`; new `full-test.sh` runs the whole suite detached, writes the failing case
names, honours `known-failures.txt`, and marks a green sha in `logs/full-test.ok`;
`release.sh` refuses without that mark for HEAD.
Why: the first full run on VM 205 took 204 min (30,599 passed, 14 failed) and the old
`| tail -n 5` lost the failing names. Core files touched: 0 (.gitignore +1 line).
Verify: `inhouse/sync-upstream.sh` finishes in minutes and pushes; `release.sh` exits 5
without a green mark.
