import { isDoubaoChatURL } from "./doubao-target.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const screenshotPath = path.join(projectDirectory, "qa", "implementation-trigger-sidebar-v7.png");
const port = process.env.DOUBAO_THEME_PORT || "9237";
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page" && isDoubaoChatURL(item.url));
if (!target) throw new Error("Doubao page was not found");

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
await waitFor("Boolean(window.__doubaoThemeGetSettings && document.querySelector('#flow_chat_sidebar') && document.querySelector('main'))");

const snapshotExpression = String.raw`(() => {
  const rect = (element) => {
    if (!(element instanceof Element)) return null;
    const box = element.getBoundingClientRect();
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
  };
  const trigger = rect(document.getElementById('doubao-theme-settings-trigger'));
  const sidebar = rect(document.querySelector('#flow_chat_sidebar'));
  const main = rect(document.querySelector('main[data-container-name="main"]') || document.querySelector('main'));
  const gutter = Number(window.__doubaoThemeGetSettings().contentGutter);
  const gridWidth = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--db-layout-content-grid-width'));
  const expectedGridWidth = main ? Math.max(Math.min(320, main.width), main.width - (2 * gutter)) : null;
  return { trigger, triggerHidden: document.getElementById('doubao-theme-settings-trigger')?.hidden, title: rect(document.querySelector('#flow_chat_sidebar [data-testid="workspace-switch-chip"]')), sidebar, main, gutter, gridWidth, expectedGridWidth, layerHidden: document.getElementById('doubao-theme-settings-layer')?.hidden };
})()`;
const snapshot = () => evaluate(snapshotExpression);

const initial = await snapshot();
const panelOpened = await evaluate("window.__doubaoThemeOpenSettings()");
await wait(30);
const panelVisible = await evaluate("document.getElementById('doubao-theme-settings-layer')?.hidden === false");
const panelInteraction = await evaluate(String.raw`(() => {
  const layer = document.getElementById('doubao-theme-settings-layer');
  const panel = layer?.querySelector('.doubao-theme-settings-panel');
  const header = panel?.querySelector('.doubao-theme-settings-header');
  if (!layer || !panel || !header) return null;
  const before = panel.getBoundingClientRect();
  const startX = before.left + 80;
  const startY = before.top + 28;
  const expectedDelta = [
    Math.min(100, innerWidth - 12 - before.right),
    Math.min(60, innerHeight - 12 - before.bottom)
  ];
  header.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 97, pointerType: 'mouse', button: 0, buttons: 1, clientX: startX, clientY: startY }));
  header.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 97, pointerType: 'mouse', button: 0, buttons: 1, clientX: startX + 100, clientY: startY + 60 }));
  header.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 97, pointerType: 'mouse', button: 0, buttons: 0, clientX: startX + 100, clientY: startY + 60 }));
  const after = panel.getBoundingClientRect();
  const result = {
    backdropFilter: getComputedStyle(layer).backdropFilter,
    webkitBackdropFilter: getComputedStyle(layer).webkitBackdropFilter,
    layerBackground: getComputedStyle(layer).backgroundColor,
    headerCursor: getComputedStyle(header).cursor,
    delta: [after.left - before.left, after.top - before.top],
    expectedDelta,
    insideViewport: after.left >= 12 && after.top >= 12 && after.right <= innerWidth - 12 && after.bottom <= innerHeight - 12
  };
  panel.style.removeProperty('transform');
  delete panel.__doubaoSettingsPanelOffset;
  delete panel.__doubaoSettingsPanelDrag;
  panel.classList.remove('is-dragging');
  return result;
})()`);
await evaluate("window.__doubaoThemeCloseSettings()");

await evaluate(String.raw`(() => {
  const main = document.querySelector('main[data-container-name="main"]') || document.querySelector('main');
  window.__doubaoQaMainStyle = main.getAttribute('style');
  const targetWidth = Math.max(420, main.getBoundingClientRect().width - 240);
  main.style.setProperty('width', targetWidth + 'px', 'important');
  main.style.setProperty('min-width', targetWidth + 'px', 'important');
  main.style.setProperty('max-width', targetWidth + 'px', 'important');
})()`);
await wait(50);
const narrowed = await snapshot();

await evaluate(String.raw`(() => {
  const main = document.querySelector('main[data-container-name="main"]') || document.querySelector('main');
  const original = window.__doubaoQaMainStyle;
  if (original === null) main.removeAttribute('style');
  else main.setAttribute('style', original);
  delete window.__doubaoQaMainStyle;
})()`);
await wait(50);
const restored = await snapshot();

await evaluate(String.raw`(() => {
  const sidebar = document.querySelector('#flow_chat_sidebar');
  window.__doubaoQaSidebarStyle = sidebar.getAttribute('style');
  sidebar.style.setProperty('display', 'none', 'important');
  window.dispatchEvent(new Event('resize'));
})()`);
await wait(50);
const withoutSidebar = await snapshot();
await evaluate(String.raw`(() => {
  const sidebar = document.querySelector('#flow_chat_sidebar');
  const original = window.__doubaoQaSidebarStyle;
  if (original === null) sidebar.removeAttribute('style');
  else sidebar.setAttribute('style', original);
  delete window.__doubaoQaSidebarStyle;
  window.dispatchEvent(new Event('resize'));
})()`);
await wait(50);

await mkdir(path.dirname(screenshotPath), { recursive: true });
const capture = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
await writeFile(screenshotPath, Buffer.from(capture.data, "base64"));
socket.close();

const near = (left, right, tolerance = 1) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const failures = [];
if (!initial.trigger || !initial.sidebar) failures.push("Style 按钮或侧栏不存在");
if (initial.triggerHidden || !near(initial.trigger?.left - initial.title?.right, 4) || !near(initial.trigger?.top + initial.trigger?.height / 2, initial.title?.top + initial.title?.height / 2)) failures.push("Style 入口未跟随侧栏标题右侧");
if (!withoutSidebar.triggerHidden) failures.push("侧栏收起后 Style 入口仍占用页面");
if (!panelOpened || !panelVisible) failures.push("Style 按钮对应的设置面板无法打开");
if (!panelInteraction || panelInteraction.backdropFilter !== "none" || !["none", undefined].includes(panelInteraction.webkitBackdropFilter)) failures.push("设置层仍在模糊下方内容");
if (panelInteraction?.layerBackground !== "rgba(0, 0, 0, 0)") failures.push("设置层仍在压暗下方内容");
if (!near(panelInteraction?.delta?.[0], panelInteraction?.expectedDelta?.[0]) || !near(panelInteraction?.delta?.[1], panelInteraction?.expectedDelta?.[1]) || !panelInteraction?.insideViewport || panelInteraction?.headerCursor !== "grab") failures.push("设置面板拖拽交互不正确");
if (!near(narrowed.gridWidth, narrowed.expectedGridWidth)) failures.push("主区域缩窄后未在 50ms 内同步内容边距");
if (!near(restored.gridWidth, restored.expectedGridWidth)) failures.push("主区域恢复后未在 50ms 内同步内容边距");
if (runtimeExceptions.length) failures.push("按钮或宽度同步期间出现运行时异常");

const result = { screenshotPath, initial, narrowed, restored, withoutSidebar, panelOpened, panelVisible, panelInteraction, runtimeExceptions, failures };
if (failures.length) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
