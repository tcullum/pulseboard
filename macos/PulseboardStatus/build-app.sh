#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_PATH="$PROJECT_DIR/build/Pulseboard Status.app"
ICON_SOURCE="$PROJECT_DIR/Assets/AppIcon.svg"
ICONSET_PATH="$PROJECT_DIR/build/AppIcon.iconset"

cd "$PROJECT_DIR"
swift build -c release

mkdir -p "$APP_PATH/Contents/MacOS" "$APP_PATH/Contents/Resources" "$ICONSET_PATH"
cp "$PROJECT_DIR/.build/release/PulseboardStatus" "$APP_PATH/Contents/MacOS/PulseboardStatus"
cp "$PROJECT_DIR/Info.plist" "$APP_PATH/Contents/Info.plist"

while read -r pixels filename; do
  sips -s format png -z "$pixels" "$pixels" "$ICON_SOURCE" --out "$ICONSET_PATH/$filename" >/dev/null
done <<'SIZES'
16 icon_16x16.png
32 icon_16x16@2x.png
32 icon_32x32.png
64 icon_32x32@2x.png
128 icon_128x128.png
256 icon_128x128@2x.png
256 icon_256x256.png
512 icon_256x256@2x.png
512 icon_512x512.png
1024 icon_512x512@2x.png
SIZES

iconutil -c icns "$ICONSET_PATH" -o "$APP_PATH/Contents/Resources/AppIcon.icns"
xattr -cr "$APP_PATH"

echo "$APP_PATH"
