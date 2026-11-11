import { writeSync } from "node:fs";
import { createInterface } from "node:readline";
import { isDoubaoChatOrigin } from "./doubao-target.mjs";

export function isUpdateContext(context) {
  return context?.auxData?.isDefault === true &&
    isDoubaoChatOrigin(context.origin);
}

// The pipe only understands a check request, never a URL, file path or shell code.
export function createUpdateBridge({ enabled, version, input = process.stdin, send = command => writeSync(3, command + "\n") }) {
  let state = { enabled, version, busy: false };
  let lastRequest = 0;
  const listeners = new Set();
  let reader;
  let acknowledgmentTimer;
  const publish = value => {
    state = value;
    for (const listener of listeners) listener(value);
  };
  const start = () => {
    if (!enabled || reader) return;
    reader = createInterface({ input });
    reader.on("line", line => {
      if (line.length > 4096) return;
      try {
        const value = JSON.parse(line);
        if (value.type !== "update-state" || typeof value.busy !== "boolean") return;
        clearTimeout(acknowledgmentTimer);
        publish({ enabled: value.enabled === true, version, busy: value.busy, message: String(value.message || "").slice(0, 500) });
      } catch {}
    });
    reader.on("close", () => {
      clearTimeout(acknowledgmentTimer);
      publish({ enabled: false, version, busy: false, message: "更新服务已断开，请重新打开豆Style" });
    });
    send("ready");
  };
  return {
    get state() { return state; }, start,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    request(payload, context, now = Date.now()) {
      if (!state.enabled || state.busy || payload !== "check" || !isUpdateContext(context) || now - lastRequest < 2000) return false;
      lastRequest = now;
      try {
        send("check"); publish({ ...state, busy: true });
        acknowledgmentTimer = setTimeout(() => publish({ ...state, busy: false, message: "更新服务未响应，请重试" }), 10000);
        acknowledgmentTimer.unref();
        return true;
      }
      catch { publish({ enabled: false, version, busy: false, message: "更新服务已断开，请重新打开豆Style" }); return false; }
    }
  };
}
