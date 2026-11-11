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
await call("Runtime.enable");
const result = await call("Runtime.evaluate", {
  returnByValue: true,
  expression: String.raw`(() => {
    const visible = (element) => {
      if (!(element instanceof Element)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const describe = (element) => {
      if (!(element instanceof Element)) return null;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName,
        testid: element.getAttribute("data-testid"),
        className: typeof element.className === "string" ? element.className : "",
        text: (element.innerText || "").trim().replace(/\s+/g, " ").slice(0, 120),
        rect: [rect.x, rect.y, rect.width, rect.height],
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        width: style.width,
        maxWidth: style.maxWidth,
        marginLeft: style.marginLeft,
        marginRight: style.marginRight,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        display: style.display,
        justifyContent: style.justifyContent,
      };
    };
    const chain = (element, limit = 12) => {
      const items = [];
      let current = element;
      while (current && items.length < limit) {
        items.push(describe(current));
        current = current.parentElement;
      }
      return items;
    };
    const sidebar = document.querySelector("#flow_chat_sidebar");
    const sidebarLeafText = sidebar
      ? Array.from(sidebar.querySelectorAll("*"))
          .filter((element) => visible(element) && element.children.length === 0 && (element.textContent || "").trim())
          .slice(0, 80)
          .map(describe)
      : [];
    const navigationLabels = new Set(["新工作任务", "定时任务", "技能 · 连接器 · 伙伴", "伙伴对话", "云盘", "手机遥控电脑", "更多"]);
    const navigationChains = sidebar
      ? Array.from(sidebar.querySelectorAll("*"))
          .filter((element) => element.children.length === 0 && navigationLabels.has((element.textContent || "").trim()))
          .map((element) => ({ label: (element.textContent || "").trim(), chain: chain(element, 6) }))
      : [];
    const widthContainers = Array.from(document.querySelectorAll('[class*="max-w-(--content-max-width)"]'))
      .filter(visible)
      .map(describe);
    const markdown = Array.from(document.querySelectorAll(".md-box-root")).filter(visible).at(-1) || null;
    const bubble = Array.from(document.querySelectorAll('[class*="bg-g-send-msg-bubble-bg"]')).filter(visible).at(-1) || null;
    const composer = document.querySelector("#input-engine-container");
    const main = document.querySelector('main[data-container-name="main"]') || document.querySelector("main");
    return {
      viewport: [innerWidth, innerHeight],
      settings: window.__doubaoThemeGetSettings?.(),
      sidebar: describe(sidebar),
      sidebarLeafText,
      navigationChains,
      widthContainers,
      markdown: chain(markdown),
      bubble: chain(bubble),
      composer: chain(composer),
      main: describe(main),
    };
  })()`,
});
socket.close();
if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
console.log(JSON.stringify(result.result.value, null, 2));
