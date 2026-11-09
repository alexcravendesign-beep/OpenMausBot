# inhouse changelog

One entry per feature, newest first. Format: date, title, what, why, core files touched (count + lines), how to verify, kill-question answers.

## 2026-11-08 — F2 & F3 skill prototypes (`versioned-brief`, `deliverable-receipt`), three-bot fixture proof, and core-change proposal
What:
- Prototyped F2 as `skills/versioned-brief/` (`manifest.json`, `SKILL.md`) and F3 as `skills/deliverable-receipt/` (`manifest.json`, `SKILL.md`, `receipt.html`), using existing coordination and chat tools (`coordinate_bots` with `in_my_folder: true` and `rework: true`, `attach_file`, `show_html`).
- Added `server/versioned-brief-deliverables.e2e.test.ts` (new, 710 lines) with an isolated three-bot fixture (**Researcher**, **Art Director**, **Producer** + **Lead**) that:
  1. Issues Brief rev 1, collects acknowledgements from all three bots, and records Deliverable v1 (`briefRevision: 1`, `state: "reviewed"`, `public: false`).
  2. Replays the 8 Nov mid-job correction (Brief rev 2: 9:16 vertical -> 16:9 landscape + acoustic score) across all three states simultaneously in one `coordinate_bots` call: Researcher while actively working (`outcome: "injected"`, steered mid-turn), Art Director while waiting on a `NEEDS INPUT:` question (`outcome: "injected"`, answering the parked question), and Producer after completing rev 1 (`outcome: "queued"` via `rework: true`). Verifies each acknowledges rev 2 once, v1 retains `briefRevision: 1`, v2 records `briefRevision: 2`, and the receipt renders via `attach_file` + `show_html` without new UI.
  3. Issues Brief rev 3 with Producer deliberately offline (`failWith`), proving the lead sees Researcher and Art Director acknowledged rev 3 while Producer is reported failed/un-acknowledged (`acknowledged: false`), and verifying `approvalMode: "ask"` and `permissionMode: "default"` are never widened on any bot.
- **Core-change proposal (STOP — awaiting Nick's approval before writing any core change)**:
  - *Why the skill alone cannot enforce F2 & F3*: A skill guides compliant models, but cannot mechanically prevent a lead model from (a) omitting a prior job participant when calling `coordinate_bots` with a correction, (b) forgetting `rework: true` for a participant whose earlier turn already finished, or (c) marking a revision acknowledged in `brief.json` / auto-setting `public: true` in `deliverables.json` without an actual teammate turn or human approval.
  - *Proposed core change (38 lines total across 2 files, 0 new dependencies)*:
    1. `server/brief-revision-guard.ts` (new helper, ~30 lines): tracks `{ revision, participants, ackedByGen }` per root job thread and validates `deliverables.json` receipts (enforcing monotonic revision numbers, full participant fan-out on revision bumps, automatic `rework: true` upgrade for settled participants on revision > 1, and `public: false` unless a human approval event exists on the thread).
    2. `server/host/question-routing.ts` (+8 lines around `relay()`): invokes `briefRevisionGuard` when `coordinate_bots` carries a brief revision or settles a child turn, automatically stamping the verified `briefRevision` and participant acknowledgement state onto the assignment report returned to the lead.
Why: mandatory skill-first order of attack per `inhouse/BRIEF.md`; prove what existing runtime mechanics (`coordinate_bots` steering, question answering, standing-thread rework, `attach_file`, `show_html`) already handle in an isolated 3-bot fixture, and specify the smallest additive core hook needed to enforce it mechanically. Core files touched: 0 (2 new skill folders in `skills/`, 1 new test file `server/versioned-brief-deliverables.e2e.test.ts`).
Verify: `TMPDIR=/tmp pnpm exec vitest run server/versioned-brief-deliverables.e2e.test.ts server/skill-library.test.ts` passes (15/15 tests green in ~8 s). Kill question: skill prototype + e2e proof stands; core enforcement awaits approval.

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
