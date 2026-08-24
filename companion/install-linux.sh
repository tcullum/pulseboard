#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_PATH="$(command -v node)"
RELAY_URL="${PULSEBOARD_RELAY_URL:-https://pulse.cullum.dad}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/Pulseboard"
CONFIG_PATH="$CONFIG_DIR/relay.json"
SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_PATH="$SYSTEMD_DIR/com.pulseboard.telemetry.service"

mkdir -p "$CONFIG_DIR" "$SYSTEMD_DIR"

if [[ -n "${PULSEBOARD_RELAY_TOKEN:-}" || -n "${PULSEBOARD_SIWC_TOKEN:-}" || -n "${PLEX_TOKEN:-}" || -n "${PLEX_URL:-}" ]]; then
  umask 077
  PULSEBOARD_CONFIG_PATH="$CONFIG_PATH" \
  PULSEBOARD_RELAY_TOKEN="${PULSEBOARD_RELAY_TOKEN:-}" \
  PULSEBOARD_SIWC_TOKEN="${PULSEBOARD_SIWC_TOKEN:-}" \
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
    if (process.env.PLEX_TOKEN) config.plexToken = process.env.PLEX_TOKEN;
    if (process.env.PLEX_URL) config.plexUrl = process.env.PLEX_URL;
    fs.writeFileSync(process.env.PULSEBOARD_CONFIG_PATH, JSON.stringify(config, null, 2));
  '
fi

cat > "$SERVICE_PATH" <<EOF
[Unit]
Description=Pulseboard Linux telemetry companion
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$SCRIPT_DIR
ExecStart=$NODE_PATH $SCRIPT_DIR/pulseboard-telemetry.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now com.pulseboard.telemetry.service

echo "Pulseboard Companion is installed and running."
