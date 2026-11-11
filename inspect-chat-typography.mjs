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
    const main = document.querySelector('main[data-container-name="main"]') || document.querySelector('main');
    if (!main) return { error: 'main not found' };
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight
        && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const describe = (element) => {
      const style = getComputedStyle(element);
      return {
        tag: element.tagName,
        id: element.id,
        className: typeof element.className === 'string' ? element.className : '',
        testid: element.getAttribute('data-testid'),
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontWeight: style.fontWeight,
      };
    };
    const samples = [];
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = (walker.currentNode.nodeValue || '').trim().replace(/\s+/g, ' ');
      const element = walker.currentNode.parentElement;
      if (!text || !element || !visible(element)) continue;
      const style = getComputedStyle(element);
      if (parseFloat(style.fontSize) < 12 || text.length < 4) continue;
      const ancestors = [];
      let current = element;
      while (current && current !== main && ancestors.length < 8) {
        ancestors.push(describe(current));
        current = current.parentElement;
      }
      samples.push({
        text: text.slice(0, 120),
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontWeight: style.fontWeight,
        markdown: Boolean(element.closest('.md-box-root')),
        receiveMessage: Boolean(element.closest('[data-testid="receive_message"]')),
        userBubble: Boolean(element.closest('[class*="bg-g-send-msg-bubble-bg"]')),
        ancestors,
      });
    }
    return {
      settings: window.__doubaoThemeGetSettings?.(),
      samples: samples.slice(0, 80),
    };
  })()`,
});
socket.close();
if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
console.log(JSON.stringify(result.result.value, null, 2));
