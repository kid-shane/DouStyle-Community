#!/bin/bash
set -u

RESOURCE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
THEME_DIR="$RESOURCE_DIR/theme"
NODE_BIN="$RESOURCE_DIR/runtime/node"
if [ ! -f "$THEME_DIR/injector.mjs" ] && [ -f "$RESOURCE_DIR/injector.mjs" ]; then
  THEME_DIR="$RESOURCE_DIR"
  NODE_BIN="${DOUBAO_NODE_BIN:-$(command -v node || true)}"
fi
THEME_PORT="${DOUBAO_THEME_PORT:-9237}"
THEME_NAME="${DOUBAO_THEME_NAME:-mira}"
LOG_DIR="$HOME/Library/Logs/DouStyle"
LOG_FILE="$LOG_DIR/theme.log"

mkdir -p "$LOG_DIR"
# Preserve the native launcher's command pipe; normal logs never enter it.
if [ "${DOUBAO_UPDATE_ENABLED:-0}" = "1" ]; then
  exec 3>&1
fi
exec >>"$LOG_FILE" 2>&1
echo "[$(/bin/date '+%Y-%m-%d %H:%M:%S')] launcher started"

show_error() {
  local message="$1"
  echo "ERROR: $message"
  /usr/bin/osascript -e "display alert \"豆Style 无法启动\" message \"$message\" as critical" >/dev/null 2>&1 || true
}

find_doubao_app() {
  local candidate bundle_id
  for candidate in \
    "/Applications/DoubaoWork.app" \
    "/Applications/豆包工作.app" \
    "$HOME/Applications/DoubaoWork.app" \
    "$HOME/Applications/豆包工作.app" \
    "/Applications/Doubao.app" \
    "/Applications/豆包.app" \
    "$HOME/Applications/Doubao.app" \
    "$HOME/Applications/豆包.app"; do
    if is_doubao_app "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  for bundle_id in com.work.pc.doubao com.bot.pc.doubao; do
    while IFS= read -r candidate; do
      if is_doubao_app "$candidate"; then
        printf '%s\n' "$candidate"
        return 0
      fi
    done < <(/usr/bin/mdfind "kMDItemCFBundleIdentifier == '$bundle_id'" 2>/dev/null)
  done
  return 1
}

is_doubao_app() {
  local bundle_id
  bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$1/Contents/Info.plist" 2>/dev/null || true)"
  case "$bundle_id" in
    com.work.pc.doubao|com.bot.pc.doubao) return 0 ;;
    *) return 1 ;;
  esac
}

if [ ! -x "$NODE_BIN" ] || [ ! -f "$THEME_DIR/injector.mjs" ]; then
  show_error "安装内容不完整，请重新安装豆Style。"
  exit 1
fi

DOUBAO_APP="$(find_doubao_app || true)"
if [ -z "$DOUBAO_APP" ]; then
  show_error "没有找到豆包工作，请先安装豆包桌面端。"
  exit 1
fi

DOUBAO_EXECUTABLE_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$DOUBAO_APP/Contents/Info.plist" 2>/dev/null || true)"
DOUBAO_BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$DOUBAO_APP/Contents/Info.plist")"
DOUBAO_EXECUTABLE="$DOUBAO_APP/Contents/MacOS/$DOUBAO_EXECUTABLE_NAME"
if [ -z "$DOUBAO_EXECUTABLE_NAME" ] || [ ! -x "$DOUBAO_EXECUTABLE" ]; then
  show_error "豆包桌面端结构异常，请更新或重新安装豆包。"
  exit 1
fi

debug_port_is_doubao() {
  /usr/bin/curl --max-time 2 -fsS "http://127.0.0.1:$THEME_PORT/json/list" 2>/dev/null | "$NODE_BIN" --input-type=module -e '
    import { pathToFileURL } from "node:url";
    const { isDoubaoChatURL } = await import(pathToFileURL(process.argv[1]));
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    try {
      const targets = JSON.parse(input);
      process.exit(Array.isArray(targets) && targets.some(target => target.type === "page" && isDoubaoChatURL(target.url)) ? 0 : 1);
    } catch { process.exit(1); }
  ' "$THEME_DIR/doubao-target.mjs" 2>/dev/null
}

stop_previous_doustyle_injectors() {
  local pid command
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    [ "$pid" = "$$" ] && continue
    command="$(/bin/ps -p "$pid" -o command= 2>/dev/null || true)"
    case "$command" in
      *"/豆Style.app/Contents/Resources/theme/injector.mjs"*)
        /bin/kill -TERM "$pid" >/dev/null 2>&1 || true
        ;;
    esac
  done < <(/usr/bin/pgrep -f '/豆Style\.app/Contents/Resources/theme/injector\.mjs' 2>/dev/null || true)
}

if /usr/bin/curl -fsS "http://127.0.0.1:$THEME_PORT/json/version" >/dev/null 2>&1 && ! debug_port_is_doubao; then
  show_error "本机端口 $THEME_PORT 已被其他应用占用，请退出占用它的应用后重试。"
  exit 1
fi

if ! debug_port_is_doubao; then
  if /usr/bin/pgrep -x "$DOUBAO_EXECUTABLE_NAME" >/dev/null 2>&1; then
    /usr/bin/osascript -e "tell application id \"$DOUBAO_BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      if ! /usr/bin/pgrep -x "$DOUBAO_EXECUTABLE_NAME" >/dev/null 2>&1; then
        break
      fi
      /bin/sleep 0.5
    done
    if /usr/bin/pgrep -x "$DOUBAO_EXECUTABLE_NAME" >/dev/null 2>&1; then
      /usr/bin/pkill -TERM -x "$DOUBAO_EXECUTABLE_NAME" >/dev/null 2>&1 || true
    fi
  fi

  /usr/bin/open -na "$DOUBAO_APP" --args \
    --remote-debugging-address=127.0.0.1 \
    --remote-debugging-port="$THEME_PORT"

  ready=0
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40; do
    if debug_port_is_doubao; then
      ready=1
      break
    fi
    /bin/sleep 0.5
  done
  if [ "$ready" -ne 1 ]; then
    show_error "豆包已经打开，但 Style 服务未能连接。请退出豆包后再试一次。"
    exit 1
  fi
fi

stop_previous_doustyle_injectors
DOUBAO_THEME_PORT="$THEME_PORT" DOUBAO_THEME_NAME="$THEME_NAME" exec "$NODE_BIN" "$THEME_DIR/injector.mjs"
