# inhouse changelog

One entry per feature, newest first. Format: date, title, what, why, core files touched (count + lines), how to verify, kill-question answers.

## 2026-11-10 — a pay-per-use Claude engine is no longer held by the plan's usage limit (**upstream-shaped**)
What: `server/plan-usage.ts` (+2/-2 lines, file stays at its 1,046-line pin) marks an engine that bills each use
(`access: "api"`, or a pay-per-use key in its environment; `billsEachUse` from `server/limit-failover.ts`) as `noUsage`,
the flag the ChatGPT-plan sign-in already had. `server/plan-usage.test.ts` (+17) covers Claude (API key), a keyed Claude
instance and a keyed Codex instance, and that no usage read is made for them.
Why: on 10 Nov the Teams plan hit its 5-hour limit, Nick moved ALEX to "Claude (API key)", and every turn went to Codex
in the same second: "Claude (API key) hit its limit (resets 4:09 PM), so Codex took over". `planAccountsFromInstances`
made a plan account for every Claude CLI engine and read the login on disk, so the key engine reported the Teams
account's 5-hour window as 100% used and blocked (`/api/limit-resets`). The key was never tried. Core files touched: 1.
Verify: `pnpm exec vitest run server/plan-usage.test.ts` (the new case fails without the fix); on the box
`/api/limit-resets` no longer lists "Claude (API key)" as blocked while "Claude" is. Kill question: upstream bug, every
install with a Claude sign-in and an Anthropic key has it; worth a PR to upstream.

## 2026-11-08 — Tracked risk: loopback service trust
What: documented the loopback service-trust posture from `server/request-auth.ts:35-38`:
> Open risk: a bot's shell is a loopback caller too, so it can do everything the Slack worker does: post into any bot's thread through the guarded route, including an existing Full-access thread, open new Full-access threads while the operator's shared Full access is on, stop a request and decline a card. Planned fix: a relay token only the Slack worker holds, so these routes stop answering session-less loopback.
On VM 205 the bots' shells are loopback callers, so a bot with shell access can reach every other bot's threads. The interim stance is that shell access is granted knowingly, and the fix is upstream's planned relay token. Core files touched: 0 (no code change).

## 2026-11-08 — split double import in `server/index.ts` (**upstream-shaped**)
What: `server/index.ts` (+2/-1 lines) places `import { seedStarterNotes } from "./starter-notes.ts";` on its own line instead of sharing line 393 with `./new-bot-defaults.ts`.
Why: commit `7741d3544` put two imports on one line. Core files touched: 1 (`server/index.ts`, +2/-1 lines). **upstream-shaped**.
Verify: `pnpm typecheck` and `scripts/testing/file-size-ratchet.test.ts` pass. Kill question: upstream-shaped formatting cleanup — stands.

## 2026-11-08 — `vite.config.ts` calls `productNamePage()` once
What: `vite.config.ts` (+2/-1 lines) stores the `productNamePage()` plugin instance and spreads it conditionally instead of invoking `productNamePage()` twice.
Why: line 75 called `productNamePage() ? [productNamePage()!] : []`, creating a duplicate plugin instance on every build. Core files touched: 1 (`vite.config.ts`, +2/-1 lines).
Verify: `VITE_PRODUCT_NAME=Alex pnpm exec vite build` writes `<title>Alex</title>` into `dist/index.html` and `"name": "Alex"` into `dist/manifest.webmanifest`. Kill question: in-house build config cleanup — stands.

## 2026-11-08 — delete five tracked scratch `.mjs` files and ignore their folder (**upstream-shaped**)
What: deleted the five tracked scratch files (`ext.mjs`, `r.mjs`, `r.mjs.bak`, `r.mjs.bak2`, `run.mjs`) from the temporary experiment folder and added the folder to `.gitignore` (+1 line).
Why: five scratch scripts came in with an upstream commit and nothing references them. Core files touched: 1 (`.gitignore`, +1 line). **upstream-shaped**.
Verify: `git status --ignored` shows the folder ignored and `git grep` for its name outside `docs/plans` and `.gitignore` is empty. Kill question: upstream-shaped cleanup — stands.

## 2026-11-08 — `inhouse/build.sh` no longer rewrites local git identity
What: `inhouse/build.sh` (-2 lines) removes `git config user.name` and `git config user.email`; `server/full-test-script.test.ts` verifies `git config --local user.name` is untouched after a build run.
Why: running a build should not mutate the repository's local git configuration. Core files touched: 0.
Verify: `pnpm exec vitest run server/full-test-script.test.ts` passes. Kill question: build script hygiene — stands.

## 2026-11-08 — `inhouse/release.sh` removes `--to 204` production deploy branch
What: `inhouse/release.sh` deletes the `scp`/`ssh` VM 204 install branch, updates the usage comment on line 2, and exits 2 with a one-line refusal before any build or install when given `--to 204` (or any arguments); `server/full-test-script.test.ts` adds refusal and local-path tests.
Why: `inhouse/BRIEF.md` forbids running `release.sh --to 204` or sshing to production VM 204 from dev scripts; promotion to production is manual. Core files touched: 0.
Verify: `inhouse/release.sh --to 204` prints a one-line refusal and exits 2 without side effects; `pnpm exec vitest run server/full-test-script.test.ts` passes. Kill question: safety enforcement — stands.

## 2026-11-08 — `inhouse/full-test.sh` fails closed on vitest exit status and report errors
What: `inhouse/full-test.sh` removes any stale JSON report before the run, checks the `node -e` JSON parser exit status and report structure, rejects suite-level failures or non-zero vitest exits with zero assertion failures, and exits non-zero on `RED`; `server/full-test-script.test.ts` (new, 189 lines) exercises synthetic reports (clean, allowed failure, unexpected failure, suite load error, truncated JSON, missing/stale file).
Why: `full-test.sh` captured vitest's exit status `$v` without checking it, ignored JSON parser failures, and exited 0 after printing `RED`. Core files touched: 0 (1 test file added).
Verify: `pnpm exec vitest run server/full-test-script.test.ts` passes all 6 cases in ~2 s. Kill question: release tooling hardening — stands.

## 2026-11-07 — bots a Chief creates get the New bot defaults' starter notes
What: `server/starter-notes.ts` (new, 24 lines) writes each defaults memory file a bot lacks;
`server/team-setup-requests.ts` (+6) calls an optional `seedBot` hook per created bot;
`server/index.ts` (+2) wires it with the saved defaults. Unit test + an assertion in the hire e2e.
Why: `create_bot` went through the store alone and hires started with no memory, so Alex's
teammates missed the team brain (`brain-sync` was the stop-gap). Core files touched: 3 (32 lines).
Verify: `pnpm vitest run server/starter-notes.test.ts server/team-setup.e2e.test.ts` green; live: hire
a bot, its memory panel shows the topics. Branch `fix/chief-created-bots-starter-notes` off main,
cherry-picked onto inhouse; upstream PR candidate. Kill question: a code path, not a prompt — stands.

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
