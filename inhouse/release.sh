#!/usr/bin/env bash
# release.sh   build the package from this checkout and install it here (dev box only; never deploys to VM 204).
# Requires a green inhouse/full-test.sh for HEAD (inhouse/logs/full-test.ok). FORCE=1 overrides.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ $# -gt 0 ]; then
  echo "refused: release.sh takes no arguments and never deploys to VM 204 (production promotion is manual)." >&2; exit 2
fi
# Green counts for HEAD if it was tested, or if nothing outside inhouse/ changed since the tested sha.
head=$(git rev-parse --short HEAD); ok=$(cat inhouse/logs/full-test.ok 2>/dev/null || true)
if [ "${FORCE:-}" != 1 ] && ! { [ -n "$ok" ] && git diff --quiet "$ok" HEAD -- . ':!inhouse' 2>/dev/null; }; then
  echo "no green full test covering HEAD $head (last green: ${ok:-none}). Run inhouse/full-test.sh first, or FORCE=1 to override." >&2; exit 5
fi
inhouse/build.sh
inhouse/install-fork.sh
sudo systemctl restart openmausbot && echo "dev box restarted"

