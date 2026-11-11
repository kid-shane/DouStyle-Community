// Manual live-client tool. See tools/README.md before running.
import { isDoubaoChatURL } from "../doubao-target.mjs";
const port = process.env.DOUBAO_THEME_PORT || "9237";

async function cdpSession(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let sequence = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method) {
      events.push({ method: message.method, params: message.params });
      return;
    }
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

  return { socket, call, events };
}

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page" && isDoubaoChatURL(item.url));
if (!target) throw new Error("Doubao chat page was not found");

const { socket, call, events } = await cdpSession(target.webSocketDebuggerUrl);
await call("Runtime.enable");
await call("Log.enable");
events.length = 0;
if (process.env.DOUBAO_NAVIGATE_URL) {
  if (!isDoubaoChatURL(process.env.DOUBAO_NAVIGATE_URL) || !/^\/chat(?:\/\d+)?$/.test(new URL(process.env.DOUBAO_NAVIGATE_URL).pathname)) {
    throw new Error("Invalid DOUBAO_NAVIGATE_URL");
  }
  await call("Runtime.evaluate", {
    expression: `location.href = ${JSON.stringify(process.env.DOUBAO_NAVIGATE_URL)}`,
  });
  await new Promise((resolve) => setTimeout(resolve, 1200));
}
if (process.env.DOUBAO_VIEWPORT) {
  const [width, height] = process.env.DOUBAO_VIEWPORT.split(",").map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error("Invalid DOUBAO_VIEWPORT");
  await call("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}
if (process.env.DOUBAO_EMULATE_DARK === "1") {
  await call("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  });
}
if (process.env.DOUBAO_DATA_THEME) {
  await call("Runtime.evaluate", {
    expression: `document.documentElement.setAttribute("data-theme", ${JSON.stringify(process.env.DOUBAO_DATA_THEME)})`,
  });
}
if (process.env.DOUBAO_HOVER) {
  const [x, y] = process.env.DOUBAO_HOVER.split(",").map(Number);
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await new Promise((resolve) => setTimeout(resolve, 350));
}
const expression = String.raw`(() => {
  const sample = (x, y) => {
    const element = document.elementFromPoint(x, y);
    if (!element) return null;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const ancestors = [];
    let current = element;
    while (current && ancestors.length < 8) {
      const currentStyle = getComputedStyle(current);
      const currentRect = current.getBoundingClientRect();
      ancestors.push({
        tag: current.tagName,
        id: current.id,
        className: typeof current.className === "string" ? current.className : "",
        background: currentStyle.backgroundColor,
        rect: [currentRect.x, currentRect.y, currentRect.width, currentRect.height],
      });
      current = current.parentElement;
    }
    return {
      x,
      y,
      tag: element.tagName,
      className: typeof element.className === "string" ? element.className : "",
      role: element.getAttribute("role"),
      text: (element.innerText || "").slice(0, 80),
      background: style.backgroundColor,
      color: style.color,
      border: style.borderColor,
      font: style.fontFamily,
      rect: [rect.x, rect.y, rect.width, rect.height],
      ancestors,
    };
  };

  const rootStyle = getComputedStyle(document.documentElement);
  const variables = {};
  for (let index = 0; index < rootStyle.length; index += 1) {
    const name = rootStyle[index];
    if (!name.startsWith("--")) continue;
    if (!/color|background|border|text|primary|surface|fill|line|neutral|gray|grey|brand/i.test(name)) continue;
    variables[name] = rootStyle.getPropertyValue(name).trim();
  }

  const colors = {};
  for (const element of document.querySelectorAll("*")) {
    const style = getComputedStyle(element);
    for (const value of [style.backgroundColor, style.color, style.borderColor]) {
      if (!value || value === "rgba(0, 0, 0, 0)") continue;
      colors[value] = (colors[value] || 0) + 1;
    }
  }

  const x = innerWidth;
  const y = innerHeight;
  return {
    url: location.href,
    documentElement: {
      className: document.documentElement.className,
      attributes: Object.fromEntries(Array.from(document.documentElement.attributes).map((item) => [item.name, item.value])),
      bodyClassName: document.body.className,
    },
    themeRuntime: {
      installed: Boolean(window.__doubaoLinearThemeInstalled),
      themeObserver: Boolean(window.__doubaoLinearThemeObserver),
      compatibilityObserver: Boolean(window.__doubaoLinearCompatibilityObserver),
      stylePresent: Boolean(document.getElementById("doubao-local-theme")),
      styleLength: document.getElementById("doubao-local-theme")?.textContent.length || 0,
      adaptedSurfaceCount: document.querySelectorAll(".doubao-theme-adapted-surface").length,
      settingsTriggerPresent: Boolean(document.getElementById("doubao-theme-settings-trigger")),
      settingsPanelPresent: Boolean(document.getElementById("doubao-theme-settings-layer")),
      settingsPanelHidden: document.getElementById("doubao-theme-settings-layer")?.hidden ?? null,
      settingsApiPresent: typeof window.__doubaoThemeOpenSettings === "function",
      settings: typeof window.__doubaoThemeGetSettings === "function" ? window.__doubaoThemeGetSettings() : null,
    },
    viewport: [x, y],
    contentLayouts: Array.from(document.querySelectorAll(".md-box-root"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
      })
      .slice(-3)
      .map((element) => {
        const ancestors = [];
        let current = element;
        while (current && ancestors.length < 12) {
          const style = getComputedStyle(current);
          const rect = current.getBoundingClientRect();
          ancestors.push({
            tag: current.tagName,
            id: current.id,
            className: typeof current.className === "string" ? current.className : "",
            rect: [rect.x, rect.y, rect.width, rect.height],
            width: style.width,
            maxWidth: style.maxWidth,
            marginLeft: style.marginLeft,
            marginRight: style.marginRight,
            paddingLeft: style.paddingLeft,
            paddingRight: style.paddingRight,
            display: style.display,
          });
          current = current.parentElement;
        }
        return {
          text: (element.innerText || "").trim().slice(0, 100),
          ancestors,
        };
      }),
    typography: [
      ["body", document.body],
      ["sidebar", document.querySelector("#flow_chat_sidebar")],
      ["markdown", document.querySelector(".md-box-root")],
      ["paragraph", document.querySelector(".md-box-root p")],
      ["list", document.querySelector(".md-box-root li")],
      ["heading", document.querySelector(".md-box-root h1, .md-box-root h2, .md-box-root h3")],
      ["composer", document.querySelector("textarea, [contenteditable='true']")],
    ].map(([name, element]) => {
      if (!(element instanceof Element)) return { name, missing: true };
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        name,
        tag: element.tagName,
        className: typeof element.className === "string" ? element.className : "",
        rect: [rect.x, rect.y, rect.width, rect.height],
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
      };
    }),
    settingsUi: [
      ["trigger", document.getElementById("doubao-theme-settings-trigger")],
      ["layer", document.getElementById("doubao-theme-settings-layer")],
      ["panel", document.querySelector(".doubao-theme-settings-panel")],
    ].map(([name, element]) => {
      if (!(element instanceof Element)) return { name, missing: true };
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        name,
        hidden: element.hidden,
        rect: [rect.x, rect.y, rect.width, rect.height],
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        display: style.display,
        pointerEvents: style.pointerEvents,
        zIndex: style.zIndex,
      };
    }),
    samples: [
      [20, 80],
      [Math.min(110, x * 0.08), y * 0.4],
      [Math.min(250, x * 0.22), 80],
      [x * 0.5, y * 0.45],
      [x * 0.5, 205],
      [x * 0.82, 205],
      [x * 0.5, 245],
      [x * 0.85, 375],
      [x * 0.82, y * 0.51],
      [x * 0.5, 36],
      [x * 0.5, y - 72],
      [x - 80, y - 72],
    ].map(([pointX, pointY]) => sample(pointX, pointY)),
    homeIssueCandidates: Array.from(document.querySelectorAll("*"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        if (
          rect.width < 120
          || rect.height < 24
          || rect.x < innerWidth * 0.52
          || rect.x > innerWidth
          || rect.y < innerHeight * 0.30
          || rect.y > innerHeight * 0.65
        ) return null;
        const style = getComputedStyle(element);
        return {
          tag: element.tagName,
          id: element.id,
          className: typeof element.className === "string" ? element.className : "",
          text: (element.innerText || element.getAttribute("aria-label") || "").trim().slice(0, 120),
          rect: [rect.x, rect.y, rect.width, rect.height],
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          position: style.position,
          background: style.background,
          color: style.color,
          overflow: style.overflow,
        };
      })
      .filter(Boolean)
      .sort((left, right) => (left.rect[2] * left.rect[3]) - (right.rect[2] * right.rect[3]))
      .slice(0, 40),
    welcomeImage: (() => {
      const host = document.getElementById("doubao-theme-welcome-image");
      const image = host?.querySelector("img, canvas");
      const previewHost = document.querySelector(".doubao-theme-welcome-preview-image");
      const previewImage = previewHost?.querySelector("img, canvas");
      const describe = (element) => {
        if (!(element instanceof Element)) return null;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          inlineStyle: element.getAttribute("style"),
          rect: [rect.x, rect.y, rect.width, rect.height],
          naturalSize: element instanceof HTMLImageElement ? [element.naturalWidth, element.naturalHeight] : null,
          width: style.width,
          height: style.height,
          objectFit: style.objectFit,
          objectPosition: style.objectPosition,
          overflow: style.overflow,
          transform: style.transform,
        };
      };
      return {
        host: describe(host),
        image: describe(image),
        previewHost: describe(previewHost),
        previewImage: describe(previewImage),
      };
    })(),
    greeting: (() => {
      const element = document.querySelector("[class*='greeting-text-']");
      if (!element) return null;
      const serializeStyle = (style) => ({
        content: style.content,
        display: style.display,
        position: style.position,
        inset: [style.top, style.right, style.bottom, style.left],
        width: style.width,
        height: style.height,
        background: style.background,
        color: style.color,
        opacity: style.opacity,
        transform: style.transform,
        animation: style.animation,
        mask: style.mask,
        clipPath: style.clipPath,
      });
      return {
        className: element.className,
        rect: (() => {
          const rect = element.getBoundingClientRect();
          return [rect.x, rect.y, rect.width, rect.height];
        })(),
        html: element.outerHTML.slice(0, 2000),
        base: serializeStyle(getComputedStyle(element)),
        before: serializeStyle(getComputedStyle(element, "::before")),
        after: serializeStyle(getComputedStyle(element, "::after")),
        parentHtml: element.parentElement?.outerHTML.slice(0, 4000) || null,
      };
    })(),
    userMessageSamples: Array.from(document.querySelectorAll("div, p, span"))
      .filter((element) => {
        const text = (element.innerText || "").trim();
        return ["直白来说怎么理解呢", "那如果之后想支持比如豆包参会怎么办呢？"].includes(text);
      })
      .slice(0, 4)
      .map((element) => {
        const ancestors = [];
        let current = element;
        while (current && ancestors.length < 8) {
          const style = getComputedStyle(current);
          const rect = current.getBoundingClientRect();
          ancestors.push({
            tag: current.tagName,
            id: current.id,
            className: typeof current.className === "string" ? current.className : "",
            text: (current.innerText || "").trim().slice(0, 100),
            rect: [rect.x, rect.y, rect.width, rect.height],
            background: style.background,
            color: style.color,
            border: style.border,
            borderRadius: style.borderRadius,
            padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
          });
          current = current.parentElement;
        }
        return ancestors;
      }),
    userMessageDetails: (() => {
      const root = Array.from(document.querySelectorAll("div"))
        .find((element) =>
          (element.innerText || "").trim() === "直白来说怎么理解呢"
          && String(element.className).includes("gap-8")
        );
      if (!root) return null;
      return {
        html: root.outerHTML.slice(0, 8000),
        descendants: Array.from(root.querySelectorAll("*")).map((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            className: typeof element.className === "string" ? element.className : "",
            text: (element.innerText || "").trim().slice(0, 100),
            rect: [rect.x, rect.y, rect.width, rect.height],
            background: style.background,
            color: style.color,
            border: style.border,
            borderRadius: style.borderRadius,
            padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
          };
        }),
      };
    })(),
    frames: Array.from(document.querySelectorAll("iframe")).map((frame) => {
      const rect = frame.getBoundingClientRect();
      const style = getComputedStyle(frame);
      const parent = frame.parentElement;
      const parentStyle = parent ? getComputedStyle(parent) : null;
      const ancestors = [];
      let current = frame.parentElement;
      while (current && ancestors.length < 5) {
        const currentStyle = getComputedStyle(current);
        const currentRect = current.getBoundingClientRect();
        ancestors.push({
          tag: current.tagName,
          className: current.className,
          rect: [currentRect.x, currentRect.y, currentRect.width, currentRect.height],
          background: currentStyle.backgroundColor,
          border: currentStyle.border,
          children: Array.from(current.children).map((child) => ({
            tag: child.tagName,
            className: child.className,
            text: (child.innerText || "").trim().slice(0, 80),
          })),
        });
        current = current.parentElement;
      }
      return {
        src: frame.src,
        title: frame.title,
        className: frame.className,
        rect: [rect.x, rect.y, rect.width, rect.height],
        background: style.backgroundColor,
        border: style.border,
        parent: parent ? {
          tag: parent.tagName,
          className: parent.className,
          background: parentStyle.backgroundColor,
          border: parentStyle.border,
        } : null,
        ancestors,
      };
    }),
    previewControls: Array.from(document.querySelectorAll("button, [role='button']"))
      .map((element) => {
        const text = (element.innerText || element.getAttribute("aria-label") || element.title || "").trim();
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          text,
          className: element.className,
          rect: [rect.x, rect.y, rect.width, rect.height],
          background: style.backgroundColor,
          color: style.color,
          border: style.border,
        };
      })
      .filter((item) => /放大|代码|下载/.test(item.text)),
    deepPreviewControls: (() => {
      const matches = [];
      const roots = [document];
      for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
        const root = roots[rootIndex];
        for (const element of root.querySelectorAll("*")) {
          if (element.shadowRoot) roots.push(element.shadowRoot);
          const directText = Array.from(element.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent || "")
            .join(" ")
            .trim();
          const label = [directText, element.getAttribute("aria-label"), element.title]
            .filter(Boolean)
            .join(" ");
          if (!/放大|查看代码|下载/.test(label)) continue;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          matches.push({
            tag: element.tagName,
            className: element.className,
            label,
            rect: [rect.x, rect.y, rect.width, rect.height],
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            position: style.position,
            background: style.backgroundColor,
            color: style.color,
            parentClassName: element.parentElement?.className || "",
          });
        }
      }
      return matches;
    })(),
    documentReferenceControls: Array.from(document.querySelectorAll(".md-box-root a, .md-box-root button, .md-box-root [role='link'], .md-box-root [role='button']"))
      .map((element) => {
        const text = (element.innerText || element.getAttribute("aria-label") || "").trim();
        if (!/多模态传输架构分享|2026 Q3 RTC网络 OKR总结|ByteMMT 项目分享/.test(text)) return null;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          role: element.getAttribute("role"),
          className: element.className,
          text,
          rect: [rect.x, rect.y, rect.width, rect.height],
          color: style.color,
          background: style.backgroundColor,
          parent: element.parentElement ? {
            tag: element.parentElement.tagName,
            className: element.parentElement.className,
          } : null,
        };
      })
      .filter(Boolean),
    overlayCandidates: Array.from(document.querySelectorAll("*"))
      .map((element) => {
        const style = getComputedStyle(element);
        if (!["absolute", "fixed", "sticky"].includes(style.position)) return null;
        const rect = element.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 20 || rect.x < innerWidth * 0.55 || rect.y < 0 || rect.y > innerHeight) return null;
        return {
          tag: element.tagName,
          className: element.className,
          text: (element.innerText || element.getAttribute("aria-label") || element.title || "").trim().slice(0, 120),
          rect: [rect.x, rect.y, rect.width, rect.height],
          position: style.position,
          background: style.backgroundColor,
          color: style.color,
          border: style.border,
          opacity: style.opacity,
        };
      })
      .filter(Boolean),
    lightSurfaces: Array.from(document.querySelectorAll("*"))
      .map((element) => {
        const style = getComputedStyle(element);
        if (!["rgb(255, 255, 255)", "rgb(250, 250, 250)", "rgb(249, 250, 251)", "rgb(243, 244, 246)"].includes(style.backgroundColor)) return null;
        const rect = element.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 20 || rect.bottom < 0 || rect.top > innerHeight) return null;
        return {
          tag: element.tagName,
          className: element.className,
          text: (element.innerText || element.getAttribute("aria-label") || element.title || "").trim().slice(0, 120),
          rect: [rect.x, rect.y, rect.width, rect.height],
          background: style.backgroundColor,
          color: style.color,
          border: style.border,
        };
      })
      .filter(Boolean),
    adaptedSurfaces: Array.from(document.querySelectorAll(".doubao-theme-adapted-surface")).map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName,
        className: element.className,
        text: (element.innerText || element.getAttribute("aria-label") || element.title || "").trim().slice(0, 120),
        rect: [rect.x, rect.y, rect.width, rect.height],
        background: style.backgroundColor,
        color: style.color,
      };
    }),
    topColors: Object.entries(colors).sort((left, right) => right[1] - left[1]).slice(0, 40),
    font: {
      body: getComputedStyle(document.body).fontFamily,
      bundledInterReady: document.fonts.check('12px "Doubao Linear Inter"'),
    },
    variables,
  };
})()`;

const result = await call("Runtime.evaluate", { expression, returnByValue: true });
await new Promise((resolve) => setTimeout(resolve, 800));
const relevantConsoleEvents = events.filter(({ method }) =>
  method === "Runtime.exceptionThrown" || method === "Log.entryAdded"
);
console.log(JSON.stringify({
  ...result.result.value,
  diagnostics: {
    newConsoleErrorCount: relevantConsoleEvents.length,
    newConsoleErrors: relevantConsoleEvents,
  },
}, null, 2));
if (process.env.DOUBAO_VIEWPORT) await call("Emulation.clearDeviceMetricsOverride");
socket.close();
