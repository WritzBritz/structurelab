#!/usr/bin/env bash
# Install StructureLab Linux dependencies when they are missing. Safe to re-run.
#
#   ./install-deps.sh           # runtime libs (to run the app)
#   ./install-deps.sh --build   # runtime + compile toolchain (Node, Rust, WebKitGTK -dev)

set -euo pipefail

MODE="runtime"
for arg in "$@"; do
  case "$arg" in
    --build|-b) MODE="build" ;;
    --runtime|-r) MODE="runtime" ;;
    --help|-h)
      echo "Usage: $0 [--runtime|--build]"
      echo "  --runtime  Install libraries needed to run StructureLab (default)"
      echo "  --build    Also install compilers, WebKitGTK -dev, Node 22, and Rust"
      exit 0
      ;;
  esac
done

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

have_runtime() {
  if need_cmd pkg-config && pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
    return 0
  fi
  if [[ -e /usr/lib/x86_64-linux-gnu/libwebkit2gtk-4.1.so.0 ]] \
    || [[ -e /usr/lib64/libwebkit2gtk-4.1.so.0 ]] \
    || [[ -e /usr/lib/libwebkit2gtk-4.1.so.0 ]]; then
    return 0
  fi
  return 1
}

sudo_run() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif need_cmd sudo; then
    sudo "$@"
  else
    echo "ERROR: Need root or sudo to install packages."
    exit 1
  fi
}

install_node_22() {
  if need_cmd node; then
    local major
    major="$(node -v | sed 's/^v//' | cut -d. -f1)"
    if [[ "${major:-0}" -ge 22 ]]; then
      echo "Node.js $(node -v) already installed."
      return 0
    fi
    echo "Node.js $(node -v) is too old; StructureLab needs 22+."
  fi
  if need_cmd apt-get; then
    echo "Installing Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo_run bash -
    sudo_run apt-get install -y nodejs
  elif need_cmd dnf; then
    echo "Installing Node.js 22..."
    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo_run bash -
    sudo_run dnf install -y nodejs
  elif need_cmd pacman; then
    sudo_run pacman -Sy --needed --noconfirm nodejs npm
  else
    echo "ERROR: Install Node.js 22+ from https://nodejs.org then re-run."
    exit 1
  fi
}

install_rust() {
  if need_cmd cargo; then
    echo "Rust/cargo already installed."
    return 0
  fi
  echo "Installing Rust (rustup)..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  if [[ -f "$HOME/.cargo/env" ]]; then
    # shellcheck disable=SC1091
    source "$HOME/.cargo/env"
  fi
}

install_apt() {
  sudo_run apt-get update
  local runtime=(
    libwebkit2gtk-4.1-0
    libgtk-3-0
    libayatana-appindicator3-1
    librsvg2-2
    libxdo3
    libssl3
    ca-certificates
  )
  sudo_run apt-get install -y "${runtime[@]}" || sudo_run apt-get install -y \
    libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 librsvg2-2 libxdo3 ca-certificates
  sudo_run apt-get install -y libfuse2 || sudo_run apt-get install -y libfuse2t64 || true

  if [[ "$MODE" == "build" ]]; then
    sudo_run apt-get install -y \
      libwebkit2gtk-4.1-dev \
      build-essential \
      curl \
      wget \
      file \
      libxdo-dev \
      libssl-dev \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      pkg-config \
      patchelf
  fi
}

install_dnf() {
  local runtime=(webkit2gtk4.1 gtk3 libappindicator-gtk3 librsvg2 libxdo openssl ca-certificates fuse)
  sudo_run dnf install -y "${runtime[@]}"
  if [[ "$MODE" == "build" ]]; then
    sudo_run dnf install -y \
      webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel \
      librsvg2-devel libxdo-devel openssl-devel gcc gcc-c++ make \
      curl wget file pkgconf-pkg-config patchelf
  fi
}

install_pacman() {
  sudo_run pacman -Sy --needed --noconfirm \
    webkit2gtk-4.1 gtk3 libappindicator-gtk3 librsvg xdotool openssl ca-certificates fuse2
  if [[ "$MODE" == "build" ]]; then
    sudo_run pacman -Sy --needed --noconfirm \
      base-devel curl wget file pkgconf patchelf
  fi
}

echo
echo "=== StructureLab Linux setup (${MODE}) ==="

if [[ "$MODE" == "runtime" ]] && have_runtime; then
  echo "WebKitGTK 4.1 is already present. Nothing to install."
  echo "You can run ./StructureLab.AppImage or ./structurelab"
  exit 0
fi

if need_cmd apt-get; then
  install_apt
elif need_cmd dnf; then
  install_dnf
elif need_cmd pacman; then
  install_pacman
else
  echo "ERROR: Unsupported distro. Need apt, dnf, or pacman."
  echo "Install WebKitGTK 4.1 (webkit2gtk-4.1) and GTK 3, then run StructureLab."
  exit 1
fi

if [[ "$MODE" == "build" ]]; then
  if ! need_cmd curl; then
    echo "ERROR: curl is required to install Node/Rust."
    exit 1
  fi
  install_node_22
  install_rust
fi

echo
echo "Setup finished."
if [[ "$MODE" == "build" ]]; then
  echo "Next: bash builder/linux/build.sh"
else
  echo "Next: ./StructureLab.AppImage"
  echo "  or: ./StructureLab.AppImage --appimage-extract-and-run"
  echo "  or: ./structurelab"
fi
