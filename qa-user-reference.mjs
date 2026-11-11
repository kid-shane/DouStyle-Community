import { isDoubaoChatURL } from "./doubao-target.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const referenceConversationUrl = process.env.DOUBAO_QA_CHAT_URL;
if (!referenceConversationUrl) throw new Error("Set DOUBAO_QA_CHAT_URL to an explicitly chosen reference test conversation");
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
if (initialTargetUrl !== referenceConversationUrl) {
  await call("Page.navigate", { url: referenceConversationUrl });
  await wait(400);
}
await waitFor("typeof window.__doubaoThemeGetSettings === 'function' && Boolean(document.querySelector('[class*=\"bg-g-send-msg-bubble-bg\"] [data-testid=\"ref-content-wrapper\"]'))");
const result = await evaluate(String.raw`(() => {
  const parseRgb = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const luminance = (rgb) => {
    const channels = rgb.map((value) => {
      const normalized = value / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
  };
  const contrast = (left, right) => {
    const high = Math.max(luminance(left), luminance(right));
    const low = Math.min(luminance(left), luminance(right));
    return (high + 0.05) / (low + 0.05);
  };
  const blend = (foreground, background, opacity) => foreground.map((value, index) =>
    Math.round((value * opacity) + (background[index] * (1 - opacity)))
  );
  const references = Array.from(document.querySelectorAll('[class*="bg-g-send-msg-bubble-bg"] [data-testid="ref-content-wrapper"]'));
  return {
    settings: window.__doubaoThemeGetSettings?.(),
    theme: document.documentElement.getAttribute('data-doubao-theme'),
    references: references.map((wrapper) => {
      const bubble = wrapper.closest('[class*="bg-g-send-msg-bubble-bg"]');
      const content = wrapper.querySelector('[data-testid="ref-content"]');
      const text = content?.querySelector('span') || content;
      const line = wrapper.querySelector(':scope > [class*="bg-g-send-msg-ref-content-line-bg"]');
      const message = bubble?.querySelector('[data-testid="message_text_content"]');
      const textStyle = text ? getComputedStyle(text) : null;
      const contentStyle = content ? getComputedStyle(content) : null;
      const lineStyle = line ? getComputedStyle(line) : null;
      const messageStyle = message ? getComputedStyle(message) : null;
      const bubbleStyle = bubble ? getComputedStyle(bubble) : null;
      const textRgb = parseRgb(textStyle?.color || '');
      const bubbleRgb = parseRgb(bubbleStyle?.backgroundColor || '');
      const opacity = parseFloat(contentStyle?.opacity || '1');
      const effectiveTextRgb = textRgb.length === 3 && bubbleRgb.length === 3 ? blend(textRgb, bubbleRgb, opacity) : [];
      return {
        text: (content?.textContent || '').trim().replace(/\s+/g, ' '),
        color: textStyle?.color,
        messageColor: messageStyle?.color,
        opacity,
        fontSize: parseFloat(textStyle?.fontSize || ''),
        lineHeight: parseFloat(textStyle?.lineHeight || ''),
        lineBackground: lineStyle?.backgroundColor,
        lineOpacity: parseFloat(lineStyle?.opacity || '1'),
        bubbleBackground: bubbleStyle?.backgroundColor,
        effectiveContrast: effectiveTextRgb.length === 3 ? contrast(effectiveTextRgb, bubbleRgb) : 0
      };
    })
  };
})()`);

const failures = [];
const expectedFontSize = Number(result.settings?.chatFontSize);
const expectedLineHeight = expectedFontSize * Number(result.settings?.chatLineHeight);
if (!result.references.length) failures.push("conversation does not contain a user-message reference sample");
for (const reference of result.references) {
  if (!reference.text) failures.push("reference text is empty");
  if (reference.color !== reference.messageColor) failures.push("reference text did not inherit the user-message text color");
  if (result.settings?.uniformChatTypography && Math.abs(reference.fontSize - expectedFontSize) > 0.2) failures.push("reference text did not inherit the configured font size");
  if (result.settings?.uniformChatTypography && Math.abs(reference.lineHeight - expectedLineHeight) > 0.2) failures.push("reference text did not inherit the configured line height");
  if (!reference.lineBackground || reference.lineBackground === "rgba(0, 0, 0, 0)") failures.push("reference line is transparent");
  if (reference.effectiveContrast < 4.5) failures.push("reference text contrast is too low");
}
if (runtimeExceptions.length) failures.push("runtime exception occurred during user-reference QA");

await evaluate(String.raw`(() => {
  const reference = Array.from(document.querySelectorAll('[class*="bg-g-send-msg-bubble-bg"] [data-testid="ref-content-wrapper"]')).at(-1);
  reference?.closest('[class*="bg-g-send-msg-bubble-bg"]')?.scrollIntoView({ block: 'center' });
  return Boolean(reference);
})()`);
const screenshotDirectory = path.join(projectDirectory, "qa", "user-reference");
await mkdir(screenshotDirectory, { recursive: true });
const screenshot = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
const screenshotPath = path.join(screenshotDirectory, "reference-visible.png");
await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
if (initialTargetUrl !== referenceConversationUrl) {
  await call("Page.navigate", { url: initialTargetUrl });
  await wait(400);
  await waitFor("typeof window.__doubaoThemeGetSettings === 'function'");
}
socket.close();

console.log(JSON.stringify({ ...result, screenshotPath, runtimeExceptions, failures }, null, 2));
if (failures.length) process.exit(1);
