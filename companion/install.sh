#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
NODE_PATH="$(command -v node)"
PLIST_PATH="$HOME/Library/LaunchAgents/com.pulseboard.telemetry.plist"
CONFIG_DIR="$HOME/Library/Application Support/Pulseboard"
LOG_DIR="$CONFIG_DIR/logs"
CONFIG_PATH="$CONFIG_DIR/relay.json"
RUNTIME_DIR="$HOME/.local/lib/pulseboard"
RELAY_URL="${PULSEBOARD_RELAY_URL:-https://pulse.cullum.dad}"

mkdir -p "$LOG_DIR" "$CONFIG_DIR"
mkdir -p "$RUNTIME_DIR"
cp "$SCRIPT_DIR/pulseboard-telemetry.mjs" "$RUNTIME_DIR/pulseboard-telemetry.mjs"
cp "$SCRIPT_DIR/pulseboard-telemetry-launcher.sh" "$RUNTIME_DIR/pulseboard-telemetry-launcher.sh"
chmod 755 "$RUNTIME_DIR/pulseboard-telemetry-launcher.sh"

if [[ -n "${PULSEBOARD_RELAY_TOKEN:-}" || -n "${PULSEBOARD_SIWC_TOKEN:-}" || -n "${PULSEBOARD_LOCAL_USERNAME:-}" || -n "${PULSEBOARD_LOCAL_PASSWORD:-}" || -n "${PLEX_TOKEN:-}" || -n "${PLEX_URL:-}" ]]; then
  umask 077
  PULSEBOARD_CONFIG_PATH="$CONFIG_PATH" \
  PULSEBOARD_RELAY_TOKEN="${PULSEBOARD_RELAY_TOKEN:-}" \
  PULSEBOARD_SIWC_TOKEN="${PULSEBOARD_SIWC_TOKEN:-}" \
  PULSEBOARD_LOCAL_USERNAME="${PULSEBOARD_LOCAL_USERNAME:-}" \
  PULSEBOARD_LOCAL_PASSWORD="${PULSEBOARD_LOCAL_PASSWORD:-}" \
  PULSEBOARD_RELAY_URL="$RELAY_URL" \
  PLEX_TOKEN="${PLEX_TOKEN:-}" \
  PLEX_URL="${PLEX_URL:-}" \
  "$NODE_PATH" -e '
    const fs = require("node:fs");
    let config = {};
    try { config = JSON.parse(fs.readFileSync(process.env.PULSEBOARD_CONFIG_PATH, "utf8")); } catch {}
    if (process.env.PULSEBOARD_RELAY_TOKEN && process.env.PULSEBOARD_SIWC_TOKEN) {
      config.relayUrl = process.env.PULSEBOARD_RELAY_URL;
      config.deviceToken = process.env.PULSEBOARD_RELAY_TOKEN;
      config.siwcToken = process.env.PULSEBOARD_SIWC_TOKEN;
    }
    if (process.env.PULSEBOARD_LOCAL_USERNAME) config.basicUsername = process.env.PULSEBOARD_LOCAL_USERNAME;
    if (process.env.PULSEBOARD_LOCAL_PASSWORD) config.basicPassword = process.env.PULSEBOARD_LOCAL_PASSWORD;
    if (process.env.PLEX_TOKEN) config.plexToken = process.env.PLEX_TOKEN;
    if (process.env.PLEX_URL) config.plexUrl = process.env.PLEX_URL;
    fs.writeFileSync(process.env.PULSEBOARD_CONFIG_PATH, JSON.stringify(config, null, 2));
  '
fi

sed \
  -e "s|__LAUNCHER__|$RUNTIME_DIR/pulseboard-telemetry-launcher.sh|g" \
  -e "s|__LOG_DIR__|$LOG_DIR|g" \
  "$SCRIPT_DIR/launch-agent.plist.template" > "$PLIST_PATH"

launchctl bootout "gui/$(id -u)/com.pulseboard.telemetry" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl enable "gui/$(id -u)/com.pulseboard.telemetry"
launchctl kickstart -k "gui/$(id -u)/com.pulseboard.telemetry"

echo "Pulseboard Companion is installed and running."
