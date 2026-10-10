#!/bin/bash
# Installs the Local School server on a school Mac and keeps it running (launchd).
#
#   git clone https://github.com/benski20/localschool && cd localschool
#   ./scripts/install-server-mac.sh
#
# The Mac only runs the app server (no models). Answers come from the GPU runtime you
# connect (Modal for the pilot, the school box later). Teachers' Macs find this server
# automatically on school Wi-Fi.
#
# Non-interactive (IT/CI): set LS_NONINTERACTIVE=1 and any of SCHOOL_NAME, ADMIN_EMAIL,
# ADMIN_PASSWORD, RUNTIME_KIND, RUNTIME_URL, RUNTIME_TOKEN, PORT, LS_SEED_DEMO=1,
# LS_APP_ZIP (path or URL of the Mac app zip to offer teachers), PYTHON.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="org.localschool.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$HOME/Library/Logs/LocalSchool"
DATA="${DATA_DIR:-$HOME/Library/Application Support/LocalSchoolServer}"
PORT="${PORT:-8000}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
ask() { # ask VAR "Prompt" default [secret]
  local var="$1" prompt="$2" def="${3:-}" val
  if [ -n "${!var:-}" ] || [ "${LS_NONINTERACTIVE:-}" = 1 ]; then
    printf -v "$var" '%s' "${!var:-$def}"; return
  fi
  if [ "${4:-}" = secret ]; then read -r -s -p "$prompt: " val; echo; else read -r -p "$prompt [$def]: " val; fi
  printf -v "$var" '%s' "${val:-$def}"
}

[ "$(uname -s)" = "Darwin" ] || fail "This installer is for macOS. On Linux use deploy/box/docker-compose.yml."

# -- prerequisites -------------------------------------------------------------------
find_python() {
  for p in "${PYTHON:-}" python3.13 python3.12 python3.11 /opt/homebrew/bin/python3 /usr/local/bin/python3 python3; do
    [ -n "$p" ] && command -v "$p" >/dev/null 2>&1 || continue
    if "$p" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
      command -v "$p"; return
    fi
  done
  return 1
}
PY="$(find_python)" || fail "Python 3.11+ is required. Install it with: brew install python@3.12"
bold "Using $("$PY" --version) at $PY"

if [ ! -f "$ROOT/web/dist/index.html" ]; then
  command -v npm >/dev/null || fail "Node.js is required to build the web app. Install it with: brew install node"
fi

# -- settings ------------------------------------------------------------------------
ask SCHOOL_NAME "School name" "Local School"
ask ADMIN_EMAIL "Admin email" "admin@school.local"
ask ADMIN_PASSWORD "Admin password (8+ characters)" "" secret
[ "${#ADMIN_PASSWORD}" -ge 8 ] || fail "The admin password must be at least 8 characters."
ask RUNTIME_KIND "Runtime type (ollama / openai / fake)" "ollama"
ask RUNTIME_URL "GPU runtime URL (from the Deploy Modal runtime action)" "http://127.0.0.1:11434"
ask RUNTIME_TOKEN "Runtime access token (LS_RUNTIME_TOKEN; blank if none)" "" secret

# -- install -------------------------------------------------------------------------
bold "Installing the server…"
"$PY" -m venv "$ROOT/.venv"
"$ROOT/.venv/bin/pip" install -q --upgrade pip
"$ROOT/.venv/bin/pip" install -q -e "$ROOT"

if [ ! -f "$ROOT/web/dist/index.html" ]; then
  bold "Building the web app…"
  (cd "$ROOT/web" && npm ci --no-audit --no-fund --silent && npm run build --silent)
fi

mkdir -p "$DATA" "$LOGS"
ENV_FILE="$ROOT/.env"
if [ -f "$ENV_FILE" ] && [ "${LS_FORCE_ENV:-}" != 1 ]; then
  bold "Keeping existing $ENV_FILE"
else
  umask 077
  cat > "$ENV_FILE" <<EOF
DATA_DIR=$DATA
SCHOOL_NAME=$SCHOOL_NAME
ADVERTISE_MDNS=true
PUBLIC_PORT=$PORT
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
RUNTIME_KIND=$RUNTIME_KIND
RUNTIME_URL=$RUNTIME_URL
RUNTIME_TOKEN=$RUNTIME_TOKEN
RUNTIME_TIMEOUT_S=180
EOF
  if [ "$RUNTIME_KIND" = fake ]; then printf 'CHAT_MODEL=fake-chat\nEMBED_MODEL=fake-embed\n' >> "$ENV_FILE"; fi
  umask 022
fi

if [ "${LS_SEED_DEMO:-}" = 1 ]; then
  bold "Loading the demo school (synthetic data)…"
  (cd "$ROOT" && .venv/bin/python -m scripts.seed_demo >/dev/null)
fi

if [ -n "${LS_APP_ZIP:-}" ]; then
  mkdir -p "$DATA/downloads"
  case "$LS_APP_ZIP" in
    http*) curl -fsSL "$LS_APP_ZIP" -o "$DATA/downloads/LocalSchool-macOS.zip" ;;
    *) cp "$LS_APP_ZIP" "$DATA/downloads/LocalSchool-macOS.zip" ;;
  esac
  bold "Mac app ready for teachers."
fi

# -- launchd: start at login, restart if it stops --------------------------------------
mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>ProgramArguments</key>
  <array>
    <string>$ROOT/.venv/bin/python</string><string>-m</string><string>uvicorn</string>
    <string>app.main:app</string><string>--host</string><string>0.0.0.0</string>
    <string>--port</string><string>$PORT</string><string>--proxy-headers</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOGS/server.log</string>
  <key>StandardErrorPath</key><string>$LOGS/server.log</string>
</dict>
</plist>
EOF

DOMAIN="gui/$(id -u)"
launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"

bold "Starting…"
for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && break
  sleep 1
done
curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null || fail "The server didn't start. See $LOGS/server.log"

HOST="$(scutil --get LocalHostName 2>/dev/null || hostname -s).local"
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")"
echo
bold "✅ Local School is running for $SCHOOL_NAME"
echo "   Admin:      http://$HOST:$PORT  (sign in as $ADMIN_EMAIL)"
[ -n "$IP" ] && echo "   By IP:      http://$IP:$PORT"
echo "   Teachers:   curl -fsSL http://$HOST:$PORT/install/mac.sh | bash"
echo "   Logs:       $LOGS/server.log"
echo
echo "Keep this Mac awake and on the school network:"
echo "   sudo pmset -c sleep 0 disksleep 0     # never sleep on power"
echo "If macOS asks whether Python may accept incoming connections or find devices on"
echo "local networks, choose Allow: teachers' Macs find this server through Bonjour."
