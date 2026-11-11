import { isDoubaoChatURL } from "./doubao-target.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.DOUBAO_THEME_PORT || "9237";
const expectedThemes = [
  { id: "doubao-default", name: "豆包默认-浅色", baseMode: "light", accent: "#0057FF", background: "#FFFFFF", foreground: "#000000" },
  { id: "doubao-dark", name: "豆包默认-深色", baseMode: "dark", accent: "#547CFF", background: "#191C1F", foreground: "#FFFFFF" },
  { id: "trae", name: "Trae", baseMode: "dark", accent: "#31F08D", background: "#191B1D", foreground: "#D2D3DB" },
  { id: "mira", name: "Mira", baseMode: "light", accent: "#CC7D5E", background: "#FAFAF7", foreground: "#2D2D2B" },
  { id: "aime", name: "Aime", baseMode: "light", accent: "#1F9D36", background: "#F8F9F7", foreground: "#1F211E" },
  { id: "claude", name: "Claude", baseMode: "light", accent: "#D97757", background: "#F9F9F7", foreground: "#131313" },
  { id: "linear", name: "Linear", baseMode: "dark", accent: "#606ACC", background: "#0F0F11", foreground: "#E3E4E6" }
];

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page" && isDoubaoChatURL(item.url));
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
  if (message.method === "Runtime.exceptionThrown") {
    const details = message.params.exceptionDetails;
    runtimeExceptions.push({
      text: details.exception?.description || details.text || "Runtime exception",
      url: details.url || "",
      lineNumber: details.lineNumber,
      columnNumber: details.columnNumber
    });
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
await waitFor("Boolean(document.querySelector('main') && document.querySelector('#flow_chat_sidebar') && document.querySelector('#input-engine-container'))");
const initialSettings = await evaluate("window.__doubaoThemeGetSettings()");
const initialStoredSettings = await evaluate("localStorage.getItem('doubao-local-appearance-v1')");
const themes = await evaluate("window.__doubaoThemeGetThemes()");

const snapshotExpression = String.raw`(() => {
  const root = document.documentElement;
  const rootStyle = getComputedStyle(root);
  const token = (name) => rootStyle.getPropertyValue('--db-theme-' + name).trim();
  const box = (element) => element ? {
    background: getComputedStyle(element).backgroundColor,
    color: getComputedStyle(element).color,
    border: getComputedStyle(element).borderColor
  } : null;
  window.__doubaoThemeOpenSettings();
  const presetNames = Array.from(document.querySelectorAll('#doubao-theme-preset option')).map((option) => option.textContent.trim());
  const productCopy = {
    triggerTitle: document.querySelector('#doubao-theme-settings-trigger')?.getAttribute('title'),
    triggerAria: document.querySelector('#doubao-theme-settings-trigger')?.getAttribute('aria-label'),
    title: document.querySelector('#doubao-theme-settings-title')?.textContent.trim(),
    tabs: Array.from(document.querySelectorAll('.doubao-theme-settings-tab')).map((element) => element.textContent.trim()),
    presetLabel: document.querySelector('label[for="doubao-theme-preset"]')?.textContent.trim(),
    presetDescription: document.querySelector('label[for="doubao-theme-preset"] + span')?.textContent.trim(),
    resetLabel: document.querySelector('.doubao-theme-settings-footer button')?.textContent.trim()
  };
  window.__doubaoThemeCloseSettings();
  return {
    settings: window.__doubaoThemeGetSettings(),
    themeId: root.getAttribute('data-doubao-theme'),
    baseMode: root.getAttribute('data-theme'),
    tokens: {
      accent: token('accent'),
      background: token('background'),
      foreground: token('foreground'),
      sidebar: token('sidebar'),
      surface: token('surface'),
      border: token('border'),
      userMessageBackground: token('user-message-background'),
      userMessageText: token('user-message-text')
    },
    computed: {
      main: box(document.querySelector('main')),
      sidebar: box(document.querySelector('#flow_chat_sidebar')),
      composer: box(document.querySelector('#input-engine-container')),
      userBubble: box(document.querySelector('[class*="bg-g-send-msg-bubble-bg"]'))
    },
    font: {
      body: getComputedStyle(document.body).fontFamily,
      anthropicSansReady: document.fonts.check('12px "Doubao Anthropic Sans"'),
      anthropicSerifReady: document.fonts.check('12px "Doubao Anthropic Serif"'),
      claudeCjkSansReady: document.fonts.check('12px "Doubao Claude CJK Sans"'),
      claudeCjkSerifReady: document.fonts.check('12px "Doubao Claude CJK Serif"')
    },
    welcome: {
      text: document.querySelector('#flow-chat-guidance-page [class*="greeting-text-"]')?.textContent || null,
      imageAsset: document.querySelector('#doubao-theme-welcome-image')?.dataset.welcomeAsset || 'none',
      canvasCount: document.querySelectorAll('#doubao-theme-welcome-image canvas').length,
      imageHostRect: (() => {
        const rect = document.querySelector('#doubao-theme-welcome-image')?.getBoundingClientRect();
        return rect ? [rect.width, rect.height] : null;
      })(),
      imageMediaRect: (() => {
        const rect = document.querySelector('#doubao-theme-welcome-image img, #doubao-theme-welcome-image canvas')?.getBoundingClientRect();
        return rect ? [rect.width, rect.height] : null;
      })(),
      imageFit: getComputedStyle(document.querySelector('#doubao-theme-welcome-image img, #doubao-theme-welcome-image canvas') || document.documentElement).objectFit,
      imagePosition: getComputedStyle(document.querySelector('#doubao-theme-welcome-image img, #doubao-theme-welcome-image canvas') || document.documentElement).objectPosition,
      imageTransform: getComputedStyle(document.querySelector('#doubao-theme-welcome-image img, #doubao-theme-welcome-image canvas') || document.documentElement).transform,
      imageZoom: Number(document.querySelector('#doubao-theme-welcome-image')?.dataset.welcomeZoom || 100),
      controlsReady: Boolean(
        document.querySelector('#doubao-theme-welcome-text')
        && document.querySelector('#doubao-theme-welcome-image-upload')
        && document.querySelector('#doubao-theme-welcome-image-mira')
        && document.querySelector('#doubao-theme-welcome-image-none')
        && document.querySelector('.doubao-theme-welcome-library-grid')
        && document.querySelector('#doubao-theme-welcome-library-count')
        && !document.querySelector('#doubao-theme-welcome-image-remove')
        && document.querySelector('.doubao-theme-welcome-crop-frame')
        && document.querySelector('#doubao-theme-welcome-crop-center')
        && document.querySelector('#doubao-theme-welcome-zoom-out')
        && document.querySelector('#doubao-theme-welcome-zoom-value')
        && document.querySelector('#doubao-theme-welcome-zoom-in')
        && !document.querySelector('button[data-welcome-fit]')
        && !document.querySelector('[id^="doubao-theme-welcome-image-position"]')
        && !document.querySelector('#doubao-theme-welcome-image-zoom')
      )
    },
    presetNames,
    productCopy
  };
})()`;

const snapshots = [];
const screenshots = {};
await mkdir(path.join(projectDirectory, "qa"), { recursive: true });
for (const theme of expectedThemes) {
  if (!await evaluate(`window.__doubaoThemeSetTheme(${JSON.stringify(theme.id)})`)) throw new Error(`Could not select ${theme.id}`);
  await evaluate("window.__doubaoThemeResetWelcomeText() && window.__doubaoThemeResetWelcomeImage()");
  await wait(120);
  snapshots.push(await evaluate(snapshotExpression));
  if (["trae", "mira", "aime", "claude"].includes(theme.id)) {
    if (theme.id === "claude") {
      await evaluate("window.__doubaoThemeOpenSettings()");
      await wait(120);
    }
    const capture = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    const screenshotPath = path.join(projectDirectory, "qa", theme.id === "claude"
      ? "implementation-style-claude-panel-v1.png"
      : theme.id === "aime"
        ? "implementation-theme-aime-v1.png"
        : `implementation-theme-${theme.id}-v6.png`);
    await writeFile(screenshotPath, Buffer.from(capture.data, "base64"));
    screenshots[theme.id] = screenshotPath;
    if (theme.id === "mira") {
      await evaluate("window.__doubaoThemeOpenSettings(); document.querySelector('.doubao-theme-settings-tab[data-tab=\"welcome\"]')?.click(); true");
      await wait(160);
      const welcomeCapture = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      const welcomeScreenshotPath = path.join(projectDirectory, "qa", "implementation-welcome-mira-panel-v1.png");
      await writeFile(welcomeScreenshotPath, Buffer.from(welcomeCapture.data, "base64"));
      screenshots.miraWelcomePanel = welcomeScreenshotPath;
      await evaluate("window.__doubaoThemeCloseSettings()");
    }
    if (theme.id === "aime") {
      await evaluate("window.__doubaoThemeOpenSettings(); document.querySelector('.doubao-theme-settings-tab[data-tab=\"colors\"]')?.click(); true");
      await wait(160);
      const panelCapture = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      const panelScreenshotPath = path.join(projectDirectory, "qa", "implementation-style-aime-panel-v1.png");
      await writeFile(panelScreenshotPath, Buffer.from(panelCapture.data, "base64"));
      screenshots.aimePanel = panelScreenshotPath;
      await evaluate("window.__doubaoThemeCloseSettings()");
    }
    if (theme.id === "claude") await evaluate("window.__doubaoThemeCloseSettings()");
  }
}

const miraAnimation = JSON.parse(await readFile(path.join(projectDirectory, "assets", "mira-black-cat.json"), "utf8"));
const customWelcomeImage = miraAnimation.assets.find((asset) => typeof asset.p === "string" && asset.p.startsWith("data:image/"))?.p;
if (!customWelcomeImage) throw new Error("Mira 静态验收图未找到");
await evaluate(`(() => {
  if (!(window.__doubaoThemeSetTheme('mira')
    && window.__doubaoThemeSetWelcomeText('今天先从哪件事开始？')
    && window.__doubaoThemeSetWelcomeImage(${JSON.stringify(customWelcomeImage)}))) return false;
  window.__doubaoThemeOpenSettings();
  document.querySelector('.doubao-theme-settings-tab[data-tab="welcome"]')?.click();
  return true;
})()`);
await waitFor("document.querySelector('.doubao-theme-welcome-crop-frame')?.dataset.croppable === 'true'");
await waitFor("Boolean(document.querySelector('.doubao-theme-welcome-preview-image img')?.naturalWidth)");
const zoomMinimumReady = await evaluate(`(() => {
  const zoomOut = document.querySelector('#doubao-theme-welcome-zoom-out');
  for (let index = 0; index < 5; index += 1) zoomOut?.click();
  const hostRect = document.querySelector('.doubao-theme-welcome-preview-image')?.getBoundingClientRect();
  const halfSizeRect = document.querySelector('.doubao-theme-welcome-preview-image img')?.getBoundingClientRect();
  const halfSizeCentered = Boolean(hostRect && halfSizeRect
    && Math.abs((halfSizeRect.x + (halfSizeRect.width / 2)) - (hostRect.x + (hostRect.width / 2))) < 0.5
    && Math.abs((halfSizeRect.y + (halfSizeRect.height / 2)) - (hostRect.y + (hostRect.height / 2))) < 0.5);
  for (let index = 0; index < 5; index += 1) zoomOut?.click();
  const mediaRect = document.querySelector('.doubao-theme-welcome-preview-image img')?.getBoundingClientRect();
  return halfSizeCentered
    && document.querySelector('#doubao-theme-welcome-zoom-value')?.textContent === '0%'
    && zoomOut?.disabled === true
    && mediaRect?.width === 0
    && mediaRect?.height === 0;
})()`);
if (!zoomMinimumReady) throw new Error("欢迎图 0% 缩放边界未生效");
await evaluate("document.querySelector('#doubao-theme-welcome-crop-center')?.click(); true");
await wait(80);
await evaluate("document.querySelector('#doubao-theme-welcome-zoom-in')?.click(); true");
await wait(80);
const cropRect = await evaluate(`(() => {
  const rect = document.querySelector('.doubao-theme-welcome-crop-frame')?.getBoundingClientRect();
  return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
})()`);
if (!cropRect) throw new Error("欢迎图裁剪区未出现");
const cropX = cropRect.x + (cropRect.width / 2);
const cropY = cropRect.y + (cropRect.height / 2);
await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: cropX, y: cropY });
await call("Input.dispatchMouseEvent", { type: "mouseWheel", x: cropX, y: cropY, deltaX: 0, deltaY: -40 });
await wait(320);
await call("Input.dispatchMouseEvent", { type: "mousePressed", x: cropX, y: cropY, button: "left", clickCount: 1 });
await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: cropX, y: cropY + 45, button: "left", buttons: 1 });
await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: cropX, y: cropY + 45, button: "left", clickCount: 1 });
await wait(120);
await evaluate("window.__doubaoThemeCloseSettings()");
await wait(80);
const customWelcomeBeforeReload = await evaluate(snapshotExpression);
await call("Page.reload", { ignoreCache: true });
await wait(300);
await waitFor("typeof window.__doubaoThemeGetSettings === 'function'");
await waitFor("Boolean(document.querySelector('#input-engine-container'))");
await waitFor("Boolean(document.querySelector('#doubao-theme-welcome-image img')?.naturalWidth)");
const customWelcomeAfterReload = await evaluate(snapshotExpression);
await evaluate("window.__doubaoThemeOpenSettings(); document.querySelector('.doubao-theme-settings-tab[data-tab=\"welcome\"]')?.click(); true");
await wait(120);
const zoomCropCenter = await evaluate(`(() => {
  const rect = document.querySelector('.doubao-theme-welcome-crop-frame')?.getBoundingClientRect();
  return rect ? { x: rect.x + (rect.width / 2), y: rect.y + (rect.height / 2) } : null;
})()`);
if (zoomCropCenter) {
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: zoomCropCenter.x, y: zoomCropCenter.y });
  await wait(100);
}
const zoomCapture = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
const zoomScreenshotPath = path.join(projectDirectory, "qa", "implementation-welcome-zoom-panel-v1.png");
await writeFile(zoomScreenshotPath, Buffer.from(zoomCapture.data, "base64"));
screenshots.welcomeZoomPanel = zoomScreenshotPath;
await evaluate("window.__doubaoThemeCloseSettings()");

