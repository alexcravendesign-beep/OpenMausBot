#!/usr/bin/env bash
set -euo pipefail
export PATH=$HOME/.local/bin:$PATH
export NODE_OPTIONS=--max-old-space-size=8192
cd ~
[ -d OpenMausBot ] || git clone -q https://github.com/alexcravendesign-beep/OpenMausBot.git
cd OpenMausBot
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/milind-soni/OpenMausBot.git
git fetch -q upstream
git config user.name "Nick Lewis"
git config user.email "alexcravendesign@gmail.com"
echo "checkout: $(git log -1 --format="%h %ad %s" --date=short)"
echo "== pnpm install $(date +%T)"; pnpm install --frozen-lockfile 2>&1 | tail -n 3
echo "== build $(date +%T)"; pnpm build 2>&1 | tail -n 4
echo "== build:server $(date +%T)"; pnpm build:server 2>&1 | tail -n 3
echo "== done $(date +%T)"; ls -d dist dist-server cli.js 2>&1
