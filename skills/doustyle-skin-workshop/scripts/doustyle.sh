#!/bin/bash
set -euo pipefail
SKILL_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
if [ -n "${DOUSTYLE_RESOURCE_DIR:-}" ]; then
  RESOURCE_DIR="$DOUSTYLE_RESOURCE_DIR"
else
  RESOURCE_DIR=""
  for candidate in "/Applications/豆Style XP 预览.app/Contents/Resources" "/Applications/豆Style.app/Contents/Resources" "$HOME/Applications/豆Style.app/Contents/Resources"; do
    if [ -f "$candidate/theme/skin-cli.mjs" ] && [ -x "$candidate/runtime/node" ]; then
      RESOURCE_DIR="$candidate"
      break
    fi
  done
fi
if [ -n "$RESOURCE_DIR" ] && [ -f "$RESOURCE_DIR/theme/skin-cli.mjs" ] && [ -x "$RESOURCE_DIR/runtime/node" ]; then
  exec "$RESOURCE_DIR/runtime/node" "$RESOURCE_DIR/theme/skin-cli.mjs" "$@"
fi
# Source checkout: this also makes the shipped Skill testable before packaging.
if [ -f "$SKILL_ROOT/../../skin-cli.mjs" ]; then
  exec node "$SKILL_ROOT/../../skin-cli.mjs" "$@"
fi
if [ -f "$SKILL_ROOT/local-resources.txt" ]; then
  IFS= read -r RESOURCE_DIR < "$SKILL_ROOT/local-resources.txt"
  if [ -f "$RESOURCE_DIR/theme/skin-cli.mjs" ] && [ -x "$RESOURCE_DIR/runtime/node" ]; then
    exec "$RESOURCE_DIR/runtime/node" "$RESOURCE_DIR/theme/skin-cli.mjs" "$@"
  fi
fi
if [ -f "$SKILL_ROOT/local-source.txt" ]; then
  IFS= read -r SOURCE_DIR < "$SKILL_ROOT/local-source.txt"
  if [ -f "$SOURCE_DIR/skin-cli.mjs" ]; then
    exec node "$SOURCE_DIR/skin-cli.mjs" "$@"
  fi
fi
printf '%s\n' '请先安装并启动支持完整皮肤的豆Style。' >&2
exit 1
