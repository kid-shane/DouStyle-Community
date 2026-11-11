#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
VERSION="${BUILD_VERSION:-$(tr -d '[:space:]' < "$PROJECT_DIR/VERSION")}"
PRODUCT_NAME="${PRODUCT_NAME:-豆Style}"
BUNDLE_ID="${BUNDLE_ID:-local.doubao.style}"
APP_EXECUTABLE="${APP_EXECUTABLE:-DouStyle}"
ARTIFACT_NAME="${ARTIFACT_NAME:-DouStyle}"
BUILD_ROOT="${APP_BUILD_ROOT:-$PROJECT_DIR/build/app}"
APP_BUNDLE="$BUILD_ROOT/$PRODUCT_NAME.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_RESOURCES="$APP_CONTENTS/Resources"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
SIGN_IDENTITY="${SIGN_IDENTITY:--}"
DOUSTYLE_COMMUNITY_BUILD="${DOUSTYLE_COMMUNITY_BUILD:-1}"
if [ "$DOUSTYLE_COMMUNITY_BUILD" = "1" ]; then
  BUNDLE_ID="${BUNDLE_ID_COMMUNITY:-local.doubao.style.community}"
fi
INSTALLER_SIGN_IDENTITY="${INSTALLER_SIGN_IDENTITY:-}"
NOTARY_PROFILE="${NOTARY_PROFILE:-}"

if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "找不到 Node.js。请通过 NODE_BIN 指定可执行文件。" >&2
  exit 1
fi
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "VERSION 必须使用 x.y.z 格式。" >&2
  exit 1
fi
if [ -n "$NOTARY_PROFILE" ] && [ "$SIGN_IDENTITY" = "-" ]; then
  echo "Apple 公证需要通过 SIGN_IDENTITY 指定 Developer ID Application 证书。" >&2
  exit 1
fi

