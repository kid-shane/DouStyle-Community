import { isDoubaoChatURL } from "./doubao-target.mjs";
const port = process.env.DOUBAO_THEME_PORT || "9237";
const action = process.env.DOUBAO_SETTINGS_ACTION || "open";
const requestedTab = process.env.DOUBAO_SETTINGS_TAB || "";
if (!new Set(["open", "close", "click-trigger"]).has(action)) {
  throw new Error(`Unsupported settings action: ${action}`);
}
if (requestedTab && !new Set(["colors", "layout", "welcome"]).has(requestedTab)) {
  throw new Error(`Unsupported settings tab: ${requestedTab}`);
}
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page" && isDoubaoChatURL(item.url));
if (!target) throw new Error("Doubao chat page was not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

const result = await new Promise((resolve, reject) => {
  const id = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== id) return;
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  socket.send(JSON.stringify({
    id,
    method: "Runtime.evaluate",
    params: {
      expression: action === "open"
        ? `(() => {
          if (!window.__doubaoThemeOpenSettings?.()) return false;
          ${requestedTab ? `document.querySelector(${JSON.stringify(`.doubao-theme-settings-tab[data-tab="${requestedTab}"]`)})?.click();` : ""}
          return true;
        })()`
        : action === "close"
          ? "(window.__doubaoThemeCloseSettings?.(), true)"
          : "(window.__doubaoThemeCloseSettings?.(), document.getElementById('doubao-theme-settings-trigger')?.click(), !document.getElementById('doubao-theme-settings-layer')?.hidden)",
      returnByValue: true,
    },
  }));
});

socket.close();
if (!result?.result?.value) throw new Error(`DouStyle settings action failed: ${action}`);
console.log(`DouStyle settings action completed: ${action}`);
