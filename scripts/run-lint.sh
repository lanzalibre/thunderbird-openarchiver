#!/usr/bin/env bash
# Run lint checks on the extension.
# Requires web-ext: npm install -g web-ext

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ADDON_DIR="$ROOT_DIR/addon"

if command -v web-ext &>/dev/null; then
  echo "Running web-ext lint..."
  cd "$ADDON_DIR"
  web-ext lint
else
  echo "web-ext not found. Skipping lint."
  echo "Install with: npm install -g web-ext"
fi