case "$BUILD_ROOT" in
  "$PROJECT_DIR"/build/*) rm -rf "$BUILD_ROOT" ;;
  *) echo "构建目录校验失败。" >&2; exit 1 ;;
esac
mkdir -p "$APP_CONTENTS/MacOS" "$APP_RESOURCES/theme" "$APP_RESOURCES/runtime"

SPARKLE_DIR="$("$PROJECT_DIR/scripts/prepare-sparkle.sh")"
mkdir -p "$APP_CONTENTS/Frameworks"
/usr/bin/ditto "$SPARKLE_DIR/Sparkle.framework" "$APP_CONTENTS/Frameworks/Sparkle.framework"
/usr/bin/clang -Os -fobjc-arc -mmacosx-version-min=13.5 -framework Cocoa -framework Sparkle \
  -F"$SPARKLE_DIR" -Wl,-rpath,@executable_path/../Frameworks \
  "$PROJECT_DIR/launcher.m" -o "$APP_CONTENTS/MacOS/$APP_EXECUTABLE"
/bin/cp "$PROJECT_DIR/packaging/Info.plist" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $PRODUCT_NAME" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName $PRODUCT_NAME" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable $APP_EXECUTABLE" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_ID" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION" "$APP_CONTENTS/Info.plist"

if [ "${DOUSTYLE_PREVIEW:-0}" = "1" ] || [ "$DOUSTYLE_COMMUNITY_BUILD" = "1" ]; then
  /usr/libexec/PlistBuddy -c "Add :DouStylePreview bool true" "$APP_CONTENTS/Info.plist"
fi

if [ "$DOUSTYLE_COMMUNITY_BUILD" != "1" ]; then
UPDATE_PUBLIC_KEY="$(tr -d '[:space:]' < "$PROJECT_DIR/packaging/update-public-key.txt")"
/usr/libexec/PlistBuddy -c "Add :SUFeedURL string https://doustyle-updates.tos-cn-beijing.volces.com/appcast.xml" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Add :SUPublicEDKey string $UPDATE_PUBLIC_KEY" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Add :SUEnableAutomaticChecks bool true" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Add :SUAutomaticallyUpdate bool false" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Add :SUSendProfileInfo bool false" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Add :SUVerifyUpdateBeforeExtraction bool true" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Add :SURequireSignedFeed bool true" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Add :SUShowReleaseNotes bool true" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Add :SUEnableJavaScript bool false" "$APP_CONTENTS/Info.plist"

fi

/bin/cp "$PROJECT_DIR/launch.sh" "$APP_RESOURCES/launch.sh"
/bin/chmod 755 "$APP_RESOURCES/launch.sh"
/bin/cp "$PROJECT_DIR/doubao-target.mjs" "$PROJECT_DIR/skin-model.mjs" "$PROJECT_DIR/skin-runtime.mjs" "$PROJECT_DIR/skin-ui.mjs" "$PROJECT_DIR/skin-ui.css" "$PROJECT_DIR/skin-cli.mjs" "$PROJECT_DIR/skin-workshop.mjs" "$PROJECT_DIR/skin-workshop-ui.mjs" "$APP_RESOURCES/theme/"
/bin/cp "$PROJECT_DIR/injector.mjs" "$PROJECT_DIR/composer-clean-input.mjs" "$PROJECT_DIR/theme-appearance.mjs" "$PROJECT_DIR/update-ui.mjs" "$PROJECT_DIR/update-bridge.mjs" "$PROJECT_DIR/theme.css" "$PROJECT_DIR/appearance.json" "$APP_RESOURCES/theme/"
/bin/cp "$PROJECT_DIR/LICENSE" "$PROJECT_DIR/THIRD_PARTY_NOTICES.md" "$APP_RESOURCES/"
/bin/cp -R "$PROJECT_DIR/themes" "$PROJECT_DIR/skins" "$PROJECT_DIR/skills" "$PROJECT_DIR/assets" "$APP_RESOURCES/theme/"

NODE_REAL_PATH="$("$NODE_BIN" -e 'console.log(require("node:fs").realpathSync(process.argv[1]))' "$NODE_BIN")"
/bin/cp "$NODE_REAL_PATH" "$APP_RESOURCES/runtime/node"
/bin/chmod 755 "$APP_RESOURCES/runtime/node"
NODE_ROOT="$(CDPATH= cd -- "$(dirname -- "$NODE_REAL_PATH")/.." && pwd)"
if [ -f "$NODE_ROOT/LICENSE" ]; then
  /bin/cp "$NODE_ROOT/LICENSE" "$APP_RESOURCES/runtime/NODE-LICENSE.txt"
fi

ICON_BUILD_DIR="$BUILD_ROOT/icon"
mkdir -p "$ICON_BUILD_DIR/AppIcon.iconset" "$ICON_BUILD_DIR/rendered"
if /usr/bin/qlmanage -t -s 1024 -o "$ICON_BUILD_DIR/rendered" "$PROJECT_DIR/packaging/AppIcon.svg" >/dev/null 2>&1; then
  ICON_SOURCE="$ICON_BUILD_DIR/rendered/AppIcon.svg.png"
  if [ -f "$ICON_SOURCE" ]; then
    for spec in "16 icon_16x16" "32 icon_16x16@2x" "32 icon_32x32" "64 icon_32x32@2x" "128 icon_128x128" "256 icon_128x128@2x" "256 icon_256x256" "512 icon_256x256@2x" "512 icon_512x512" "1024 icon_512x512@2x"; do
      size="${spec%% *}"
      name="${spec#* }"
      /usr/bin/sips -z "$size" "$size" "$ICON_SOURCE" --out "$ICON_BUILD_DIR/AppIcon.iconset/$name.png" >/dev/null
    done
    /usr/bin/iconutil -c icns "$ICON_BUILD_DIR/AppIcon.iconset" -o "$APP_RESOURCES/AppIcon.icns"
  fi
fi

/usr/bin/xattr -cr "$APP_BUNDLE"
# Sign nested Sparkle helpers inside-out, then the containing framework/app.
SIGN_OPTIONS=(--force)
if [ "$SIGN_IDENTITY" != "-" ]; then SIGN_OPTIONS=(--force --options runtime --timestamp); fi
for nested in Autoupdate Updater.app XPCServices/Downloader.xpc XPCServices/Installer.xpc; do
  target="$APP_CONTENTS/Frameworks/Sparkle.framework/Versions/B/$nested"
  if [ -e "$target" ]; then /usr/bin/codesign --force "${SIGN_OPTIONS[@]}" --sign "$SIGN_IDENTITY" "$target"; fi
done
/usr/bin/codesign --force "${SIGN_OPTIONS[@]}" --sign "$SIGN_IDENTITY" "$APP_CONTENTS/Frameworks/Sparkle.framework"
if [ "$SIGN_IDENTITY" = "-" ]; then
  /usr/bin/codesign --force --sign - "$APP_RESOURCES/runtime/node"
  /usr/bin/codesign --force --sign - "$APP_BUNDLE"
else
  /usr/bin/codesign --force --options runtime --timestamp --entitlements "$PROJECT_DIR/packaging/node-entitlements.plist" --sign "$SIGN_IDENTITY" "$APP_RESOURCES/runtime/node"
  /usr/bin/codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP_BUNDLE"
fi
/usr/bin/codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"
"$APP_RESOURCES/runtime/node" -e 'new Function("return 42")(); console.log("Bundled runtime preflight passed")'

echo "应用构建完成：$APP_BUNDLE"
