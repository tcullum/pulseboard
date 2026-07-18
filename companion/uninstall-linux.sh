#!/usr/bin/env bash
set -euo pipefail

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/Pulseboard"
SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_PATH="$SYSTEMD_DIR/com.pulseboard.telemetry.service"

systemctl --user disable --now com.pulseboard.telemetry.service 2>/dev/null || true
rm -f "$SERVICE_PATH"
systemctl --user daemon-reload 2>/dev/null || true
rm -f "$CONFIG_DIR/relay.json"

echo "Pulseboard Companion is uninstalled."
