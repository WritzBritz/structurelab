#!/usr/bin/env bash
# Build StructureLab on macOS. Produces .app / .dmg under src-tauri/target/release/bundle/.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ ! -f package.json ]]; then
  echo "ERROR: package.json not found. Run this from a StructureLab checkout."
  exit 1
fi

if ! command -v xcode-select >/dev/null 2>&1 || ! xcode-select -p >/dev/null 2>&1; then
  echo "Install Xcode Command Line Tools first:"
  echo "  xcode-select --install"
  exit 1
fi

echo
echo "=== StructureLab macOS build ==="
echo "Repo: $ROOT"
echo

if [[ ! -d node_modules ]]; then
  echo "Installing npm dependencies..."
  npm install
  echo
fi

echo "Building Tauri release..."
BUNDLE="$ROOT/src-tauri/target/release/bundle"
rm -rf "$BUNDLE/macos" "$BUNDLE/dmg" || {
  echo "ERROR: cannot replace $BUNDLE (close the .app if it is running, then rebuild)."
  exit 1
}
npm run tauri -- build

echo
echo "=== Done ==="
echo "  App:  $ROOT/src-tauri/target/release/bundle/macos/"
echo "  Disk image: $ROOT/src-tauri/target/release/bundle/dmg/"
