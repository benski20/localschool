#!/bin/bash
# Stops the Local School server and removes its launchd agent. Data is kept unless --purge.
set -euo pipefail
LABEL="org.localschool.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"
if [ "${1:-}" = "--purge" ]; then
  rm -rf "$HOME/Library/Application Support/LocalSchoolServer" "$HOME/Library/Logs/LocalSchool"
  echo "Removed the server and its data."
else
  echo "Stopped and removed the server. Data kept in ~/Library/Application Support/LocalSchoolServer (use --purge to delete)."
fi
