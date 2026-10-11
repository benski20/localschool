#!/bin/bash
# "Keep my data on this Mac": a teacher's own Teacher's Desk server, on their Mac only.
#
# The Mac app runs this from its bundle (Contents/Resources/server/scripts/) when a teacher
# picks "Keep my data on this Mac"; IT can run it too. It installs the server into the
# app's folder, listening on 127.0.0.1 only (nothing else on the network can reach it),
# and keeps it running with launchd. The teacher's documents, students, chats, drafts and
# recordings stay in that folder. Only the AI runs elsewhere: the app signs the teacher in
# to the school's server, which hands back a key for this Mac, and each question sends the
# few passages it needs to the school's AI through that server's /api/relay.
#
# Inputs (environment): TEACHER_NAME, TEACHER_EMAIL, TEACHER_PASSWORD (8+), SCHOOL_NAME,
# RUNTIME_KIND (relay|ollama|openai|fake), RUNTIME_URL, RUNTIME_TOKEN, CHAT_MODEL, EMBED_MODEL,
# LOCAL_HOME, PORT, LS_ALLOW_NO_FILEVAULT=1 (tests only).
# Modes: LS_UPDATE=1 (new app version: refresh the code, keep everything else),
#        LS_REMOVE=1 (stop it and delete this Mac's copy of the data — cannot be undone).
#
# Output for the app: "STEP n/N text" lines, then "READY <url>", or "ERROR <text>".
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_HOME="${LOCAL_HOME:-$HOME/Library/Application Support/org.localschool.desktop/local}"
PORT="${PORT:-8765}"
LABEL="org.localschool.desk"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$HOME/Library/Logs/Teachers Desk"
SRV="$LOCAL_HOME/server"
VENV="$LOCAL_HOME/venv"
ENV_FILE="$LOCAL_HOME/server.env"
URL="http://127.0.0.1:$PORT"
DOMAIN="gui/$(id -u)"
TOTAL=5
PRODUCT="Teacher's Desk"

step() { echo "STEP $1/$TOTAL $2"; }
fail() { echo "ERROR $*"; exit 1; }
stop_agent() {
  launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
  # bootout returns before launchd has let go; starting again too soon fails with error 5.
  for _ in $(seq 1 30); do launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break; sleep 0.5; done
  for _ in $(seq 1 30); do curl -sf --max-time 1 "$URL/api/health" >/dev/null 2>&1 || break; sleep 0.5; done
}
start_agent() {
  for _ in 1 2 3 4 5; do
    launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null && return 0
    launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 && { launchctl kickstart -k "$DOMAIN/$LABEL"; return 0; }
    sleep 1
  done
  launchctl load -w "$PLIST"
}

[ "$(uname -s)" = Darwin ] || fail "This sets up Teacher's Desk on a Mac."

if [ "${LS_REMOVE:-}" = 1 ]; then
  stop_agent
  rm -f "$PLIST"
  rm -rf "$LOCAL_HOME"
  # The app's Keychain entry for signing in to this desk
  for _ in 1 2 3 4 5; do security delete-generic-password -s "Teacher's Desk (this Mac)" >/dev/null 2>&1 || break; done
  echo "REMOVED"
  exit 0
fi

UPDATE="${LS_UPDATE:-}"
if [ "$UPDATE" = 1 ] && [ ! -f "$ENV_FILE" ]; then
  fail "Teacher's Desk isn't set up on this Mac yet."
fi

# -- 1. the disk must be encrypted: a lost laptop must not mean lost student data --------
step 1 "Checking this Mac is encrypted"
if [ "${LS_ALLOW_NO_FILEVAULT:-}" != 1 ]; then
  fv="$(fdesetup status 2>/dev/null || true)"
  case "$fv" in
    *"is On"*|*"in progress"*) ;;
    *) fail "Turn on FileVault first (System Settings → Privacy & Security → FileVault), then try again. It keeps your students' information safe if this Mac is lost." ;;
  esac
fi

if [ "$UPDATE" != 1 ]; then
  : "${TEACHER_EMAIL:?}" "${TEACHER_PASSWORD:?}"
  [ -n "$TEACHER_PASSWORD" ] || fail "Enter your password."
  case "$TEACHER_EMAIL" in *@*.*) ;; *) fail "Enter your school email address." ;; esac
fi

mkdir -p "$LOCAL_HOME/bin" "$LOGS"
chmod 700 "$LOCAL_HOME"
export UV_PYTHON_INSTALL_DIR="$LOCAL_HOME/python" UV_CACHE_DIR="$LOCAL_HOME/cache" UV_NO_CONFIG=1

