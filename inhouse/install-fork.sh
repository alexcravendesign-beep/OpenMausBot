#!/usr/bin/env bash
# Build the npm package from the fork checkout and install it as the maus global openmausbot.
set -euo pipefail
export PATH=$HOME/.local/bin:$PATH NODE_OPTIONS=--max-old-space-size=8192
cd ~/OpenMausBot
node scripts/build-npm-package.mjs | tail -n 1
cd release/npm
rm -f ./*.tgz
npm pack --silent >/dev/null
TGZ=$(ls ./*.tgz | head -n 1)
npm install -g --prefix "$HOME/.local" "$TGZ" >/dev/null 2>&1
echo "installed: $(npm ls -g --prefix "$HOME/.local" openmausbot 2>/dev/null | grep -o "openmausbot@[0-9.]*") from $TGZ ($(git -C ~/OpenMausBot rev-parse --short HEAD))"
