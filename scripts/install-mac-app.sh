#!/bin/bash
# Installs (or updates) Teacher's Desk for Mac — no Apple Developer ID needed.
#
# Teachers run the one-liner shown in Admin → People → "Teacher Macs":
#     curl -fsSL http://<school-server>:8000/install/mac.sh | bash
# The school server fills in its own address, so the app opens already connected.
#
# Why no Gatekeeper warning: macOS only checks apps that carry the "quarantine" tag, which
# browsers add to downloads. curl never adds it. (MDM installs don't either.)
#
# Standalone use: LOCALSCHOOL_ZIP_URL=<zip> [LOCALSCHOOL_SERVER=<url>] bash install-mac-app.sh
set -euo pipefail

SERVER="${LOCALSCHOOL_SERVER:-__SERVER__}"
ZIP_URL="${LOCALSCHOOL_ZIP_URL:-__ZIP_URL__}"
SCHOOL="${LOCALSCHOOL_SCHOOL:-__SCHOOL__}"
APP_NAME="Teacher's Desk.app"
OLD_APP="Local School.app"   # earlier builds

say() { printf '\033[1m%s\033[0m\n' "$*"; }

[ "$(uname -s)" = "Darwin" ] || { echo "This installer is for macOS."; exit 1; }
case "$ZIP_URL" in __*|"") echo "Set LOCALSCHOOL_ZIP_URL to the Teacher's Desk for Mac .zip"; exit 1 ;; esac
case "$SERVER" in __*) SERVER="" ;; esac
case "$SCHOOL" in __*|"") SCHOOL="your school" ;; esac

DEST="/Applications"
[ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say "Downloading Teacher's Desk for Mac…"
curl -fL --progress-bar "$ZIP_URL" -o "$TMP/app.zip"
ditto -x -k "$TMP/app.zip" "$TMP/unzipped"
SRC="$(find "$TMP/unzipped" -maxdepth 2 -name '*.app' -print -quit)"
[ -n "$SRC" ] || { echo "The download didn't contain an app."; exit 1; }

# Replace any running/older copy.
osascript -e 'tell application "Local School" to quit' >/dev/null 2>&1 || true
osascript -e "tell application \"Teacher's Desk\" to quit" >/dev/null 2>&1 || true
sleep 1
rm -rf "$DEST/$APP_NAME" "$DEST/$OLD_APP"
ditto "$SRC" "$DEST/$APP_NAME"
xattr -dr com.apple.quarantine "$DEST/$APP_NAME" 2>/dev/null || true

# Pre-connect to this school's server (a teacher's own later choice is never overwritten).
if [ -n "$SERVER" ]; then
  CFG="$HOME/Library/Application Support/org.localschool.desktop"
  mkdir -p "$CFG"
  if [ ! -f "$CFG/server.json" ]; then
    esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
    printf '{"url": "%s", "name": "%s"}\n' "$(esc "$SERVER")" "$(esc "$SCHOOL")" > "$CFG/server.json"
  fi
fi

open "$DEST/$APP_NAME"
say "Teacher's Desk is installed in $DEST. Tip: press ⌥Space anywhere to ask a question."
