#!/bin/zsh
set -euo pipefail

PLIST_PATH="$HOME/Library/LaunchAgents/com.pulseboard.telemetry.plist"
launchctl bootout "gui/$(id -u)/com.pulseboard.telemetry" 2>/dev/null || true
rm -f "$PLIST_PATH"
echo "Pulseboard Companion has been removed."
