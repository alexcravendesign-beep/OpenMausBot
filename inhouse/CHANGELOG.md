# inhouse changelog

One entry per feature, newest first. Format: date, title, what, why, core files touched (count + lines), how to verify, kill-question answers.

## 2026-11-06 — test policy split: daily affected tests, full suite before release
What: `sync-upstream.sh` now runs typecheck + `vitest --changed main` and logs each step to
`inhouse/logs/`; new `full-test.sh` runs the whole suite detached, writes the failing case
names, honours `known-failures.txt`, and marks a green sha in `logs/full-test.ok`;
`release.sh` refuses without that mark for HEAD.
Why: the first full run on VM 205 took 204 min (30,599 passed, 14 failed) and the old
`| tail -n 5` lost the failing names. Core files touched: 0 (.gitignore +1 line).
Verify: `inhouse/sync-upstream.sh` finishes in minutes and pushes; `release.sh` exits 5
without a green mark.
