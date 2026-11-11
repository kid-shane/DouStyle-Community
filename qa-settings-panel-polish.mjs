import { isDoubaoChatURL } from "./doubao-target.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
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
const initial = await evaluate("window.__doubaoThemeGetSettings()");
await evaluate("window.__doubaoThemeSetToggle('showConversationIcons', false)");
const layout = await evaluate(String.raw`(() => {
  window.__doubaoThemeOpenSettings();
  document.querySelector('.doubao-theme-settings-tab[data-tab="layout"]')?.click();
  const toggle = document.querySelector('#doubao-theme-toggle-showConversationIcons');
  const row = toggle?.closest('.doubao-theme-toggle-row');
  const close = document.querySelector('.doubao-theme-settings-close');
  const tabs = Array.from(document.querySelectorAll('.doubao-theme-settings-tab'));
  return {
    label: row?.querySelector('.doubao-theme-setting-label')?.textContent?.trim(),
    description: row?.querySelector('.doubao-theme-setting-description')?.textContent?.trim(),
    checked: toggle?.checked,
    rootState: document.documentElement.getAttribute('data-doubao-chat-icons'),
    hasLegacyOutput: Boolean(row?.querySelector('.doubao-theme-toggle-output')),
    close: {
      text: close?.textContent?.trim(),
      label: close?.getAttribute('aria-label'),
      hasIcon: Boolean(close?.querySelector('svg'))
    },
    footer: {
      note: document.querySelector('.doubao-theme-settings-footer-note')?.textContent?.trim(),
      hasDone: Boolean(document.querySelector('.doubao-theme-settings-done')),
      resetHasIcon: Boolean(document.querySelector('.doubao-theme-settings-reset svg'))
    },
    tabs: tabs.map((tab) => ({ id: tab.dataset.tab, selected: tab.getAttribute('aria-selected'), tabIndex: tab.tabIndex })),
    zoom: {
      min: document.querySelector('#doubao-theme-welcome-zoom-value') ? 0 : null,
      max: 300
    }
  };
})()`);

const keyboard = await evaluate(String.raw`(() => {
  const layoutTab = document.querySelector('.doubao-theme-settings-tab[data-tab="layout"]');
  layoutTab.focus();
  layoutTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  const result = {
    activeTab: document.querySelector('.doubao-theme-settings-tab[aria-selected="true"]')?.dataset.tab,
    focusedTab: document.activeElement?.dataset?.tab
  };
  document.querySelector('.doubao-theme-settings-tab[data-tab="layout"]')?.click();
  return result;
})()`);

const toggledVisible = await evaluate(String.raw`(() => {
  const toggle = document.querySelector('#doubao-theme-toggle-showConversationIcons');
  toggle.click();
  return {
    checked: toggle.checked,
    stored: window.__doubaoThemeGetSettings().showConversationIcons,
    rootState: document.documentElement.getAttribute('data-doubao-chat-icons')
  };
})()`);

try {
  await call("Page.reload", { ignoreCache: true });
} catch (error) {
  if (!String(error?.message || error).includes("Inspected target navigated or closed")) throw error;
}
await wait(350);
await waitFor("typeof window.__doubaoThemeGetSettings === 'function'");
const afterReloadVisible = await evaluate(String.raw`(() => {
  window.__doubaoThemeOpenSettings();
  document.querySelector('.doubao-theme-settings-tab[data-tab="layout"]')?.click();
  return {
    checked: document.querySelector('#doubao-theme-toggle-showConversationIcons')?.checked,
    stored: window.__doubaoThemeGetSettings().showConversationIcons,
    rootState: document.documentElement.getAttribute('data-doubao-chat-icons')
  };
})()`);
const restoredHidden = await evaluate(String.raw`(() => {
  document.querySelector('#doubao-theme-toggle-showConversationIcons')?.click();
  return {
    checked: document.querySelector('#doubao-theme-toggle-showConversationIcons')?.checked,
    stored: window.__doubaoThemeGetSettings().showConversationIcons,
    rootState: document.documentElement.getAttribute('data-doubao-chat-icons'),
    persisted: JSON.parse(localStorage.getItem('doubao-local-appearance-v1') || '{}').showConversationIcons
  };
})()`);

await evaluate("window.__doubaoThemeSetTheme('linear')");
await evaluate(String.raw`(() => {
  window.__doubaoThemeOpenSettings();
  document.querySelector('.doubao-theme-settings-tab[data-tab="colors"]')?.click();
  return true;
})()`);
await wait(180);
const darkPanel = await evaluate(String.raw`(() => {
  const panel = document.querySelector('.doubao-theme-settings-panel');
  const close = document.querySelector('.doubao-theme-settings-close');
  return {
    theme: document.documentElement.getAttribute('data-doubao-theme'),
    background: getComputedStyle(panel).backgroundColor,
    color: getComputedStyle(panel).color,
    closeColor: getComputedStyle(close).color
  };
})()`);
const screenshotDirectory = path.join(projectDirectory, "qa", "settings-panel-audit");
await mkdir(screenshotDirectory, { recursive: true });
const darkCapture = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
const darkScreenshotPath = path.join(screenshotDirectory, "after-04-linear-dark.png");
await writeFile(darkScreenshotPath, Buffer.from(darkCapture.data, "base64"));

