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
const state = await evaluate(String.raw`(() => {
  const settings = window.__doubaoThemeGetSettings();
  window.__doubaoThemeOpenSettings();
  document.querySelector('.doubao-theme-settings-tab[data-tab="layout"]')?.click();
  const sidebarEntries = Array.from(document.querySelectorAll('#flow_chat_sidebar [data-testid]'));
  return {
    hasSidebarSection: Boolean(document.querySelector('.doubao-theme-sidebar-section')),
    hasSidebarSetter: typeof window.__doubaoThemeSetSidebarItem !== 'undefined',
    settingsHaveSidebarVisibility: Object.hasOwn(settings, 'sidebarItemVisibility'),
    legacyAttributes: sidebarEntries
      .filter((entry) => entry.hasAttribute('data-doubao-sidebar-item') || entry.hasAttribute('data-doubao-sidebar-collapsed'))
      .map((entry) => entry.getAttribute('data-testid')),
    scheduledTaskDisplay: getComputedStyle(document.querySelector('[data-testid="cron-jobs-sidebar-entry"]')).display,
    settingsLayerVisible: !document.querySelector('#doubao-theme-settings-layer')?.hidden
  };
})()`);
await evaluate("window.__doubaoThemeCloseSettings()");
socket.close();

const failures = [];
if (state.hasSidebarSection) failures.push("settings panel still exposes sidebar collapse controls");
if (state.hasSidebarSetter) failures.push("legacy sidebar setter API is still installed");
if (state.settingsHaveSidebarVisibility) failures.push("legacy sidebar visibility state is still exposed");
if (state.legacyAttributes.length) failures.push("theme still annotates native sidebar entries");
if (state.scheduledTaskDisplay === "none") failures.push("theme still hides a native sidebar entry");
if (runtimeExceptions.length) failures.push("runtime exception occurred during sidebar QA");

const result = { state, runtimeExceptions, failures };
if (failures.length) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
