import { isDoubaoChatURL } from "./doubao-target.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const tableConversationUrl = process.env.DOUBAO_QA_CHAT_URL;
if (!tableConversationUrl) throw new Error("Set DOUBAO_QA_CHAT_URL to an explicitly chosen table test conversation");
const port = process.env.DOUBAO_THEME_PORT || "9237";
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page" && isDoubaoChatURL(item.url) && /^\/chat\/\d+/.test(new URL(item.url).pathname));
if (!target) throw new Error("Doubao conversation page was not found");
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
const waitFor = async (expression, timeout = 15_000) => {
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
if (initialTargetUrl !== tableConversationUrl) {
  await call("Page.navigate", { url: tableConversationUrl });
  await wait(400);
}
await waitFor("typeof window.__doubaoThemeGetSettings === 'function' && Boolean(document.querySelector('.md-box-root table'))");
await evaluate("window.__doubaoThemeSetLayout('chatFontSize', 13) && window.__doubaoThemeSetLayout('chatLineHeight', 1.65) && window.__doubaoThemeSetToggle('uniformChatTypography', true)");
await wait(120);
const state = await evaluate(String.raw`(() => {
  const describe = (element) => {
    if (!(element instanceof Element)) return null;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      tag: element.tagName,
      text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
      className: typeof element.className === 'string' ? element.className : '',
      fontSize: parseFloat(style.fontSize),
      lineHeight: parseFloat(style.lineHeight),
      fontWeight: Number(style.fontWeight),
      rect: [rect.x, rect.y, rect.width, rect.height]
    };
  };
  const table = document.querySelector('.md-box-root table');
  const title = Array.from(document.querySelectorAll('body *')).find((element) =>
    element.children.length === 0 && (element.textContent || '').trim() === '表格'
  );
  const numbered = Array.from(document.querySelectorAll('.md-box-root strong')).filter((element) => /[①②]/.test(element.textContent || ''));
  return {
    settings: window.__doubaoThemeGetSettings(),
    table: describe(table),
    headerCell: describe(table?.querySelector('th')),
    bodyCell: describe(table?.querySelector('td')),
    title: describe(title),
    numbered: numbered.slice(0, 4).map(describe)
  };
})()`);
await evaluate("document.querySelector('.md-box-root table')?.scrollIntoView({ block: 'center' })");
await wait(160);
const screenshotDirectory = path.join(projectDirectory, "qa", "rich-typography");
await mkdir(screenshotDirectory, { recursive: true });
const capture = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
const screenshotPath = path.join(screenshotDirectory, "table-and-numbering.png");
await writeFile(screenshotPath, Buffer.from(capture.data, "base64"));
await evaluate(`(() => {
  window.__doubaoThemeSetLayout('chatFontSize', ${JSON.stringify(initialSettings.chatFontSize)});
  window.__doubaoThemeSetLayout('chatLineHeight', ${JSON.stringify(initialSettings.chatLineHeight)});
  window.__doubaoThemeSetToggle('uniformChatTypography', ${JSON.stringify(initialSettings.uniformChatTypography)});
  return true;
})()`);
if (initialTargetUrl !== tableConversationUrl) {
  await call("Page.navigate", { url: initialTargetUrl });
  await wait(400);
  await waitFor("typeof window.__doubaoThemeGetSettings === 'function'");
}
socket.close();

const failures = [];
const expectedLineHeight = 13 * 1.65;
for (const [name, item] of [["table", state.table], ["header cell", state.headerCell], ["body cell", state.bodyCell]]) {
  if (!item || Math.abs(item.fontSize - 13) > 0.2 || Math.abs(item.lineHeight - expectedLineHeight) > 0.2) failures.push(`${name} did not follow the configured body typography`);
}
if (!state.numbered.length) failures.push("circled-number emphasis sample was not found");
for (const item of state.numbered) {
  if (Math.abs(item.fontSize - 13) > 0.2 || Math.abs(item.lineHeight - expectedLineHeight) > 0.2 || item.fontWeight < 600) failures.push("circled-number emphasis did not preserve uniform size and emphasis");
}
if (runtimeExceptions.length) failures.push("runtime exception occurred during rich typography QA");

const result = { ...state, screenshotPath, runtimeExceptions, failures };
if (failures.length) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
