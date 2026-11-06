# inhouse/ — 8zero8 additions to OpenMausBot

This folder is ours. Everything outside it is upstream (milind-soni/OpenMausBot, Apache-2.0)
and we keep our diff against it as small as possible so upstream releases keep flowing.

## Branch model
- `main`      = upstream/main, fast-forward only. Never commit here.
- `inhouse`   = main + our commits, **rebased** onto upstream regularly. This is what runs.
- `feat/*`    = one feature each, branched from `inhouse`, merged back when green.
- Anything generic (a bug fix, a feature upstream would want) goes in a branch off `main`
  and is sent as a PR to upstream, so the patch leaves our stack.

## Daily loop
    inhouse/sync-upstream.sh      # fetch upstream, ff main, rebase inhouse, typecheck,
                                  # vitest --changed main (tests our diff touches), push. Minutes.
    inhouse/build.sh              # full build (UI + server), 8 GB node heap, ~5 min
    inhouse/install-fork.sh       # package exactly like npm does, install as the maus openmausbot
    sudo systemctl restart openmausbot

## Before a release to production
    nohup inhouse/full-test.sh >/dev/null 2>&1 &     # whole suite, ~3.5 h, logs in inhouse/logs/
    inhouse/release.sh --to 204   # refuses without a green full test for HEAD (FORCE=1 overrides)

Testing policy: the daily check is typecheck + the test files affected by our diff against
`main`; upstream CI already covers upstream's own changes. The whole suite (30k cases) runs
before anything reaches VM 204. Known environmental failures live in `known-failures.txt`,
one per line as `full-test-<sha>.failures` prints them, each justified in CHANGELOG.md.

## Rules for changing core (anything outside this folder)
1. Extension points first: skills/, MCP servers, routines, webhooks, custom engines, bot souls.
   Zero core diff survives every update for free.
2. If core must change: one hook, one file where possible, additive not invasive, with tests.
   Mirror how `server/enterprise.ts` loads an external layer through a single import point.
3. `pnpm typecheck` and the affected tests green before any commit on `inhouse`; new code
   ships with its own tests so `vitest --changed main` actually covers it.
4. Follow upstream CONTRIBUTING.md and AGENTS.md (altitude, no narration comments, fakes not mocks).
5. Rebase conflicts are the price of a patch. Small diff = cheap rebase.

## Boxes
- VM 205 `openmaus-dev` 192.168.1.197 (tailnet 100.99.65.9) — this checkout at
  `/home/maus/OpenMausBot`, serves :8799. Work as `maus` (`sudo -iu maus`); `njl808` is the
  admin login. Files written as root or njl808 inside the checkout break the service.
- VM 204 `openmaus`     192.168.1.196 — production, 11 bots, runs the installed package.
