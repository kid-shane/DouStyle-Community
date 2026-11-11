import { isDoubaoChatURL } from "./doubao-target.mjs";
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

await call("Runtime.enable");
const initialSettings = await evaluate("window.__doubaoThemeGetSettings?.()");
if (!initialSettings) throw new Error("Appearance settings API was not found");

const snapshotExpression = String.raw`(() => {
  const visible = (element) => {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const box = (element) => {
    if (!(element instanceof Element)) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      right: rect.right,
      width: rect.width,
      fontSize: getComputedStyle(element).fontSize,
      text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80)
    };
  };
  const textLeaf = (root) => root
    ? Array.from(root.querySelectorAll("*")).find((element) => visible(element) && element.children.length === 0 && (element.textContent || "").trim())
    : null;
  const nav = Array.from(document.querySelectorAll('#flow_chat_sidebar [class*="group/sidebar_nav_item"]'))
    .filter(visible)
    .map((element) => textLeaf(element))
    .filter(Boolean)
    .slice(0, 7)
    .map(box);
  const navIconColors = Array.from(document.querySelectorAll('#flow_chat_sidebar [class*="group/sidebar_nav_item"] > svg:first-child'))
    .filter(visible)
    .slice(0, 7)
    .map((element) => getComputedStyle(element).color);
  const themeAccentProbe = document.createElement('span');
  themeAccentProbe.style.color = 'var(--db-theme-accent)';
  document.body.appendChild(themeAccentProbe);
  const themeAccentColor = getComputedStyle(themeAccentProbe).color;
  themeAccentProbe.remove();
  const conversation = textLeaf(Array.from(document.querySelectorAll('[data-testid="conversation-list-v2-item"]')).find(visible));
  const project = textLeaf(Array.from(document.querySelectorAll('section[data-project-id] [class*="group/project-row"]')).find(visible));
  const assistant = Array.from(document.querySelectorAll('[data-testid="receive_message"]')).find(visible);
  const messageGrid = assistant?.closest('[class*="max-w-(--content-max-width)"]')
    || Array.from(document.querySelectorAll('[class*="max-w-(--content-max-width)"]'))
      .find((element) => visible(element) && element.querySelector(':scope > [data-testid="union_message"]'));
  const userBubble = Array.from(document.querySelectorAll('[class*="bg-g-send-msg-bubble-bg"]')).find(visible);
  const composer = document.querySelector('#input-engine-container');
  const composerGrid = composer?.parentElement?.parentElement;
  const main = document.querySelector('main[data-container-name="main"]') || document.querySelector("main");
  return {
    settings: window.__doubaoThemeGetSettings?.(),
    rootGridWidth: getComputedStyle(document.documentElement).getPropertyValue('--db-layout-content-grid-width').trim(),
    nav,
    navIconColors,
    themeAccentColor,
    conversation: box(conversation),
    project: box(project),
    main: box(main),
    messageGrid: box(messageGrid),
    assistant: box(assistant),
    userBubble: box(userBubble),
    composer: box(composer),
    composerGrid: box(composerGrid)
  };
})()`;
const snapshot = () => evaluate(snapshotExpression);

const initial = await snapshot();
await evaluate(`window.__doubaoThemeSetLayout('uiFontSize', 18) &&
  window.__doubaoThemeSetLayout('contentGutter', 24)`);
await wait(100);
const largeAndTight = await snapshot();

await evaluate("window.__doubaoThemeSetLayout('contentGutter', 360)");
await wait(100);
const largeAndWide = await snapshot();

for (const key of ["uiFontSize", "chatFontSize", "chatLineHeight", "contentGutter"]) {
  await evaluate(`window.__doubaoThemeSetLayout(${JSON.stringify(key)}, ${JSON.stringify(initialSettings[key])})`);
}
await wait(100);
const restored = await snapshot();
socket.close();

const failures = [];
const near = (left, right, tolerance = 1) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const fontIs = (item, size) => item?.fontSize === `${size}px`;
if (!initial.nav.length || initial.nav.some((item) => !fontIs(item, initialSettings.uiFontSize))) failures.push("initial navigation labels do not follow UI font size");
if (!fontIs(initial.conversation, initialSettings.uiFontSize)) failures.push("initial conversation labels do not follow UI font size");
if (initial.project && !fontIs(initial.project, initialSettings.uiFontSize)) failures.push("initial mounted project labels do not follow UI font size");
if (initial.navIconColors.length !== 7 || initial.navIconColors.some((color) => color !== initial.themeAccentColor)) failures.push("sidebar navigation icons do not share the theme accent color");
if (largeAndTight.nav.some((item) => !fontIs(item, 18)) || !fontIs(largeAndTight.conversation, 18) || (largeAndTight.project && !fontIs(largeAndTight.project, 18))) failures.push("mounted sidebar labels did not react to UI font size 18");
for (const state of [initial, largeAndTight, largeAndWide, restored]) {
  if (!near(state.messageGrid?.width, state.composerGrid?.width)) failures.push("message and composer grids do not share a width");
  if (!near(state.messageGrid?.x, state.composerGrid?.x)) failures.push("message and composer grids do not share a left edge");
  if (!near(state.assistant?.x, state.composer?.x)) failures.push("assistant reply and composer do not share a left edge");
  if (!near(state.userBubble?.right, state.composer?.right)) failures.push("user bubble and composer do not share a right edge");
}
const expectedGridWidth = (mainWidth, gutter) => Math.max(Math.min(320, mainWidth), mainWidth - (2 * gutter));
const expectedTightWidth = expectedGridWidth(largeAndTight.main?.width, 24);
const expectedWideWidth = expectedGridWidth(largeAndWide.main?.width, 360);
if (!near(largeAndTight.messageGrid?.width, expectedTightWidth)) failures.push("24px gutter did not apply to both sides of main content");
if (!near(largeAndWide.messageGrid?.width, expectedWideWidth)) failures.push("360px gutter did not apply with the 320px safety floor");
if (!near(largeAndTight.messageGrid?.width - largeAndWide.messageGrid?.width, expectedTightWidth - expectedWideWidth)) failures.push("gutter changes did not resize the shared grid consistently");
if (JSON.stringify(restored.settings) !== JSON.stringify(initialSettings)) failures.push("QA did not restore the user's initial settings");

const result = { initialSettings, initial, largeAndTight, largeAndWide, restored, failures };
if (failures.length) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
