#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_APP="$PROJECT_DIR/build/Pulseboard Status.app"
TARGET_APP="/Applications/Pulseboard Status.app"
LAUNCH_AGENT="$HOME/Library/LaunchAgents/com.pulseboard.status.plist"
LAUNCH_DOMAIN="gui/$(id -u)"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

if [[ ! -d "$SOURCE_APP" ]]; then
  "$PROJECT_DIR/build-app.sh"
fi

pkill -x PulseboardStatus 2>/dev/null || true
"$LSREGISTER" -u "$TARGET_APP" 2>/dev/null || true
ditto "$SOURCE_APP" "$TARGET_APP"
xattr -cr "$TARGET_APP"
codesign --force --deep --sign - "$TARGET_APP"
"$LSREGISTER" -f "$TARGET_APP"
touch "$TARGET_APP"
mkdir -p "$HOME/Library/LaunchAgents"
cp "$PROJECT_DIR/com.pulseboard.status.plist" "$LAUNCH_AGENT"
launchctl bootout "$LAUNCH_DOMAIN/com.pulseboard.status" 2>/dev/null || true
launchctl bootstrap "$LAUNCH_DOMAIN" "$LAUNCH_AGENT"
launchctl enable "$LAUNCH_DOMAIN/com.pulseboard.status"

echo "$TARGET_APP"