await evaluate(`localStorage.setItem('doubao-local-appearance-v1', ${JSON.stringify(initialStoredSettings)})`);
try {
  await call("Page.reload", { ignoreCache: true });
} catch (error) {
  if (!String(error?.message || error).includes("Inspected target navigated or closed")) throw error;
}
await wait(300);
await waitFor("typeof window.__doubaoThemeGetSettings === 'function'");
await waitFor("Boolean(document.querySelector('#input-engine-container'))");
const restoredSettings = await evaluate("window.__doubaoThemeGetSettings()");
await evaluate("window.__doubaoThemeOpenSettings(); document.querySelector('.doubao-theme-settings-tab[data-tab=\"welcome\"]')?.click(); true");
await wait(160);
const restoredCropCenter = await evaluate(`(() => {
  const rect = document.querySelector('.doubao-theme-welcome-crop-frame')?.getBoundingClientRect();
  return rect ? { x: rect.x + (rect.width / 2), y: rect.y + (rect.height / 2) } : null;
})()`);
if (restoredCropCenter) {
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: restoredCropCenter.x, y: restoredCropCenter.y });
  await wait(100);
}
const restoredWelcomeCapture = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
const restoredWelcomeScreenshotPath = path.join(projectDirectory, "qa", "implementation-welcome-custom-panel-v3.png");
await writeFile(restoredWelcomeScreenshotPath, Buffer.from(restoredWelcomeCapture.data, "base64"));
screenshots.customWelcomePanel = restoredWelcomeScreenshotPath;
await evaluate("window.__doubaoThemeCloseSettings()");
socket.close();

