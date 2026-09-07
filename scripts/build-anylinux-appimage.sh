#!/bin/bash
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

# Update info for zsync 
export UPINFO="gh-releases-zsync|KanashiiDev|web-presence|latest|*${ARCH}*anylinux*.AppImage.zsync"

# Build 
mkdir -p "$OUTPATH"

echo "==> Downloading quick-sharun..."
wget "$QUICK_SHARUN_URL" -O ./quick-sharun
chmod +x ./quick-sharun

# Find unpacked Electron directory 
# electron-builder --dir output path varies slightly by version/config.
# Check both known locations before failing.
UNPACKED_DIR=""
if [ -d "./dist/linux/linux-unpacked" ]; then
  UNPACKED_DIR="./dist/linux/linux-unpacked"
elif [ -d "./dist/linux-unpacked" ]; then
  UNPACKED_DIR="./dist/linux-unpacked"
else
  echo "ERROR: Could not find linux-unpacked directory" >&2
  find dist -type d 2>/dev/null | head -30 || true
  exit 1
fi

ELECTRON_BINARY="$(find "$UNPACKED_DIR" -maxdepth 1 -type f -executable -not -name "*.so*" | head -n1)"

if [ -z "$ELECTRON_BINARY" ]; then
  echo "ERROR: Could not find Electron binary in $UNPACKED_DIR/" >&2
  ls -la "$UNPACKED_DIR" || true
  exit 1
fi

echo "==> Using unpacked directory: $UNPACKED_DIR"
echo "==> Found Electron binary: $ELECTRON_BINARY"

# Bundle with quick-sharun 
# quick-sharun strace's the binary to detect all .so dependencies and bundles
# them. It also auto-detects Electron via binary strings and enables
# DEPLOY_ELECTRON, DEPLOY_OPENGL, DEPLOY_VULKAN, DEPLOY_PIPEWIRE automatically.
echo "==> Bundling with quick-sharun..."
./quick-sharun "$ELECTRON_BINARY"

# Bake WEB_PRESENCE_ANYLINUX=1 into the AppImage environment 
# quick-sharun sources AppDir/.env at runtime via sharun.
# updater.js reads this to detect the anylinux install method and skip
# electron-updater (no latest-linux.yml). Falls back to GitHub Releases page.
echo "WEB_PRESENCE_ANYLINUX=1" >> AppDir/.env

# Copy critical Electron resource files 
# quick-sharun bundles .so libraries and executables via strace, but misses
# data files that Electron needs at startup.
echo "==> Copying critical Electron resource files..."

# Locate where quick-sharun placed the Electron binary inside AppDir.
# The path varies by quick-sharun version so we find it dynamically.
ELECTRON_BASENAME="$(basename "$ELECTRON_BINARY")"
APPDIR_BIN="$(find AppDir -name "$ELECTRON_BASENAME" -type f 2>/dev/null | head -n1 | xargs dirname || true)"

if [ -z "$APPDIR_BIN" ]; then
  echo "ERROR: Could not locate Electron binary inside AppDir" >&2
  find AppDir -type f 2>/dev/null | head -30 || true
  exit 1
fi

echo "==> Electron binary located at: $APPDIR_BIN"

# Copy data files that must sit alongside the Electron binary
CRITICAL_FILES="
  icudtl.dat
  chrome_100_percent.pak
  chrome_200_percent.pak
  resources.pak
  snapshot_blob.bin
  v8_context_snapshot.bin
  LICENSE.electron.txt
"

for file in $CRITICAL_FILES; do
  [ -z "$file" ] && continue
  SRC="$UNPACKED_DIR/$file"
  DEST="$APPDIR_BIN/$file"
  if [ -f "$SRC" ]; then
    cp "$SRC" "$DEST"
    echo "  • Copied $file"
  else
    echo "  • WARNING: $file not found in $UNPACKED_DIR (may be optional)"
  fi
done

# Copy locales/ — required for Chromium i18n
if [ -d "$UNPACKED_DIR/locales" ]; then
  cp -r "$UNPACKED_DIR/locales" "$APPDIR_BIN/locales"
  echo "  • Copied locales/"
else
  echo "  • WARNING: locales/ not found — Chromium i18n may fail"
fi

# Copy resources/ — contains app.asar and native modules
if [ -d "$UNPACKED_DIR/resources" ]; then
  cp -r "$UNPACKED_DIR/resources" "$APPDIR_BIN/resources"
  echo "  • Copied resources/"
else
  echo "  • WARNING: resources/ not found — app will not start"
fi

# Create AppImage 
echo "==> Creating AppImage..."
./quick-sharun --make-appimage

echo "==> Done: $OUTPATH/$OUTNAME"
