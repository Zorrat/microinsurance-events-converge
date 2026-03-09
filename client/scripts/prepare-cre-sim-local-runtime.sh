#!/usr/bin/env bash
set -euo pipefail

npm run prepare:cre:sim-assets

WORKFLOW_STAGE_DIR="./.cre/workflows/event-microinsurance"

if [ ! -f "$WORKFLOW_STAGE_DIR/package-lock.json" ]; then
  echo "[cre-build] Missing $WORKFLOW_STAGE_DIR/package-lock.json"
  echo "[cre-build] Cannot install staged workflow dependencies for local simulate."
  exit 1
fi

if [ -x "$WORKFLOW_STAGE_DIR/node_modules/.bin/cre-compile" ]; then
  echo "[cre-build] Local staged workflow deps already present."
else
  echo "[cre-build] Installing local staged workflow deps into $WORKFLOW_STAGE_DIR"
  npm ci --omit=dev --ignore-scripts --prefix "$WORKFLOW_STAGE_DIR"
fi

PLUGIN_PATH="$WORKFLOW_STAGE_DIR/node_modules/@chainlink/cre-sdk-javy-plugin/dist/javy-chainlink-sdk.plugin.wasm"
if [ -f "$PLUGIN_PATH" ]; then
  echo "[cre-build] Local CRE SDK Javy plugin already prepared."
  exit 0
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "[cre-build] Missing Bun runtime."
  echo "[cre-build] Install Bun and rerun: https://bun.sh/docs/installation"
  exit 1
fi

echo "[cre-build] Running one-time CRE setup (bun x cre-setup) for staged workflow"
(
  cd "$WORKFLOW_STAGE_DIR"
  bun x cre-setup
)
