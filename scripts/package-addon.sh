#!/usr/bin/env bash
# Package the Thunderbird extension as a .xpi file.
# Uses web-ext if available, otherwise creates a simple zip.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ADDON_DIR="$ROOT_DIR/addon"
DIST_DIR="$ROOT_DIR/dist"
XPI_FILE="$DIST_DIR/thunderbird-openarchiver.xpi"

mkdir -p "$DIST_DIR"

if command -v web-ext &>/dev/null; then
  echo "Building with web-ext..."
  cd "$ADDON_DIR"
  web-ext build --overwrite-dest --artifacts-dir "$DIST_DIR"
  echo "Web extension built in $DIST_DIR"
else
  echo "web-ext not found. Creating zip-based .xpi..."
  cd "$ADDON_DIR"
  zip -r "$XPI_FILE" . \
    -x "*.DS_Store" \
    -x "*__MACOSX*"
  echo "Created $XPI_FILE"
fi
