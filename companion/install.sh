#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
NODE_PATH="$(command -v node)"
PLIST_PATH="$HOME/Library/LaunchAgents/com.pulseboard.telemetry.plist"
LOG_DIR="$HOME/Library/Logs/Pulseboard"

mkdir -p "$LOG_DIR"

sed \
  -e "s|__NODE__|$NODE_PATH|g" \
  -e "s|__SCRIPT__|$SCRIPT_DIR/pulseboard-telemetry.mjs|g" \
  -e "s|__LOG_DIR__|$LOG_DIR|g" \
  "$SCRIPT_DIR/launch-agent.plist.template" > "$PLIST_PATH"

launchctl bootout "gui/$(id -u)/com.pulseboard.telemetry" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl kickstart -k "gui/$(id -u)/com.pulseboard.telemetry"

echo "Pulseboard Companion is installed and running."