# -- 2. a private Python, inside the app's folder (nothing system-wide) ------------------
step 2 "Getting Python ready"
UV="$LOCAL_HOME/bin/uv"
if [ ! -x "$UV" ]; then
  case "$(uname -m)" in arm64) ARCH=aarch64 ;; *) ARCH=x86_64 ;; esac
  curl -fsSL --retry 3 "https://github.com/astral-sh/uv/releases/latest/download/uv-$ARCH-apple-darwin.tar.gz" \
    | tar -xzf - --strip-components 1 -C "$LOCAL_HOME/bin" \
    || fail "Couldn't download the setup tools. Check your internet connection and try again."
fi
[ -x "$VENV/bin/python" ] || "$UV" venv -q --python 3.12 "$VENV" \
  || fail "Couldn't set up Python. Check your internet connection and try again."

# -- 3. the server itself (copied from the app, so it always matches the app's version) --
if [ "$UPDATE" = 1 ]; then step 3 "Installing the update"; else step 3 "Installing $PRODUCT"; fi
stop_agent
mkdir -p "$SRV/web"
for part in app config scripts web/dist; do
  [ -d "$SRC/$part" ] || fail "This copy of the app is missing part of Teacher's Desk ($part). Reinstall the app."
  rsync -a --delete --exclude __pycache__ "$SRC/$part/" "$SRV/$part/"
done
cp "$SRC/pyproject.toml" "$SRV/pyproject.toml"
[ ! -f "$SRC/VERSION" ] || cp "$SRC/VERSION" "$SRV/VERSION"  # the app compares this to update
"$UV" pip install -q --python "$VENV/bin/python" -r "$SRV/pyproject.toml" \
  || fail "Couldn't install Teacher's Desk. Check your internet connection and try again."

# -- 4. settings: this Mac only ---------------------------------------------------------
step 4 "Saving your settings"
if [ "$UPDATE" != 1 ]; then
  RUNTIME_KIND="${RUNTIME_KIND:-relay}"
  if [ "$RUNTIME_KIND" = fake ]; then CHAT_MODEL=fake-chat; EMBED_MODEL=fake-embed; fi
  (
    umask 077
    {
      echo "DATA_DIR=$LOCAL_HOME/data"
      echo "LOCAL_MODE=true"
      echo "ADVERTISE_MDNS=false"
      echo "SCHOOL_NAME=${SCHOOL_NAME:-$PRODUCT}"
      echo "ADMIN_NAME=${TEACHER_NAME:-Teacher}"
      echo "ADMIN_EMAIL=$TEACHER_EMAIL"
      echo "ADMIN_PASSWORD=$TEACHER_PASSWORD"
      echo "RUNTIME_KIND=$RUNTIME_KIND"
      echo "RUNTIME_URL=${RUNTIME_URL:-http://127.0.0.1:11434}"
      echo "RUNTIME_TOKEN=${RUNTIME_TOKEN:-}"
      echo "RUNTIME_TIMEOUT_S=300"
      echo "CHAT_MODEL=${CHAT_MODEL:-qwen3:1.7b}"
      echo "EMBED_MODEL=${EMBED_MODEL:-nomic-embed-text}"
    } > "$ENV_FILE"
  )
fi

mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$SRV</string>
  <key>ProgramArguments</key>
  <array>
    <string>$VENV/bin/python</string><string>-m</string><string>uvicorn</string>
    <string>app.main:app</string><string>--host</string><string>127.0.0.1</string>
    <string>--port</string><string>$PORT</string><string>--env-file</string><string>$ENV_FILE</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOGS/server.log</string>
  <key>StandardErrorPath</key><string>$LOGS/server.log</string>
</dict>
</plist>
EOF

# -- 5. start it and keep it running ----------------------------------------------------
step 5 "Starting"
start_agent || fail "Teacher's Desk couldn't start. Restart your Mac and try again."
for _ in $(seq 1 90); do
  curl -sf "$URL/api/health" 2>/dev/null | grep -q '"local":true' && break
  sleep 1
done
curl -sf "$URL/api/health" 2>/dev/null | grep -q '"local":true' \
  || fail "Teacher's Desk didn't start. Details are in ~/Library/Logs/Teachers Desk/server.log"

# The password is only needed to create the account, which now exists: don't keep it.
sed -i '' '/^ADMIN_PASSWORD=/d' "$ENV_FILE"

echo "READY $URL"
