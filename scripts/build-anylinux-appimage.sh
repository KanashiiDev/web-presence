#!/bin/sh
# Build a truly portable AppImage for Web Presence Bridge
# Works on any Linux distro including musl-based ones (Alpine, Void, LFS)
# Uses sharun + uruntime — no FUSE, no glibc dependency on host
# Reference: https://github.com/pkgforge-dev/Anylinux-AppImages

set -eu

ARCH="$(uname -m)"
QUICK_SHARUN_URL="https://raw.githubusercontent.com/pkgforge-dev/Anylinux-AppImages/refs/heads/main/useful-tools/quick-sharun.sh"

# Output config 
export OUTPATH="./dist/anylinux"
export OUTNAME="web-presence-bridge-${VERSION:-dev}-${ARCH}-anylinux.AppImage"

# AppImage metadata 
export ICON="./app/assets/icon/512x512.png"
export DESKTOP="./scripts/web-presence-bridge.desktop"

# Self-updater hook disabled — updater.js handles GitHub Releases directly 
# ADD_HOOKS intentionally not set

# Bake WEB_PRESENCE_ANYLINUX=1 into the AppImage environment 
# updater.js reads this variable at runtime to detect the anylinux install
# method and skip electron-updater (which requires latest-linux.yml).
# Instead it falls back to the GitHub Releases page, same as pacman/deb/rpm.
export EXTRA_ENV="WEB_PRESENCE_ANYLINUX=1"

# Build 
mkdir -p "$OUTPATH"

echo "==> Downloading quick-sharun..."
wget "$QUICK_SHARUN_URL" -O ./quick-sharun
chmod +x ./quick-sharun

# electron-builder --dir produces dist/linux-unpacked/ with the real Electron
# binary at its root. We pass that binary to quick-sharun so it can detect
# and bundle every shared library the process actually loads (via strace).
ELECTRON_BINARY="$(find ./dist/linux-unpacked -maxdepth 1 -type f -executable -not -name "*.so*" | head -n1)"

if [ -z "$ELECTRON_BINARY" ]; then
    echo "ERROR: Could not find Electron binary in dist/linux-unpacked/" >&2
    exit 1
fi

echo "==> Found Electron binary: $ELECTRON_BINARY"
echo "==> Bundling with quick-sharun..."
./quick-sharun "$ELECTRON_BINARY"

echo "==> Creating AppImage..."
./quick-sharun --make-appimage

echo "==> Done: $OUTPATH/$OUTNAME"