await evaluate(`(() => {
  window.__doubaoThemeSetTheme(${JSON.stringify(initial.themeId)});
  const customColors = ${JSON.stringify(initial.customColors || {})};
  for (const [key, value] of Object.entries(customColors)) window.__doubaoThemeSetColor(key, value);
  window.__doubaoThemeSetToggle('showConversationIcons', false);
  window.__doubaoThemeOpenSettings();
  document.querySelector('.doubao-theme-settings-tab[data-tab="layout"]')?.click();
  return true;
})()`);
const closeInteraction = await evaluate(String.raw`(() => {
  const close = document.querySelector('.doubao-theme-settings-close');
  close.click();
  const closed = document.querySelector('#doubao-theme-settings-layer')?.hidden;
  window.__doubaoThemeOpenSettings();
  document.querySelector('.doubao-theme-settings-tab[data-tab="layout"]')?.click();
  return { closed, reopened: !document.querySelector('#doubao-theme-settings-layer')?.hidden };
})()`);
await call("Emulation.setDeviceMetricsOverride", { width: 620, height: 860, deviceScaleFactor: 1, mobile: false });
await wait(160);
const responsive = await evaluate(String.raw`(() => {
  const panel = document.querySelector('.doubao-theme-settings-panel');
  const layer = document.querySelector('#doubao-theme-settings-layer');
  const rect = panel?.getBoundingClientRect();
  return {
    viewport: [innerWidth, innerHeight],
    panel: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null,
    horizontalOverflow: panel ? panel.scrollWidth > panel.clientWidth : true,
    layerHorizontalOverflow: layer ? layer.scrollWidth > layer.clientWidth : true
  };
})()`);
const responsiveCapture = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
const responsiveScreenshotPath = path.join(screenshotDirectory, "after-05-responsive-620.png");
await writeFile(responsiveScreenshotPath, Buffer.from(responsiveCapture.data, "base64"));
await call("Emulation.clearDeviceMetricsOverride");
const finalSettings = await evaluate("window.__doubaoThemeGetSettings()");
socket.close();

const failures = [];
if (layout.label !== "隐藏任务图标" || layout.description !== "隐藏置顶与最近任务前的来源图标") failures.push("开关文案未更新");
if (!layout.checked || layout.rootState !== "hidden" || layout.hasLegacyOutput) failures.push("隐藏任务图标的默认开启态不正确");
if (layout.close.text || layout.close.label !== "关闭 Style 设置" || !layout.close.hasIcon) failures.push("关闭按钮未改为可访问的图标按钮");
if (layout.footer.note !== "更改已自动保存" || layout.footer.hasDone || !layout.footer.resetHasIcon) failures.push("底部操作区未完成简化");
if (keyboard.activeTab !== "welcome" || keyboard.focusedTab !== "welcome") failures.push("页签键盘导航不正确");
if (toggledVisible.checked || !toggledVisible.stored || toggledVisible.rootState !== "visible") failures.push("关闭隐藏开关后未显示任务图标");
if (afterReloadVisible.checked || !afterReloadVisible.stored || afterReloadVisible.rootState !== "visible") failures.push("显示任务图标状态未持久化");
if (!restoredHidden.checked || restoredHidden.stored || restoredHidden.persisted || restoredHidden.rootState !== "hidden") failures.push("重新开启隐藏后状态不正确");
if (darkPanel.theme !== "linear" || !darkPanel.background || !darkPanel.color || !darkPanel.closeColor) failures.push("深色 Style 面板未正常渲染");
if (!closeInteraction.closed || !closeInteraction.reopened) failures.push("图标关闭交互不正确");
if (!responsive.panel || responsive.panel.left < 0 || responsive.panel.right > responsive.viewport[0] || responsive.horizontalOverflow || responsive.layerHorizontalOverflow) failures.push("窄屏下设置面板出现溢出");
if (finalSettings.themeId !== initial.themeId || finalSettings.showConversationIcons) failures.push("验收后未恢复原 Style 或默认隐藏状态");
if (runtimeExceptions.length) failures.push("验收过程中出现运行时异常");

const result = {
  layout,
  keyboard,
  toggledVisible,
  afterReloadVisible,
  restoredHidden,
  darkPanel,
  darkScreenshotPath,
  closeInteraction,
  responsive,
  responsiveScreenshotPath,
  runtimeExceptions,
  failures
};
if (failures.length) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
