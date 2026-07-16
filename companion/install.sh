#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
NODE_PATH="$(command -v node)"
PLIST_PATH="$HOME/Library/LaunchAgents/com.pulseboard.telemetry.plist"
LOG_DIR="$HOME/Library/Logs/Pulseboard"
CONFIG_DIR="$HOME/Library/Application Support/Pulseboard"
CONFIG_PATH="$CONFIG_DIR/relay.json"

mkdir -p "$LOG_DIR" "$CONFIG_DIR"

if [[ -n "${PULSEBOARD_RELAY_TOKEN:-}" && -n "${PULSEBOARD_SIWC_TOKEN:-}" ]]; then
  umask 077
  PULSEBOARD_CONFIG_PATH="$CONFIG_PATH" \
  PULSEBOARD_RELAY_TOKEN="$PULSEBOARD_RELAY_TOKEN" \
  PULSEBOARD_SIWC_TOKEN="$PULSEBOARD_SIWC_TOKEN" \
  "$NODE_PATH" -e '
    const fs = require("node:fs");
    fs.writeFileSync(process.env.PULSEBOARD_CONFIG_PATH, JSON.stringify({
      relayUrl: "https://pulseboard-mac-monitor.rysingsun.chatgpt.site",
      deviceToken: process.env.PULSEBOARD_RELAY_TOKEN,
      siwcToken: process.env.PULSEBOARD_SIWC_TOKEN,
    }, null, 2));
  '
fi

sed \
  -e "s|__NODE__|$NODE_PATH|g" \
  -e "s|__SCRIPT__|$SCRIPT_DIR/pulseboard-telemetry.mjs|g" \
  -e "s|__LOG_DIR__|$LOG_DIR|g" \
  "$SCRIPT_DIR/launch-agent.plist.template" > "$PLIST_PATH"

launchctl bootout "gui/$(id -u)/com.pulseboard.telemetry" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl kickstart -k "gui/$(id -u)/com.pulseboard.telemetry"

echo "Pulseboard Companion is installed and running."
