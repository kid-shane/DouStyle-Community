#!/bin/bash
set -euo pipefail
PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SPARKLE_VERSION=2.9.6
EXPECTED_SHA=52bf9e88cdd972fc0c81501377a880e90d47031bd8ca5462488f843e2609e192
CACHE="$PROJECT_DIR/.cache"
ARCHIVE="$CACHE/Sparkle-$SPARKLE_VERSION.tar.xz"
DEST="$CACHE/sparkle-$SPARKLE_VERSION"
mkdir -p "$CACHE"
if [ ! -f "$ARCHIVE" ]; then
  /usr/bin/curl --fail --location --retry 2 --proto '=https' --tlsv1.2 \
    "https://github.com/sparkle-project/Sparkle/releases/download/$SPARKLE_VERSION/Sparkle-$SPARKLE_VERSION.tar.xz" -o "$ARCHIVE.tmp" >&2
  mv "$ARCHIVE.tmp" "$ARCHIVE"
fi
ACTUAL_SHA="$(/usr/bin/shasum -a 256 "$ARCHIVE" | /usr/bin/awk '{print $1}')"
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then echo "Sparkle 依赖校验失败" >&2; exit 1; fi
if [ ! -d "$DEST/Sparkle.framework" ]; then
  mkdir -p "$DEST"
  tar -xf "$ARCHIVE" -C "$DEST"
fi
printf '%s\n' "$DEST"
