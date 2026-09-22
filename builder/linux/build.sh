#!/usr/bin/env bash
# Build StructureLab on Linux. Installs missing packages, compiles, writes portable-linux/.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ ! -f package.json ]]; then
  echo "ERROR: package.json not found. Run this from a StructureLab checkout."
  exit 1
fi

DEPS="$ROOT/builder/linux/install-deps.sh"
if [[ ! -f "$DEPS" ]]; then
  echo "ERROR: $DEPS is missing."
  exit 1
fi
chmod +x "$DEPS"

echo
echo "=== StructureLab Linux build ==="
echo "Repo: $ROOT"
echo

echo "Installing Linux packages if needed (sudo may ask for a password)..."
bash "$DEPS" --build

if [[ -f "$HOME/.cargo/env" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

if [[ ! -d node_modules ]]; then
  echo "Installing npm dependencies..."
  npm install
  echo
fi

echo "[1/2] Building Tauri release..."
rm -rf "$ROOT/src-tauri/target/release/bundle/appimage" \
  "$ROOT/src-tauri/target/release/bundle/deb" \
  "$ROOT/src-tauri/target/release/bundle/rpm" || {
  echo "ERROR: cannot replace previous Linux bundle output. Close the app if it is running, then rebuild."
  exit 1
}
npm run tauri -- build

echo
echo "[2/2] Packaging portable-linux..."
OUT="$ROOT/portable-linux"

replace_path() {
  local path="$1"
  if [[ ! -e "$path" ]]; then
    return 0
  fi
  rm -rf "$path" || {
    echo "ERROR: cannot replace $path"
    echo "Close StructureLab if that build is running, then rebuild."
    exit 1
  }
}

replace_path "$OUT"
rm -f "$ROOT"/StructureLab-*.AppImage \
  "$ROOT"/StructureLab-*-linux*.tar.gz \
  "$ROOT"/StructureLab-*-portable-linux.tar.gz \
  2>/dev/null || true
mkdir -p "$OUT"

BIN=""
for candidate in \
  "$ROOT/src-tauri/target/release/structurelab" \
  "$ROOT/src-tauri/target/release/structurelab.bin"
do
  if [[ -f "$candidate" ]]; then
    BIN="$candidate"
    break
  fi
done

if [[ -z "$BIN" ]]; then
  echo "ERROR: Release binary not found under src-tauri/target/release/"
  exit 1
fi

rm -f "$OUT/structurelab"
cp -f "$BIN" "$OUT/structurelab"
chmod +x "$OUT/structurelab"

APPIMAGE=""
shopt -s nullglob
for image in "$ROOT"/src-tauri/target/release/bundle/appimage/*.AppImage; do
  APPIMAGE="$image"
done
shopt -u nullglob

if [[ -n "$APPIMAGE" ]]; then
  rm -f "$OUT/StructureLab.AppImage"
  cp -f "$APPIMAGE" "$OUT/StructureLab.AppImage"
  chmod +x "$OUT/StructureLab.AppImage"
fi

MC_SRC="$ROOT/minecraft"
if [[ -d "$MC_SRC" ]]; then
  echo "  Copying minecraft/ assets..."
  replace_path "$OUT/minecraft"
  cp -a "$MC_SRC" "$OUT/minecraft"
fi

# Never ship repo builder helpers with the app.
rm -rf "$OUT/scripts" "$OUT/builder" "$OUT/install-deps.sh"

cat > "$OUT/README.txt" <<'EOF'
StructureLab for Minecraft (Linux)

Keep the files in this folder together.

Run:
  ./StructureLab.AppImage

If FUSE is missing:
  ./StructureLab.AppImage --appimage-extract-and-run

Or the raw binary:
  ./structurelab

Needs WebKitGTK 4.1 and GTK 3 from your distro (for example
libwebkit2gtk-4.1-0 and libgtk-3-0 on Debian/Ubuntu).
EOF

echo
echo "=== Done ==="
echo "  Folder: $OUT"
if [[ -n "$APPIMAGE" ]]; then
  echo "  AppImage: $OUT/StructureLab.AppImage"
fi
echo "  Binary:   $OUT/structurelab"
echo
echo "Run:  cd portable-linux && ./StructureLab.AppImage"
