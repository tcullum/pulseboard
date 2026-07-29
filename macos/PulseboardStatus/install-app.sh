#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_APP="$PROJECT_DIR/build/Pulseboard Status.app"
TARGET_APP="/Applications/Pulseboard Status.app"

if [[ ! -d "$SOURCE_APP" ]]; then
  "$PROJECT_DIR/build-app.sh"
fi

pkill -x PulseboardStatus 2>/dev/null || true
ditto "$SOURCE_APP" "$TARGET_APP"
open "$TARGET_APP"

echo "$TARGET_APP"
