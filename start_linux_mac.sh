#!/usr/bin/env sh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo "Node.js 18+ gerekli: https://nodejs.org/"; exit 1; fi
if [ -z "$FIRMS_MAP_KEY" ]; then printf "NASA FIRMS MAP_KEY (yoksa Enter): "; read FIRMS_MAP_KEY; export FIRMS_MAP_KEY; fi
node server.mjs
