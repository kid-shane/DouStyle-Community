import { isDoubaoChatURL } from "./doubao-target.mjs";
const port = process.env.DOUBAO_THEME_PORT || "9237";
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page" && isDoubaoChatURL(item.url));
if (!target) throw new Error("Doubao chat page was not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

const expression = String.raw`(async () => {
  const styleElement = document.getElementById("doubao-local-theme");
  if (!styleElement) return null;
  const previousDisabled = styleElement.disabled;
  styleElement.disabled = true;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const rootStyle = getComputedStyle(document.documentElement);
  const read = (name) => rootStyle.getPropertyValue(name).trim();
  const result = {
    dataTheme: document.documentElement.getAttribute("data-theme"),
    variables: Object.fromEntries([
      "--s-color-brand-primary-default",
      "--s-color-brand-primary-hover",
      "--s-color-brand-primary-pressed",
      "--s-color-bg-body",
      "--s-color-bg-primary",
      "--s-color-bg-secondary",
      "--s-color-bg-tertiary",
      "--s-color-text-primary",
      "--s-color-text-secondary",
      "--s-color-border-primary",
      "--s-color-border-secondary",
      "--g-send-msg-bubble-bg",
      "--g-send-msg-bubble-text",
      "--color-g-send-msg-bubble-bg",
      "--color-g-send-msg-bubble-text"
    ].map((name) => [name, read(name)])),
    computed: {
      rootBackground: getComputedStyle(document.documentElement).backgroundColor,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      bodyColor: getComputedStyle(document.body).color,
      sidebarBackground: getComputedStyle(document.querySelector("#flow_chat_sidebar")).backgroundColor,
      userBubble: (() => {
        const element = document.querySelector("[class*='bg-g-send-msg-bubble-bg']");
        if (!element) return null;
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, color: style.color };
      })(),
    },
  };
  styleElement.disabled = previousDisabled;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  return result;
})()`;

const result = await call("Runtime.evaluate", {
  expression,
  awaitPromise: true,
  returnByValue: true,
});
console.log(JSON.stringify(result.result.value, null, 2));
socket.close();
