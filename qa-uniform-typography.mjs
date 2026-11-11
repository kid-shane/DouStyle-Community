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

await call("Page.enable");
await call("Runtime.enable");
const initialSettings = await evaluate("window.__doubaoThemeGetSettings?.()");
if (!initialSettings || typeof initialSettings.uniformChatTypography !== "boolean") {
  throw new Error("Uniform typography setting was not injected");
}

const snapshotExpression = String.raw`(() => {
  const markdown = Array.from(document.querySelectorAll('.md-box-root'))
    .find((root) => root.querySelector('h1, h2, h3, h4, h5, h6'));
  const heading = markdown?.querySelector('h1, h2, h3, h4, h5, h6');
  const body = markdown?.querySelector('p, li, blockquote');
  const hasDirectText = (element) => Array.from(element.childNodes)
    .some((node) => node.nodeType === Node.TEXT_NODE && (node.nodeValue || '').trim());
  const hasBlockChild = (element) => Boolean(element.querySelector(':scope > div, :scope > ul, :scope > ol, :scope > table, :scope > pre, :scope > blockquote, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6'));
  const textBlocks = Array.from(document.querySelectorAll('.md-box-root div'))
    .filter((element) => hasDirectText(element) && !hasBlockChild(element));
  const plainBlock = textBlocks.find((element) => !element.closest('li'));
  const nestedPlainBlock = textBlocks.find((element) => element.closest('li'));
  const textParents = (root) => {
    const elements = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const element = walker.currentNode.parentElement;
      if ((walker.currentNode.nodeValue || '').trim() && element && !elements.includes(element)) elements.push(element);
    }
    return elements;
  };
  const userMessageRoots = Array.from(document.querySelectorAll('[data-testid="send_message"] [class*="bg-g-send-msg-bubble-bg"]'));
  const userTextElements = Array.from(new Set(userMessageRoots.flatMap(textParents)));
  const userBlock = userTextElements.at(-1);
  const thinkingBlocks = Array.from(document.querySelectorAll('[data-testid="receive_message"] [class~="text-[14px]"][class~="leading-[28px]"]:is([class~="text-dbx-text-secondary"], [class~="text-dbx-text-primary"])'));
  const thinkingBlock = thinkingBlocks.at(-1);
  const describe = (element) => {
    if (!(element instanceof Element)) return null;
    const style = getComputedStyle(element);
    return {
      tag: element.tagName,
      text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
      fontSize: parseFloat(style.fontSize),
      lineHeight: parseFloat(style.lineHeight),
      fontWeight: Number(style.fontWeight)
    };
  };
  const summarize = (elements) => ({
    count: elements.length,
    fontSizes: Array.from(new Set(elements.map((element) => parseFloat(getComputedStyle(element).fontSize)))),
    lineHeights: Array.from(new Set(elements.map((element) => parseFloat(getComputedStyle(element).lineHeight)))),
    sample: describe(elements.at(-1))
  });
  const toggle = document.querySelector('#doubao-theme-toggle-uniformChatTypography');
  const row = toggle?.closest('.doubao-theme-toggle-row');
  return {
    settings: window.__doubaoThemeGetSettings?.(),
    rootState: document.documentElement.getAttribute('data-doubao-uniform-chat-typography'),
    heading: describe(heading),
    body: describe(body),
    plainBlock: describe(plainBlock),
    nestedPlainBlock: describe(nestedPlainBlock),
    userBlock: describe(userBlock),
    thinkingBlock: describe(thinkingBlock),
    userTextSummary: summarize(userTextElements),
    thinkingSummary: summarize(thinkingBlocks),
    control: {
      label: row?.querySelector('.doubao-theme-setting-label')?.textContent?.trim(),
      description: row?.querySelector('.doubao-theme-setting-description')?.textContent?.trim(),
      checked: toggle?.checked,
      role: toggle?.getAttribute('role')
    }
  };
})()`;

await evaluate("window.__doubaoThemeSetLayout('chatFontSize', 13)");
await evaluate("window.__doubaoThemeSetLayout('chatLineHeight', 1.65)");
await evaluate("window.__doubaoThemeSetToggle('uniformChatTypography', false)");
await evaluate(String.raw`(() => {
  window.__doubaoThemeOpenSettings();
  document.querySelector('.doubao-theme-settings-tab[data-tab="layout"]')?.click();
  return true;
})()`);
await wait(120);
const disabled = await evaluate(snapshotExpression);

const screenshotDirectory = path.join(projectDirectory, "qa", "uniform-typography");
await mkdir(screenshotDirectory, { recursive: true });
const panelCapture = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
const panelScreenshotPath = path.join(screenshotDirectory, "layout-switch.png");
await writeFile(panelScreenshotPath, Buffer.from(panelCapture.data, "base64"));

