#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$CLIENT_DIR/.." && pwd)"
SOURCE_WORKFLOWS_DIR="$REPO_ROOT/workflows"
DEST_ROOT="$CLIENT_DIR/.cre"
DEST_WORKFLOWS_DIR="$DEST_ROOT/workflows"

mkdir -p "$DEST_WORKFLOWS_DIR"
rm -rf "$DEST_WORKFLOWS_DIR/event-microinsurance"

cp "$SOURCE_WORKFLOWS_DIR/project.yaml" "$DEST_WORKFLOWS_DIR/project.yaml"
cp -R "$SOURCE_WORKFLOWS_DIR/event-microinsurance" "$DEST_WORKFLOWS_DIR/event-microinsurance"

# Keep staged workflow slim for serverless bundle limits.
rm -rf "$DEST_WORKFLOWS_DIR/event-microinsurance/node_modules"
rm -rf "$DEST_WORKFLOWS_DIR/event-microinsurance/test"
rm -rf "$DEST_WORKFLOWS_DIR/event-microinsurance/test-payloads"

if [ ! -f "$DEST_WORKFLOWS_DIR/event-microinsurance/.cre_build_tmp.js" ]; then
  echo "[cre-build] Warning: missing .cre_build_tmp.js in staged workflow."
  echo "[cre-build] Runtime simulate may fail without bundled workflow artifact."
fi
