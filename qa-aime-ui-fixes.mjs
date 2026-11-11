import { isDoubaoChatURL } from "./doubao-target.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
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
await call("Page.reload");
await wait(450);
await waitFor("typeof window.__doubaoThemeSetTheme === 'function'");
if (!await evaluate("window.__doubaoThemeSetTheme('aime')")) throw new Error("Could not select Aime");
await wait(180);

const toolbarSelector = '.md-box-root [class~="bg-s-color-bg-quaternary"][class~="absolute"][class~="h-36"][class*="tabbar-"]';
await waitFor(`Boolean(document.querySelector(${JSON.stringify(toolbarSelector)}))`);
await evaluate(`(() => {
  const element = document.querySelector(${JSON.stringify(toolbarSelector)});
  let host = element?.parentElement;
  while (host && (!host.getBoundingClientRect().width || !host.getBoundingClientRect().height)) host = host.parentElement;
  host?.scrollIntoView({ block: 'center' });
  return true;
})()`);
await wait(180);
const toolbarHoverPoint = await evaluate(`(() => {
  const element = document.querySelector(${JSON.stringify(toolbarSelector)});
  let host = element?.parentElement;
  while (host && (!host.getBoundingClientRect().width || !host.getBoundingClientRect().height)) host = host.parentElement;
  const rect = host?.getBoundingClientRect();
  return rect ? { x: rect.left + (rect.width / 2), y: Math.min(innerHeight - 1, rect.bottom - 12) } : null;
})()`);
if (toolbarHoverPoint) {
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: toolbarHoverPoint.x, y: toolbarHoverPoint.y });
  await wait(180);
}
const toolbar = await evaluate(`(() => {
  const elements = Array.from(document.querySelectorAll(${JSON.stringify(toolbarSelector)}));
  const element = elements.find((candidate) => candidate.getBoundingClientRect().width > 0) || elements[0];
  const style = getComputedStyle(element);
  const rootStyle = getComputedStyle(document.documentElement);
  const rect = element.getBoundingClientRect();
  const probe = document.createElement('div');
  probe.style.backgroundColor = rootStyle.getPropertyValue('--db-theme-surface-elevated');
  document.body.appendChild(probe);
  const expectedBackground = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return {
    background: style.backgroundColor,
    expectedBackground,
    color: style.color,
    border: style.borderColor,
    rect: { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height },
    viewport: { width: innerWidth, height: innerHeight }
  };
})()`);

await evaluate(`(() => {
  window.__doubaoThemeOpenSettings();
  document.querySelector('.doubao-theme-settings-tab[data-tab="colors"]')?.click();
  document.querySelector('.doubao-theme-preset-button')?.click();
  return true;
})()`);
await waitFor("document.querySelector('.doubao-theme-preset-button')?.getAttribute('aria-expanded') === 'true'");
await wait(120);
const menu = await evaluate(`(() => {
  const button = document.querySelector('.doubao-theme-preset-button');
  const popup = document.querySelector('.doubao-theme-preset-menu');
  const buttonRect = button.getBoundingClientRect();
  const menuRect = popup.getBoundingClientRect();
  return {
    buttonRect: { left: buttonRect.left, right: buttonRect.right, top: buttonRect.top, bottom: buttonRect.bottom, width: buttonRect.width },
    menuRect: { left: menuRect.left, right: menuRect.right, top: menuRect.top, bottom: menuRect.bottom, width: menuRect.width },
    order: Array.from(popup.querySelectorAll('.doubao-theme-preset-option')).map((option) => option.textContent.trim()),
    selected: popup.querySelector('.doubao-theme-preset-option[aria-selected="true"]')?.textContent.trim(),
    visible: !popup.hidden && getComputedStyle(popup).display !== 'none'
  };
})()`);

const screenshotDirectory = path.join(projectDirectory, "qa");
await mkdir(screenshotDirectory, { recursive: true });
const menuCapture = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
const menuScreenshotPath = path.join(screenshotDirectory, "implementation-style-menu-position-v2.png");
await writeFile(menuScreenshotPath, Buffer.from(menuCapture.data, "base64"));

const keyboard = await evaluate(`(() => {
  const menu = document.querySelector('.doubao-theme-preset-menu');
  menu.querySelector('.doubao-theme-preset-option[aria-selected="true"]')?.focus();
  const before = document.activeElement?.textContent?.trim();
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  const afterArrow = document.activeElement?.textContent?.trim();
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return {
    before,
    afterArrow,
    closed: menu.hidden,
    focusReturned: document.activeElement?.classList.contains('doubao-theme-preset-button') || false,
    activeTag: document.activeElement?.tagName || null,
    activeClass: typeof document.activeElement?.className === 'string' ? document.activeElement.className : '',
    layerHidden: document.querySelector('#doubao-theme-settings-layer')?.hidden
  };
})()`);
await evaluate("window.__doubaoThemeCloseSettings()");
await wait(100);
if (toolbarHoverPoint) {
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: toolbarHoverPoint.x + 1, y: toolbarHoverPoint.y });
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: toolbarHoverPoint.x, y: toolbarHoverPoint.y });
  await wait(180);
}

const toolbarClip = {
  x: Math.max(0, toolbar.rect.x - 56),
  y: Math.max(0, toolbar.rect.y - 56),
  width: Math.min(toolbar.viewport.width, toolbar.rect.width + 112),
  height: Math.min(toolbar.viewport.height, toolbar.rect.height + 112),
  scale: 1
};
const toolbarCapture = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: true, clip: toolbarClip });
const toolbarScreenshotPath = path.join(screenshotDirectory, "implementation-light-preview-toolbar-v1.png");
await writeFile(toolbarScreenshotPath, Buffer.from(toolbarCapture.data, "base64"));

const failures = [];
const expectedOrder = ["豆包默认-浅色", "豆包默认-深色", "Trae", "Mira", "Aime", "Claude", "Linear"];
if (toolbar.background !== toolbar.expectedBackground) failures.push("浅色主题预览工具条未使用主题表面色");
if (!menu.visible || menu.menuRect.top < menu.buttonRect.bottom + 4 || menu.menuRect.top > menu.buttonRect.bottom + 10) failures.push("Style 菜单未紧贴选择框下方展开");
if (Math.abs(menu.menuRect.left - menu.buttonRect.left) > 1 || Math.abs(menu.menuRect.width - menu.buttonRect.width) > 1) failures.push("Style 菜单未与选择框对齐");
if (JSON.stringify(menu.order) !== JSON.stringify(expectedOrder) || menu.order.at(-1) !== "Linear") failures.push("Style 顺序不正确");
if (menu.selected !== "Aime") failures.push("Aime 选中态不正确");
if (keyboard.before !== "Aime" || keyboard.afterArrow !== "Claude" || !keyboard.closed || !keyboard.focusReturned) failures.push("Style 菜单键盘交互不正确");
if (runtimeExceptions.length) failures.push("验收过程中出现运行时异常");

await evaluate(`(() => {
  window.__doubaoThemeOpenSettings();
  document.querySelector('.doubao-theme-settings-tab[data-tab="colors"]')?.click();
  document.querySelector('.doubao-theme-preset-button')?.click();
  return true;
})()`);
socket.close();

const result = { toolbar, menu, keyboard, menuScreenshotPath, toolbarScreenshotPath, runtimeExceptions, failures };
if (failures.length) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
