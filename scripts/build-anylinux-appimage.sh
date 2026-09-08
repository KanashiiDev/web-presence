#!/bin/bash
set -eu

ARCH=$(uname -m)
APP_NAME="web-presence-bridge"
PRODUCT_NAME="Web Presence Bridge"

case "$ARCH" in
  x86_64) deb_arch=amd64;;
  aarch64|arm64) deb_arch=arm64;;
  *) deb_arch=amd64;;
esac

echo "Installing package dependencies..."
echo "---------------------------------------------------------------"
pacman -Syu --noconfirm \
  git-lfs \
  gnome-keyring \
  libcurl-gnutls \
  pre-commit || true

echo "Installing debloated packages..."
echo "---------------------------------------------------------------"
get-debloated-pkgs --add-common --prefer-nano || true

if [ -z "${VERSION:-}" ]; then
  VERSION=$(sed -n 's/.*"version": *"\(.*\)".*/\1/p' package.json)
fi

DEB_FILE=$(find "${LOCAL_DEB_DIR:-./dist}" -name "web-presence-*-${deb_arch}.deb" | head -1)

if [ -z "$DEB_FILE" ]; then
  echo "==> ERROR: No .deb found in LOCAL_DEB_DIR=${LOCAL_DEB_DIR:-./dist}"
  exit 1
fi

echo "==> Using .deb artifact: $DEB_FILE"
cp "$DEB_FILE" /tmp/app.deb

export ARCH
export VERSION
export OUTPATH="./dist/anylinux"
export OUTNAME="${APP_NAME}-${VERSION}-${ARCH}-anylinux.AppImage"
export UPINFO="gh-releases-zsync|KanashiiDev|web-presence|latest|*${ARCH}*anylinux*.AppImage.zsync"
export ICON="https://raw.githubusercontent.com/KanashiiDev/web-presence/refs/heads/main/app/assets/icon/512x512.png"
export STARTUPWMCLASS="Web Presence Bridge"

mkdir -p "$OUTPATH"
rm -rf ./AppDir
mkdir -p ./AppDir/bin

WORK_DIR=$(mktemp -d)
cd "$WORK_DIR"
ar xvf /tmp/app.deb

if [ -f "data.tar.xz" ]; then
  tar -xvf data.tar.xz
elif [ -f "data.tar.zst" ]; then
  bsdtar -xvf data.tar.zst
else
  tar -xvf data.tar.*
fi
cd - > /dev/null

# electron-builder places the unpacked app in /opt/<productName>/ for .deb
if [ -d "$WORK_DIR/opt/$PRODUCT_NAME" ]; then
  echo "==> Moving '$PRODUCT_NAME' contents to AppDir/bin/..."
  
  # Copy only files and specific subdirectories (locales, resources) to AppDir/bin/
  # Skip the nested usr/ directory to avoid polluting AppDir/bin/ with icon paths
  for item in "$WORK_DIR/opt/$PRODUCT_NAME"/*; do
    base=$(basename "$item")
    if [ "$base" = "usr" ]; then
      continue
    fi
    cp -av "$item" ./AppDir/bin/
  done
  
  # Move icon files from opt/<productName>/usr/share/icons/ to AppDir/usr/share/icons/
  if [ -d "$WORK_DIR/opt/$PRODUCT_NAME/usr/share/icons" ]; then
    mkdir -p ./AppDir/usr/share/icons
    cp -av "$WORK_DIR/opt/$PRODUCT_NAME/usr/share/icons/." ./AppDir/usr/share/icons/
  fi
else
  echo "==> ERROR: Could not find $WORK_DIR/opt/$PRODUCT_NAME"
  ls -la "$WORK_DIR/opt/" || true
  exit 1
fi

# Copy and modify the desktop file
if ls "$WORK_DIR"/usr/share/applications/*.desktop 1>/dev/null 2>&1; then
  for desktop_file in "$WORK_DIR"/usr/share/applications/*.desktop; do
    cp -av "$desktop_file" ./AppDir/
    dest="./AppDir/$(basename "$desktop_file")"
    sed -i "s|^Exec=.*|Exec=${APP_NAME} %U|" "$dest"
    sed -i "s|^Icon=.*|Icon=${APP_NAME}|" "$dest"
    echo "==> Fixed desktop file: $dest"
    cat "$dest" | head -10
  done
fi

rm -rf "$WORK_DIR"
rm -f /tmp/app.deb

# Ensure all binaries are executable
chmod +x ./AppDir/bin/* 2>/dev/null || true

# Setup .env for the AppImage runtime
cat << 'EOF' > ./AppDir/.env
WEB_PRESENCE_ANYLINUX=1
EOF

echo "==> Running quick-sharun collection..."
quick-sharun "./AppDir/bin/${APP_NAME}" \
  /usr/bin/git-lfs \
  /usr/bin/gnome* \
  /usr/bin/pre-commit \
  /usr/bin/secret-tool \
  /usr/lib/gnome-keyring/devel/gkm*.so* \
  /usr/lib/pkcs11/gnome*.so* \
  /usr/lib/security/pam*.so* \
  /usr/lib/libsecret*.so* \
  /usr/lib/libcurl*.so*

echo "==> Making AppImage..."
quick-sharun --make-appimage

mv ./dist/*.AppImage "$OUTPATH/" 2>/dev/null || true

echo "==> Running quick-sharun simple test..."
quick-sharun --simple-test "$OUTPATH/$OUTNAME" || true

echo "==> Successfully built package in: $OUTPATH/"
ls -la "$OUTPATH/"
