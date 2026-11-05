#!/usr/bin/env bash
# release.sh [--to 204]   build the package from this checkout, install here, optionally on VM 204.
set -euo pipefail
cd "$(dirname "$0")/.."
TO=""; [ "${1:-}" = "--to" ] && TO="${2:-}"
inhouse/build.sh
inhouse/install-fork.sh
sudo systemctl restart openmausbot && echo "dev box restarted"
if [ "$TO" = "204" ]; then
  TGZ=$(ls release/npm/*.tgz | head -n 1)
  scp -q "$TGZ" maus@192.168.1.196:/tmp/
  ssh maus@192.168.1.196 "npm install -g --prefix ~/.local /tmp/$(basename "$TGZ") >/dev/null 2>&1 && npm ls -g --prefix ~/.local openmausbot | grep -o 'openmausbot@[0-9.]*'"
  echo "now restart production: ssh njl808@192.168.1.196 sudo systemctl restart openmausbot"
fi
