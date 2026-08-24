#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"

# launchd does not load shell startup files, so NVM's `node` is not normally
# on PATH. Prefer the stable NVM current symlink, then common system installs,
# then the newest installed NVM version.
NODE_CANDIDATES=(
  "${PULSEBOARD_NODE_PATH:-}"
  "$HOME/.nvm/current/bin/node"
  "/opt/homebrew/bin/node"
  "/usr/local/bin/node"
  "/usr/bin/node"
)

for candidate in "$HOME"/.nvm/versions/node/*/bin/node; do
  [[ -x "$candidate" ]] && NODE_CANDIDATES+=("$candidate")
done

NODE_PATH=""
for candidate in "${NODE_CANDIDATES[@]}"; do
  if [[ -n "$candidate" && -x "$candidate" ]]; then
    NODE_PATH="$candidate"
    break
  fi
done

if [[ -z "$NODE_PATH" ]]; then
  print -u2 "Pulseboard telemetry could not find Node.js."
  exit 127
fi

exec "$NODE_PATH" "$SCRIPT_DIR/pulseboard-telemetry.mjs"
