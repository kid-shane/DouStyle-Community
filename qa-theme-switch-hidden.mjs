import { isDoubaoChatURL } from "./doubao-target.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const screenshotPath = path.join(projectDirectory, "qa", "implementation-empty-hidden-linear-v10.png");
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
await waitFor("Boolean(window.__doubaoThemeGetSettings && document.querySelector('#flow_chat_sidebar'))");

if (!/\/chat\/?$/.test(await evaluate("location.pathname"))) {
  const opened = await evaluate(String.raw`(() => {
    const label = Array.from(document.querySelectorAll('*'))
      .find((element) => element.tagName === 'SPAN' && (element.textContent || '').trim() === '新工作任务');
    const item = label?.closest('[class*="group/sidebar_nav_item"]');
    item?.click();
    return Boolean(item);
  })()`);
  if (!opened) throw new Error("New work task control was not found");
}
await waitFor("/\\/chat\\/?$/.test(location.pathname) && Boolean(document.querySelector('#input-engine-container'))");

const initialSettings = await evaluate("window.__doubaoThemeGetSettings()");
const snapshotExpression = String.raw`(() => {
  const visible = (element) => {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const style = document.getElementById('doubao-local-theme');
  return {
    rootTheme: document.documentElement.getAttribute('data-doubao-theme'),
    settings: window.__doubaoThemeGetSettings?.(),
    styleHasHideRule: Boolean(style?.textContent.includes('doubao-office-logo')),
    logoVisible: visible(document.querySelector('#flow-chat-guidance-page img[src*="doubao-office-logo"]')),
    suggestionsVisible: visible(document.querySelector('#flow-chat-guidance-page #experiment-guidance-suggestions')),
    greetingVisible: visible(document.querySelector('#flow-chat-guidance-page [class*="greeting-text-"]')),
    observerActive: Boolean(window.__doubaoLinearThemeObserver),
    panelPresent: Boolean(document.getElementById('doubao-theme-settings-layer'))
  };
})()`;
const snapshot = () => evaluate(snapshotExpression);
const states = [];
for (const themeId of ["linear", "mira"]) {
  const changed = await evaluate(String.raw`(() => {
    const select = document.getElementById('doubao-theme-preset');
    if (!(select instanceof HTMLSelectElement)) return false;
    select.value = ${JSON.stringify(themeId)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`Theme ${themeId} could not be selected`);
  await wait(100);
  states.push(await snapshot());
  if (themeId === "linear") {
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    const capture = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await writeFile(screenshotPath, Buffer.from(capture.data, "base64"));
  }
}

await evaluate(String.raw`(() => {
  const select = document.getElementById('doubao-theme-preset');
  select.value = ${JSON.stringify(initialSettings.themeId)};
  select.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
for (const [key, value] of Object.entries(initialSettings.customColors || {})) {
  await evaluate(`window.__doubaoThemeSetColor(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
}
await wait(100);
const restored = await snapshot();
socket.close();

const failures = [];
for (const [index, state] of states.entries()) {
  const expectedTheme = ["linear", "mira"][index];
  if (state.rootTheme !== expectedTheme || state.settings?.themeId !== expectedTheme) failures.push(`${expectedTheme} 切换后主题状态不一致`);
  if (!state.styleHasHideRule) failures.push(`${expectedTheme} 切换后隐藏规则被旧样式覆盖`);
  if (state.logoVisible || state.suggestionsVisible) failures.push(`${expectedTheme} 切换后隐藏项重新出现`);
  if (!state.greetingVisible) failures.push(`${expectedTheme} 切换后主标题消失`);
  if (!state.observerActive || !state.panelPresent) failures.push(`${expectedTheme} 切换后外观运行时不完整`);
}
if (JSON.stringify(restored.settings) !== JSON.stringify(initialSettings)) failures.push("QA 未恢复用户 Style 设置");
if (restored.rootTheme !== initialSettings.themeId) failures.push("QA 恢复后根 Style 状态不一致");
if (restored.logoVisible || restored.suggestionsVisible || !restored.styleHasHideRule) failures.push("恢复用户 Style 后隐藏项重新出现");
if (runtimeExceptions.length) failures.push("Style 切换期间出现运行时异常");

const result = { screenshotPath, initialSettings, states, restored, runtimeExceptions, failures };
if (failures.length) {
  console.error(JSON.stringify({ failures, runtimeExceptions }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ screenshotPath, states, runtimeExceptions, failures }, null, 2));
