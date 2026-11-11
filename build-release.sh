#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
VERSION="${BUILD_VERSION:-$(tr -d '[:space:]' < "$PROJECT_DIR/VERSION")}"
PRODUCT_NAME="${PRODUCT_NAME:-豆Style}"
BUNDLE_ID="${BUNDLE_ID:-local.doubao.style}"
APP_EXECUTABLE="${APP_EXECUTABLE:-DouStyle}"
ARTIFACT_NAME="${ARTIFACT_NAME:-DouStyle}"
BUILD_ROOT="$PROJECT_DIR/build/release"
DIST_DIR="$PROJECT_DIR/dist"
APP_BUNDLE="$BUILD_ROOT/$PRODUCT_NAME.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_RESOURCES="$APP_CONTENTS/Resources"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
SIGN_IDENTITY="${SIGN_IDENTITY:--}"
INSTALLER_SIGN_IDENTITY="${INSTALLER_SIGN_IDENTITY:-}"
NOTARY_PROFILE="${NOTARY_PROFILE:-}"

APP_BUILD_ROOT="$BUILD_ROOT" BUILD_VERSION="$VERSION" "$PROJECT_DIR/build-app.sh"
mkdir -p "$DIST_DIR"

ARCH="$(/usr/bin/file "$APP_RESOURCES/runtime/node" | /usr/bin/sed -E 's/.*Mach-O 64-bit executable ([^ ]+).*/\1/')"
BASE_NAME="$ARTIFACT_NAME-$VERSION-macOS-$ARCH"
LEGACY_BASE_NAME="Doubao-Appearance-$VERSION-macOS-$ARCH"
NOTARY_ZIP="$BUILD_ROOT/$BASE_NAME-notarization.zip"
if [ -n "$NOTARY_PROFILE" ]; then
  /usr/bin/ditto -c -k --keepParent "$APP_BUNDLE" "$NOTARY_ZIP"
  /usr/bin/xcrun notarytool submit "$NOTARY_ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
  /usr/bin/xcrun stapler staple "$APP_BUNDLE"
fi

ZIP_PATH="$DIST_DIR/$BASE_NAME.zip"
DMG_PATH="$DIST_DIR/$BASE_NAME.dmg"
PKG_PATH="$DIST_DIR/$BASE_NAME.pkg"
/bin/rm -f "$ZIP_PATH" "$DMG_PATH" "$PKG_PATH" "$DIST_DIR/SHA256SUMS.txt"
/bin/rm -f "$DIST_DIR/$LEGACY_BASE_NAME.zip" "$DIST_DIR/$LEGACY_BASE_NAME.dmg" "$DIST_DIR/$LEGACY_BASE_NAME.pkg"
/usr/bin/ditto -c -k --keepParent "$APP_BUNDLE" "$ZIP_PATH"

DMG_ROOT="$BUILD_ROOT/dmg"
mkdir -p "$DMG_ROOT"
/usr/bin/ditto "$APP_BUNDLE" "$DMG_ROOT/$PRODUCT_NAME.app"
/bin/ln -s /Applications "$DMG_ROOT/Applications"
DMG_VOLUME_NAME="$PRODUCT_NAME $VERSION"
DMG_RW_PATH="$BUILD_ROOT/$BASE_NAME-read-write.dmg"
DMG_MOUNT_POINT="/Volumes/$DMG_VOLUME_NAME"
DMG_DEVICE=""

cleanup_dmg_mount() {
  if [ -n "$DMG_DEVICE" ]; then
    /usr/bin/hdiutil detach "$DMG_DEVICE" -quiet >/dev/null 2>&1 || true
    DMG_DEVICE=""
  fi
}
trap cleanup_dmg_mount EXIT

/bin/rm -f "$DMG_RW_PATH"
if [ -e "$DMG_MOUNT_POINT" ]; then
  echo "请先推出已挂载的 ${DMG_VOLUME_NAME}，再重新构建。" >&2
  exit 1
fi
/usr/bin/hdiutil create -quiet -volname "$DMG_VOLUME_NAME" -srcfolder "$DMG_ROOT" -ov -format UDRW "$DMG_RW_PATH"
DMG_ATTACH_OUTPUT="$(/usr/bin/hdiutil attach -readwrite -noverify -noautoopen "$DMG_RW_PATH")"
DMG_DEVICE="$(printf '%s\n' "$DMG_ATTACH_OUTPUT" | /usr/bin/awk -v mount="$DMG_MOUNT_POINT" 'index($0, mount) { print $1; exit }')"
if [ -z "$DMG_DEVICE" ]; then
  echo "DMG 挂载失败。" >&2
  exit 1
