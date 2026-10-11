#!/bin/bash
# Copies the Teacher's Desk server into the Mac app (src-tauri/server → Contents/Resources/
# server), for "Keep my data on this Mac". Run before `tauri build`; CI does.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/desktop/src-tauri/server"
[ -d "$ROOT/web/node_modules" ] || (cd "$ROOT/web" && npm ci --no-audit --no-fund --silent)
(cd "$ROOT/web" && npm run build --silent)
find "$OUT" -mindepth 1 ! -name .gitkeep -exec rm -rf {} +
mkdir -p "$OUT/web" "$OUT/scripts"
cp -R "$ROOT/app" "$ROOT/config" "$OUT/"
cp -R "$ROOT/web/dist" "$OUT/web/"
find "$OUT" -name __pycache__ -prune -exec rm -rf {} +
cp "$ROOT/scripts/setup-local-mac.sh" "$OUT/scripts/"
cp "$ROOT/pyproject.toml" "$OUT/"
python3 -c "import json;print(json.load(open('$ROOT/desktop/src-tauri/tauri.conf.json'))['version'])" > "$OUT/VERSION"
du -sh "$OUT"