const failures = [];
if (JSON.stringify(themes) !== JSON.stringify(expectedThemes.map(({ id, name, baseMode }) => ({ id, name, baseMode })))) failures.push("Style 列表或顺序不正确");
for (let index = 0; index < expectedThemes.length; index += 1) {
  const expected = expectedThemes[index];
  const actual = snapshots[index];
  if (actual.themeId !== expected.id || actual.baseMode !== expected.baseMode) failures.push(`${expected.name} 的模式映射不正确`);
  for (const key of ["accent", "background", "foreground"]) {
    if (actual.tokens[key].toUpperCase() !== expected[key].toUpperCase()) failures.push(`${expected.name} 的 ${key} 令牌不正确`);
  }
  if (expected.id === "trae" && (actual.tokens.userMessageBackground.toUpperCase() !== "#046231" || actual.tokens.userMessageText.toUpperCase() !== "#FFFFFF")) {
    failures.push("Trae 的我的消息配色不正确");
  }
  if (actual.settings.themeId !== expected.id || Object.keys(actual.settings.customColors).length) failures.push(`${expected.name} 切换后未正确清理自定义色`);
  if (JSON.stringify(actual.presetNames) !== JSON.stringify(expectedThemes.map((theme) => theme.name))) failures.push(`${expected.name} 的面板预设列表不正确`);
  if (JSON.stringify(actual.productCopy) !== JSON.stringify({
    triggerTitle: "Style",
    triggerAria: "打开豆Style",
    title: "选择你的 Style",
    tabs: ["Style 配色", "排版布局", "欢迎页"],
    presetLabel: "Style",
    presetDescription: "选择预设；切换 Style 时清除自定义颜色",
    resetLabel: "恢复 Style 默认"
  })) failures.push(`${expected.name} 的 Style 产品文案不正确`);
  if (actual.welcome.text !== "今天有什么工作要处理？" || !actual.welcome.controlsReady) failures.push(`${expected.name} 的欢迎语默认值或设置控件不正确`);
  if (expected.id === "mira") {
    if (actual.welcome.imageAsset !== "mira-cat" || actual.welcome.canvasCount !== 1) failures.push("Mira 默认小猫动画未正确渲染");
  } else if (actual.welcome.imageAsset !== "none" || actual.welcome.canvasCount !== 0) {
    failures.push(`${expected.name} 不应默认显示欢迎图`);
  }
  if (!actual.computed.main || !actual.computed.sidebar || !actual.computed.composer) failures.push(`${expected.name} 缺少核心界面表面`);
  if (expected.id === "claude") {
    if (!actual.font.body.includes("Doubao Anthropic Sans")) failures.push("Claude 界面字体未生效");
    if (![actual.font.anthropicSansReady, actual.font.anthropicSerifReady, actual.font.claudeCjkSansReady, actual.font.claudeCjkSerifReady].every(Boolean)) {
      failures.push("Claude 字体资源未全部加载");
    }
  }
}
for (const [label, snapshot] of [["刷新前", customWelcomeBeforeReload], ["刷新后", customWelcomeAfterReload]]) {
  if (snapshot.welcome.text !== "今天先从哪件事开始？" || snapshot.welcome.imageAsset !== "custom") failures.push(`自定义欢迎页${label}未生效`);
  const savedImage = snapshot.settings.welcomeImageByTheme?.mira;
  const savedImageIsAvailable = savedImage === customWelcomeImage
    || (typeof savedImage === "string" && savedImage.startsWith("asset:")
      && snapshot.settings.welcomeImageLibrary?.some((item) => savedImage === "asset:" + item.id));
  if (snapshot.settings.welcomeTextByTheme?.mira !== "今天先从哪件事开始？" || !savedImageIsAvailable) {
    failures.push(`自定义欢迎页${label}未正确保存`);
  }
  const savedLayout = snapshot.settings.welcomeImageLayoutByTheme?.mira;
  if (!savedLayout || savedLayout.zoom !== 120 || savedLayout.positionX !== 50 || Math.abs(savedLayout.positionY - 25) > 0.5) {
    failures.push(`自定义图片显示区域${label}未正确保存`);
  }
  const [renderedPositionX, renderedPositionY] = snapshot.welcome.imagePosition.split(" ").map((value) => Number.parseFloat(value));
  if (snapshot.welcome.imageFit !== "cover" || renderedPositionX !== 50 || Math.abs(renderedPositionY - 25) > 0.5 || snapshot.welcome.imageTransform !== "none" || snapshot.welcome.imageZoom !== 120) {
    failures.push(`自定义图片显示区域${label}未正确渲染`);
  }
  if (snapshot.welcome.imageHostRect?.[1] !== 90 || Math.abs((snapshot.welcome.imageMediaRect?.[1] || 0) - 180) > 0.5) {
    failures.push(`自定义欢迎图${label}的缩放尺寸不正确`);
  }
}
if (JSON.stringify(restoredSettings) !== JSON.stringify(initialSettings)) failures.push("测试后未恢复用户原设置");
if (runtimeExceptions.length) failures.push("Style 切换或恢复期间出现运行时异常");

const result = { themes, screenshots, snapshots, customWelcomeBeforeReload, customWelcomeAfterReload, restoredSettings, runtimeExceptions, failures };
if (failures.length) {
  console.error(JSON.stringify({ failures, runtimeExceptions }, null, 2));
  process.exit(1);
}
const summarizedSettings = {
  ...restoredSettings,
  welcomeImageByTheme: Object.fromEntries(Object.entries(restoredSettings.welcomeImageByTheme || {}).map(([themeId, value]) => [
    themeId,
    typeof value === "string" && value.startsWith("data:image/") ? "[custom image saved]" : value
  ]))
};
console.log(JSON.stringify({
  themes,
  screenshots,
  representativeTokens: Object.fromEntries(snapshots.map((snapshot) => [snapshot.themeId, snapshot.tokens])),
  welcomeDefaults: Object.fromEntries(snapshots.map((snapshot) => [snapshot.themeId, snapshot.welcome])),
  welcomePersistence: {
    beforeReload: customWelcomeBeforeReload.welcome,
    afterReload: customWelcomeAfterReload.welcome
  },
  restoredSettings: summarizedSettings,
  runtimeExceptions,
  failures
}, null, 2));
