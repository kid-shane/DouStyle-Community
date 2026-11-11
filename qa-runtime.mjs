import { isDoubaoChatURL } from "./doubao-target.mjs";
const port = process.env.DOUBAO_THEME_PORT || "9237";
const chatUrl = process.env.DOUBAO_QA_CHAT_URL;
if (!chatUrl) throw new Error("Set DOUBAO_QA_CHAT_URL to an explicitly chosen test conversation");

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
const waitForShell = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const ready = await evaluate(`Boolean(
      document.getElementById('doubao-theme-settings-trigger')
      && document.querySelector('[data-testid="conversation-list-v2-item"]')
    )`);
    if (ready) return;
    await wait(200);
  }
  throw new Error("Doubao shell did not finish mounting");
};

await call("Runtime.enable");
await call("Page.enable");
if (target.url !== chatUrl) {
  await evaluate(`location.href = ${JSON.stringify(chatUrl)}`);
  await wait(3500);
}
await waitForShell();

const snapshotExpression = `(() => {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const bubble = document.querySelector('[class*="bg-g-send-msg-bubble-bg"]');
  const bubbleStyle = bubble ? getComputedStyle(bubble) : null;
  const conversationRows = Array.from(document.querySelectorAll('[data-testid="conversation-list-v2-item"]'));
  const conversationIcons = conversationRows.map((row) => row.querySelector(':scope > span.size-20.shrink-0:first-child')).filter(Boolean);
  const projectIcons = Array.from(document.querySelectorAll('section[data-project-id] button > span:first-child'));
  const trigger = document.getElementById('doubao-theme-settings-trigger');
  const sidebarRect = document.querySelector('#flow_chat_sidebar')?.getBoundingClientRect();
  const titleRect = document.querySelector('#flow_chat_sidebar [data-testid="workspace-switch-chip"]')?.getBoundingClientRect();
  const triggerRect = trigger?.getBoundingClientRect();
  return {
    theme: root.getAttribute('data-doubao-theme'),
    baseMode: root.getAttribute('data-theme'),
    settings: window.__doubaoThemeGetSettings?.(),
    tokens: {
      accent: style.getPropertyValue('--db-theme-accent').trim(),
      link: style.getPropertyValue('--db-theme-link').trim(),
      background: style.getPropertyValue('--db-theme-background').trim(),
      foreground: style.getPropertyValue('--db-theme-foreground').trim(),
      userMessageBackground: style.getPropertyValue('--db-theme-user-message-background').trim(),
      userMessageText: style.getPropertyValue('--db-theme-user-message-text').trim()
    },
    bubble: bubbleStyle ? { background: bubbleStyle.backgroundColor, color: bubbleStyle.color } : null,
    sidebarIcons: {
      conversationCount: conversationIcons.length,
      visibleConversationCount: conversationIcons.filter((icon) => getComputedStyle(icon).display !== 'none').length,
      projectCount: projectIcons.length,
      visibleProjectCount: projectIcons.filter((icon) => getComputedStyle(icon).display !== 'none').length
    },
    triggerPosition: triggerRect && sidebarRect && titleRect ? {
      hidden: trigger.hidden,
      titleGap: Math.round(triggerRect.left - titleRect.right),
      centerOffset: Math.round(triggerRect.top + triggerRect.height / 2 - titleRect.top - titleRect.height / 2),
      insideSidebar: triggerRect.right <= sidebarRect.right - 8
    } : null
  };
})()`;

const initialSettings = await evaluate("window.__doubaoThemeGetSettings?.()");
await evaluate("window.__doubaoThemeResetSettings()");
await wait(800);
const defaultAfterReset = await evaluate(snapshotExpression);
const themes = await evaluate("window.__doubaoThemeGetThemes?.()");
const presets = [];
for (const theme of themes) {
  const changed = await evaluate(`window.__doubaoThemeSetTheme(${JSON.stringify(theme.id)})`);
  if (!changed) throw new Error(`Could not select theme ${theme.id}`);
  await wait(50);
  presets.push(await evaluate(snapshotExpression));
}

await evaluate(`window.__doubaoThemeSetTheme('trae') &&
  window.__doubaoThemeSetColor('accent', '#E45C9B') &&
  window.__doubaoThemeSetColor('background', '#101820') &&
  window.__doubaoThemeSetColor('foreground', '#F6F3EA') &&
  window.__doubaoThemeSetColor('userMessageBackground', '#5A2344') &&
  window.__doubaoThemeSetColor('userMessageText', '#FFF4FA') &&
  window.__doubaoThemeSetToggle('showConversationIcons', true)`);
await wait(800);
const customizedBeforeReload = await evaluate(snapshotExpression);
await call("Page.reload", { ignoreCache: true });
await wait(4000);
await waitForShell();
const customizedAfterReload = await evaluate(snapshotExpression);

await evaluate(`localStorage.setItem('doubao-local-appearance-v1', ${JSON.stringify(JSON.stringify(initialSettings))})`);
await call("Page.reload", { ignoreCache: true });
await wait(4000);
await waitForShell();
const restored = await evaluate(snapshotExpression);
if (initialTargetUrl !== chatUrl) {
  await call("Page.navigate", { url: initialTargetUrl });
  await wait(500);
  await waitForShell();
}
socket.close();

const result = { initialSettings, defaultAfterReset, themes, presets, customizedBeforeReload, customizedAfterReload, restored };
const failures = [];
if (themes.length !== 7) failures.push("expected exactly seven themes");
if (presets.some((item) => !item.theme || !item.tokens.accent || item.triggerPosition?.hidden || item.triggerPosition?.titleGap !== 4 || item.triggerPosition?.centerOffset !== 0 || !item.triggerPosition?.insideSidebar)) failures.push("preset or title-entry mapping failed");
if (defaultAfterReset.settings.uniformChatTypography !== true) failures.push("uniform chat typography is not enabled by default");
if (defaultAfterReset.settings.showConversationIcons !== false || defaultAfterReset.sidebarIcons.visibleConversationCount !== 0) failures.push("conversation icons are not hidden by default");
if (defaultAfterReset.sidebarIcons.projectCount && defaultAfterReset.sidebarIcons.visibleProjectCount !== defaultAfterReset.sidebarIcons.projectCount) failures.push("project icons were hidden with conversation icons");
if (customizedBeforeReload.tokens.accent.toUpperCase() !== "#E45C9B") failures.push("custom accent was not applied");
if (customizedBeforeReload.tokens.link === customizedBeforeReload.tokens.accent) failures.push("custom link derivation was not applied");
if (customizedBeforeReload.bubble?.background !== "rgb(90, 35, 68)") failures.push("custom message background was not applied");
if (customizedBeforeReload.bubble?.color !== "rgb(255, 244, 250)") failures.push("custom message text was not applied");
if (!customizedBeforeReload.sidebarIcons.visibleConversationCount) failures.push("conversation icon toggle did not show icons");
if (customizedBeforeReload.sidebarIcons.projectCount && customizedBeforeReload.sidebarIcons.visibleProjectCount !== customizedBeforeReload.sidebarIcons.projectCount) failures.push("project icons changed while enabling conversation icons");
if (JSON.stringify(customizedBeforeReload.settings) !== JSON.stringify(customizedAfterReload.settings)) failures.push("custom settings did not persist across reload");
if (JSON.stringify(restored.settings) !== JSON.stringify(initialSettings)) failures.push("QA did not restore the user's initial settings");
if (failures.length) {
  console.error(JSON.stringify({ failures, result }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
