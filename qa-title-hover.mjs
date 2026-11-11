import { isDoubaoChatURL } from "./doubao-target.mjs";
const port = process.env.DOUBAO_THEME_PORT || "9237";
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page" && isDoubaoChatURL(item.url) && /^\/chat\/\d+/.test(new URL(item.url).pathname));
if (!target) throw new Error("Doubao conversation page was not found");

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
const evaluate = async (expression) => {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
  return result.result.value;
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

await call("Runtime.enable");
const titleRect = await evaluate(`(() => {
  const element = document.querySelector('[data-testid="editable_conversation_name"]');
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
})()`);
if (!titleRect) throw new Error("Editable conversation title was not found");

const snapshot = () => evaluate(`(() => {
  const root = document.querySelector('[data-testid="editable_conversation_name"]');
  const title = root?.querySelector(':scope > div');
  const overlay = root?.querySelector('[data-slot="dropdown-menu-trigger"]');
  const titleStyle = title ? getComputedStyle(title) : null;
  const overlayStyle = overlay ? getComputedStyle(overlay) : null;
  return {
    text: title?.textContent?.trim() || "",
    titleVisible: Boolean(titleStyle)
      && titleStyle.display !== "none"
      && titleStyle.visibility !== "hidden"
      && Number(titleStyle.opacity) > 0,
    titleColor: titleStyle?.color || null,
    overlayBackground: overlayStyle?.backgroundColor || null,
    overlayAdapted: overlay?.classList.contains("doubao-theme-adapted-surface") || false,
    hovered: root?.matches(":hover") || false,
  };
})()`);

await call("Input.dispatchMouseEvent", {
  type: "mouseMoved",
  x: titleRect.x + titleRect.width / 2,
  y: titleRect.y + titleRect.height / 2,
});
await wait(500);
const duringHover = await snapshot();

await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 20, y: 420 });
await wait(500);
const afterHover = await snapshot();
socket.close();

const result = { duringHover, afterHover };
const failures = [];
for (const [state, item] of Object.entries(result)) {
  if (!item.text || !item.titleVisible) failures.push(`${state}: conversation title is not visible`);
  if (item.overlayAdapted) failures.push(`${state}: empty title overlay was adapted as a surface`);
  if (item.overlayBackground !== "rgba(0, 0, 0, 0)") failures.push(`${state}: title overlay is not transparent`);
}
if (!duringHover.hovered) failures.push("hover state was not reached");
if (afterHover.hovered) failures.push("hover state did not clear");
if (failures.length) {
  console.error(JSON.stringify({ failures, result }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
