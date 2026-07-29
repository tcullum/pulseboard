#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_PATH="$PROJECT_DIR/build/Pulseboard Status.app"

cd "$PROJECT_DIR"
swift build -c release

mkdir -p "$APP_PATH/Contents/MacOS"
cp "$PROJECT_DIR/.build/release/PulseboardStatus" "$APP_PATH/Contents/MacOS/PulseboardStatus"
cp "$PROJECT_DIR/Info.plist" "$APP_PATH/Contents/Info.plist"
xattr -cr "$APP_PATH"
codesign --force --deep --sign - "$APP_PATH"

echo "$APP_PATH"
