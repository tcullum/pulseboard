#!/bin/sh
set -eu

: "${TELEMETRY_TOKEN:?TELEMETRY_TOKEN is required}"
: "${PULSEBOARD_LOCAL_PASSWORD:?PULSEBOARD_LOCAL_PASSWORD is required}"

exec ./node_modules/.bin/wrangler dev \
  --config dist/server/wrangler.json \
  --ip 0.0.0.0 \
  --port 3000 \
  --persist-to /data \
  --var "PULSEBOARD_LOCAL_MODE:true" \
  --var "PULSEBOARD_LOCAL_OWNER_EMAIL:${PULSEBOARD_LOCAL_OWNER_EMAIL:-thomas@pulseboard.local}" \
  --var "PULSEBOARD_LOCAL_USERNAME:${PULSEBOARD_LOCAL_USERNAME:-thomas}" \
  --var "PULSEBOARD_LOCAL_PASSWORD:${PULSEBOARD_LOCAL_PASSWORD}" \
  --var "TELEMETRY_TOKEN:${TELEMETRY_TOKEN}" \
  --log-level info \
  --show-interactive-dev-session=false
