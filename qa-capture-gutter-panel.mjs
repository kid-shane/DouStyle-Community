import { isDoubaoChatURL } from "./doubao-target.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = process.env.DOUBAO_THEME_PORT || "9237";
const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const screenshotPath = path.join(projectDirectory, "qa", "implementation-gutter-panel-v5.png");
const sidebarScreenshotPath = path.join(projectDirectory, "qa", "implementation-sidebar-icons-v5.png");
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
const runtimeExceptions = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") runtimeExceptions.push(message.params.exceptionDetails.text || "Runtime exception");
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
const waitFor = async (expression, timeout = 10_000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${expression}`);
};

await call("Page.enable");
await call("Runtime.enable");
await waitFor("typeof window.__doubaoThemeGetSettings === 'function'");
const initialSettings = await evaluate("window.__doubaoThemeGetSettings()");

const panelState = await evaluate(String.raw`(() => {
  window.__doubaoThemeOpenSettings();
  document.querySelector('.doubao-theme-settings-tab[data-tab="layout"]')?.click();
  const rows = Array.from(document.querySelectorAll('#doubao-theme-pane-layout .doubao-theme-setting-row'));
  const gutter = document.querySelector('#doubao-theme-setting-contentGutter');
  const gutterDescription = document.querySelector('#doubao-theme-setting-description-contentGutter');
  const descriptionRange = gutterDescription ? document.createRange() : null;
  descriptionRange?.selectNodeContents(gutterDescription);
  return {
    labels: rows.map((row) => row.querySelector('.doubao-theme-setting-label')?.textContent?.trim()).filter(Boolean),
    gutter: gutter ? { min: gutter.min, max: gutter.max, step: gutter.step, value: gutter.value } : null,
    gutterDescriptionLines: descriptionRange ? Array.from(descriptionRange.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0).length : null,
    hasSidebarSection: Boolean(document.querySelector('.doubao-theme-sidebar-section')),
    hasContentWidth: Boolean(document.querySelector('#doubao-theme-setting-contentMaxWidth')),
    layerVisible: !document.querySelector('#doubao-theme-settings-layer')?.hidden
  };
})()`);
await wait(150);
const capture = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
await mkdir(path.dirname(screenshotPath), { recursive: true });
await writeFile(screenshotPath, Buffer.from(capture.data, "base64"));
await evaluate("window.__doubaoThemeCloseSettings()");
await wait(100);
const sidebarCapture = await call("Page.captureScreenshot", {
  format: "png",
  fromSurface: true,
  clip: { x: 0, y: 72, width: 280, height: 280, scale: 1 }
});
await writeFile(sidebarScreenshotPath, Buffer.from(sidebarCapture.data, "base64"));

try {
  await call("Page.reload", { ignoreCache: true });
} catch (error) {
  if (!String(error?.message || error).includes("Inspected target navigated or closed")) throw error;
}
await wait(300);
await waitFor("typeof window.__doubaoThemeGetSettings === 'function'");
await waitFor("Boolean(document.querySelector('#input-engine-container'))");
const reloadedSettings = await evaluate("window.__doubaoThemeGetSettings()");
const storedSettings = await evaluate("JSON.parse(localStorage.getItem('doubao-local-appearance-v1') || '{}')");
socket.close();

const failures = [];
if (panelState.labels.includes("内容宽度") || panelState.hasContentWidth) failures.push("面板仍包含内容宽度");
if (!panelState.labels.includes("两侧边距")) failures.push("面板缺少两侧边距");
if (JSON.stringify(panelState.gutter) !== JSON.stringify({ min: "12", max: "360", step: "4", value: String(initialSettings.contentGutter) })) failures.push("两侧边距范围或当前值不正确");
if (panelState.gutterDescriptionLines !== 1) failures.push("两侧边距说明出现了不自然折行");
if (panelState.hasSidebarSection) failures.push("面板仍包含已移除的侧边功能项设置");
if (Object.hasOwn(storedSettings, "contentMaxWidth")) failures.push("旧内容宽度未从存储中移除");
if (JSON.stringify(reloadedSettings) !== JSON.stringify(initialSettings)) failures.push("重载后设置未保持");
if (runtimeExceptions.length) failures.push("基础交互期间出现运行时异常");

const result = { screenshotPath, sidebarScreenshotPath, initialSettings, panelState, reloadedSettings, runtimeExceptions, failures };
if (failures.length) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
