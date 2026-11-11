import { isDoubaoChatURL } from "./doubao-target.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.DOUBAO_THEME_PORT || "9237";
const phase = process.env.DOUBAO_SETTINGS_CAPTURE_PHASE || "current";
const tabs = ["colors", "layout", "welcome"];
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
  const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
  return result.result.value;
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

await call("Page.enable");
const screenshotDirectory = path.join(projectDirectory, "qa", "settings-panel-audit");
await mkdir(screenshotDirectory, { recursive: true });
const screenshots = [];
for (let index = 0; index < tabs.length; index += 1) {
  const tab = tabs[index];
  await evaluate(`(() => {
    window.__doubaoThemeOpenSettings?.();
    document.querySelector('.doubao-theme-settings-tab[data-tab="${tab}"]')?.click();
    return !document.querySelector('#doubao-theme-settings-layer')?.hidden;
  })()`);
  await wait(180);
  const capture = await call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  const filePath = path.join(screenshotDirectory, `${phase}-${String(index + 1).padStart(2, "0")}-${tab}.png`);
  await writeFile(filePath, Buffer.from(capture.data, "base64"));
  screenshots.push(filePath);
}

socket.close();
console.log(JSON.stringify({ phase, screenshots }, null, 2));
