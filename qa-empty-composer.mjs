import { isDoubaoChatURL } from "./doubao-target.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const screenshotPath = path.join(projectDirectory, "qa", "implementation-empty-clean-v9.png");
const port = process.env.DOUBAO_THEME_PORT || "9237";
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page" && isDoubaoChatURL(item.url));
if (!target) throw new Error("Doubao chat page was not found");

const initialTargetUrl = target.url;
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
    try {
      if (await evaluate(expression)) return;
    } catch (error) {
      if (!String(error?.message || error).includes("Inspected target navigated or closed")) throw error;
    }
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${expression}`);
};

await call("Page.enable");
await call("Runtime.enable");
await waitFor("Boolean(window.__doubaoThemeGetSettings && document.querySelector('#flow_chat_sidebar'))");
const initialSettings = await evaluate("window.__doubaoThemeGetSettings()");

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
await wait(100);

const snapshotExpression = String.raw`(() => {
  const box = (element) => {
    if (!(element instanceof Element)) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      maxWidth: style.maxWidth,
      marginLeft: style.marginLeft,
      marginRight: style.marginRight
    };
  };
  const visibility = (element) => {
    if (!(element instanceof Element)) return { exists: false, visible: false };
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      exists: true,
      visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
      display: style.display,
      width: rect.width,
      height: rect.height
    };
  };
  const composer = document.querySelector('#input-engine-container');
  const composerGrid = composer?.closest('[class*="max-w-(--content-max-width)"]');
  const main = document.querySelector('main[data-container-name="main"]') || document.querySelector('main');
  const logo = document.querySelector('#flow-chat-guidance-page img[src*="doubao-office-logo"]');
  const suggestions = document.querySelector('#flow-chat-guidance-page #experiment-guidance-suggestions');
  const greeting = Array.from(document.querySelectorAll('#flow-chat-guidance-page *'))
    .find((element) => (element.textContent || '').trim() === '今天有什么工作要处理？' && element.children.length === 0);
  return {
    url: location.href,
    settings: window.__doubaoThemeGetSettings?.(),
    main: box(main),
    composer: box(composer),
    composerGrid: box(composerGrid),
    logo: visibility(logo),
    suggestions: visibility(suggestions),
    greeting: visibility(greeting),
    greetingGroup: box(greeting?.parentElement),
    guidanceViewport: box(greeting?.parentElement?.parentElement),
    gridWidth: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--db-layout-content-grid-width')),
    messageCount: document.querySelectorAll('[data-testid="union_message"]').length
  };
})()`;
const snapshot = () => evaluate(snapshotExpression);
const emptyState = await snapshot();

await mkdir(path.dirname(screenshotPath), { recursive: true });
const capture = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
await writeFile(screenshotPath, Buffer.from(capture.data, "base64"));

if (/\/chat\/\d+/.test(initialTargetUrl)) {
  try {
    await call("Page.navigate", { url: initialTargetUrl });
    await waitFor("/\\/chat\\/\\d+/.test(location.pathname) && Boolean(document.querySelector('#input-engine-container'))");
  } catch (error) {
    if (!String(error?.message || error).includes("Inspected target navigated or closed")) throw error;
  }
}
const restoredSettings = await evaluate("window.__doubaoThemeGetSettings()");
socket.close();

const near = (left, right, tolerance = 1) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const failures = [];
if (!emptyState.main || !emptyState.composer || !emptyState.composerGrid) failures.push("空会话缺少输入框网格");
if (!near(emptyState.composerGrid?.width, emptyState.gridWidth)) failures.push("空会话输入框未使用两侧边距宽度");
if (!near(emptyState.composer?.width, emptyState.composerGrid?.width)) failures.push("空会话输入框与网格宽度不一致");
const expectedLeft = emptyState.main ? emptyState.main.left + ((emptyState.main.width - emptyState.gridWidth) / 2) : NaN;
if (!near(emptyState.composerGrid?.left, expectedLeft)) failures.push("空会话输入框未在主区域居中");
if (emptyState.messageCount !== 0) failures.push("检查时已存在消息，不是默认空会话状态");
if (!emptyState.logo.exists || emptyState.logo.visible) failures.push("空会话豆包 Logo 未默认隐藏");
if (!emptyState.suggestions.exists || emptyState.suggestions.visible) failures.push("空会话推荐入口未默认隐藏");
if (!emptyState.greeting.exists || !emptyState.greeting.visible) failures.push("空会话标题被意外隐藏");
const greetingCenter = emptyState.greetingGroup ? emptyState.greetingGroup.left + (emptyState.greetingGroup.width / 2) : NaN;
const guidanceCenter = emptyState.guidanceViewport ? emptyState.guidanceViewport.left + (emptyState.guidanceViewport.width / 2) : NaN;
if (!near(greetingCenter, guidanceCenter)) failures.push("空会话标题未保持水平居中");
const greetingMiddle = emptyState.greetingGroup ? emptyState.greetingGroup.top + (emptyState.greetingGroup.height / 2) : NaN;
const guidanceMiddle = emptyState.guidanceViewport ? emptyState.guidanceViewport.top + (emptyState.guidanceViewport.height / 2) : NaN;
if (!near(greetingMiddle, guidanceMiddle)) failures.push("隐藏空会话组件后标题未保持垂直居中");
if (JSON.stringify(restoredSettings) !== JSON.stringify(initialSettings)) failures.push("QA 未保持用户设置");
if (runtimeExceptions.length) failures.push("空会话布局检查期间出现运行时异常");

const result = { screenshotPath, initialTargetUrl, initialSettings, emptyState, restoredSettings, runtimeExceptions, failures };
if (failures.length) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