fi

if [ -n "${DMG_LAYOUT_TEMPLATE:-}" ]; then
  /bin/cp "$DMG_LAYOUT_TEMPLATE" "$DMG_MOUNT_POINT/.DS_Store"
else
/usr/bin/osascript <<OSA
tell application "Finder"
  tell disk "$DMG_VOLUME_NAME"
    open
    set dmgWindow to container window
    set current view of dmgWindow to icon view
    set toolbar visible of dmgWindow to false
    set statusbar visible of dmgWindow to false
    set pathbar visible of dmgWindow to false
    set bounds of dmgWindow to {160, 120, 680, 460}
    set viewOptions to icon view options of dmgWindow
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 96
    set text size of viewOptions to 13
    set position of item "$PRODUCT_NAME.app" to {145, 165}
    set position of item "Applications" to {375, 165}
    update without registering applications
    delay 1
    close
    delay 1
  end tell
end tell
OSA
fi

/bin/sync
cleanup_dmg_mount
/usr/bin/hdiutil convert -quiet "$DMG_RW_PATH" -format UDZO -imagekey zlib-level=9 -o "$DMG_PATH"
/bin/rm -f "$DMG_RW_PATH"
if [ "$SIGN_IDENTITY" != "-" ]; then
  /usr/bin/codesign --force --timestamp --sign "$SIGN_IDENTITY" "$DMG_PATH"
fi

PKG_ROOT="$BUILD_ROOT/pkg-root"
PKG_COMPONENT_PLIST="$BUILD_ROOT/pkg-components.plist"
PKG_COMPONENT="$BUILD_ROOT/$BASE_NAME-component.pkg"
mkdir -p "$PKG_ROOT"
/usr/bin/ditto --norsrc --noextattr "$APP_BUNDLE" "$PKG_ROOT/$PRODUCT_NAME.app"
/usr/bin/pkgbuild --analyze --root "$PKG_ROOT" "$PKG_COMPONENT_PLIST"
/usr/bin/plutil -replace '0.BundleIsRelocatable' -bool NO "$PKG_COMPONENT_PLIST"
/usr/bin/plutil -replace '0.BundleIsVersionChecked' -bool NO "$PKG_COMPONENT_PLIST"
/usr/bin/plutil -replace '0.BundleHasStrictIdentifier' -bool YES "$PKG_COMPONENT_PLIST"
/usr/bin/plutil -replace '0.BundleOverwriteAction' -string upgrade "$PKG_COMPONENT_PLIST"
/usr/bin/pkgbuild \
  --root "$PKG_ROOT" \
  --install-location /Applications \
  --identifier "$BUNDLE_ID" \
  --version "$VERSION" \
  --component-plist "$PKG_COMPONENT_PLIST" \
  "$PKG_COMPONENT"
if [ -n "$INSTALLER_SIGN_IDENTITY" ]; then
  /usr/bin/productbuild --package "$PKG_COMPONENT" --sign "$INSTALLER_SIGN_IDENTITY" "$PKG_PATH"
else
  /usr/bin/productbuild --package "$PKG_COMPONENT" "$PKG_PATH"
fi

if [ -n "$NOTARY_PROFILE" ]; then
  /usr/bin/xcrun notarytool submit "$DMG_PATH" --keychain-profile "$NOTARY_PROFILE" --wait
  /usr/bin/xcrun stapler staple "$DMG_PATH"
  if [ -n "$INSTALLER_SIGN_IDENTITY" ]; then
    /usr/bin/xcrun notarytool submit "$PKG_PATH" --keychain-profile "$NOTARY_PROFILE" --wait
    /usr/bin/xcrun stapler staple "$PKG_PATH"
  fi
fi

/usr/bin/shasum -a 256 "$ZIP_PATH" "$DMG_PATH" "$PKG_PATH" > "$DIST_DIR/SHA256SUMS.txt"
echo "发布包已生成："
echo "  $PKG_PATH"
echo "  $DMG_PATH"
echo "  $ZIP_PATH"