await evaluate("document.querySelector('#doubao-theme-toggle-uniformChatTypography')?.click()");
await evaluate("window.__doubaoThemeCloseSettings()");
await wait(120);
const enabled = await evaluate(snapshotExpression);
await evaluate(String.raw`(() => {
  const userMessages = Array.from(document.querySelectorAll('[data-testid="send_message"] [class*="bg-g-send-msg-bubble-bg"]'));
  const target = userMessages.at(-1);
  target?.scrollIntoView({ block: 'center' });
  return Boolean(target);
})()`);
await wait(180);
const userMessageCapture = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
const userMessageScreenshotPath = path.join(screenshotDirectory, "user-message-unified.png");
await writeFile(userMessageScreenshotPath, Buffer.from(userMessageCapture.data, "base64"));
await evaluate(String.raw`(() => {
  const exactSample = Array.from(document.querySelectorAll('.md-box-root div'))
    .find((element) => (element.textContent || '').includes('已在你新增的'));
  const thinkingBlock = document.querySelector('[data-testid="receive_message"] [class~="text-[14px]"][class~="leading-[28px]"]:is([class~="text-dbx-text-secondary"], [class~="text-dbx-text-primary"])');
  const heading = Array.from(document.querySelectorAll('.md-box-root h1, .md-box-root h2, .md-box-root h3, .md-box-root h4, .md-box-root h5, .md-box-root h6'))
    .find((element) => (element.textContent || '').trim());
  const target = thinkingBlock || exactSample || heading;
  target?.scrollIntoView({ block: thinkingBlock || exactSample ? 'start' : 'center' });
  return Boolean(target);
})()`);
await wait(180);
const contentCapture = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
const contentScreenshotPath = path.join(screenshotDirectory, "conversation-unified.png");
await writeFile(contentScreenshotPath, Buffer.from(contentCapture.data, "base64"));
const persisted = await evaluate("JSON.parse(localStorage.getItem('doubao-local-appearance-v1') || '{}').uniformChatTypography");

await evaluate(`(() => {
  window.__doubaoThemeSetLayout('chatFontSize', ${JSON.stringify(initialSettings.chatFontSize)});
  window.__doubaoThemeSetLayout('chatLineHeight', ${JSON.stringify(initialSettings.chatLineHeight)});
  window.__doubaoThemeSetToggle('uniformChatTypography', ${JSON.stringify(initialSettings.uniformChatTypography)});
  return true;
})()`);
await wait(80);
const restored = await evaluate(snapshotExpression);
socket.close();

const closeTo = (left, right, tolerance = 0.2) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const failures = [];
if (!disabled.heading || !disabled.body) failures.push("conversation does not contain a heading and body sample");
if (!disabled.userTextSummary.count || !disabled.thinkingSummary.count) failures.push("conversation does not contain user text and thinking label samples");
if (disabled.rootState !== "false" || disabled.control.checked) failures.push("disabled state did not reach the root or switch");
if (disabled.control.label !== "统一会话字号" || disabled.control.role !== "switch") failures.push("layout switch is missing or mislabeled");
if (closeTo(disabled.heading?.fontSize, 13)
  || closeTo(disabled.plainBlock?.fontSize, 13)
  || closeTo(disabled.nestedPlainBlock?.fontSize, 13)
  || disabled.userTextSummary.fontSizes.every((value) => closeTo(value, 13))
  || disabled.thinkingSummary.fontSizes.every((value) => closeTo(value, 13))) failures.push("native text sizes were unexpectedly flattened while disabled");
if (enabled.rootState !== "true" || !enabled.settings.uniformChatTypography) failures.push("enabled state did not reach the root or settings");
if (!closeTo(enabled.heading?.fontSize, 13)
  || !closeTo(enabled.body?.fontSize, 13)
  || !closeTo(enabled.plainBlock?.fontSize, 13)
  || (enabled.nestedPlainBlock && !closeTo(enabled.nestedPlainBlock.fontSize, 13))
  || enabled.userTextSummary.fontSizes.some((value) => !closeTo(value, 13))
  || enabled.thinkingSummary.fontSizes.some((value) => !closeTo(value, 13))) failures.push("conversation text surfaces did not share the configured font size");
if (!closeTo(enabled.heading?.lineHeight, 13 * 1.65)
  || !closeTo(enabled.body?.lineHeight, 13 * 1.65)
  || !closeTo(enabled.plainBlock?.lineHeight, 13 * 1.65)
  || (enabled.nestedPlainBlock && !closeTo(enabled.nestedPlainBlock.lineHeight, 13 * 1.65))
  || enabled.userTextSummary.lineHeights.some((value) => !closeTo(value, 13 * 1.65))
  || enabled.thinkingSummary.lineHeights.some((value) => !closeTo(value, 13 * 1.65))) failures.push("conversation text surfaces did not share the configured line height");
if ((enabled.heading?.fontWeight || 0) < 500) failures.push("heading emphasis was lost");
if (persisted !== true) failures.push("uniform typography was not written to local persistence");
if (restored.settings.chatFontSize !== initialSettings.chatFontSize
  || restored.settings.chatLineHeight !== initialSettings.chatLineHeight
  || restored.settings.uniformChatTypography !== initialSettings.uniformChatTypography) failures.push("QA did not restore the user's typography settings");
if (runtimeExceptions.length) failures.push("runtime exception occurred during typography QA");

const result = { disabled, enabled, persisted, restored, panelScreenshotPath, userMessageScreenshotPath, contentScreenshotPath, runtimeExceptions, failures };
if (failures.length) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
