import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { installCleanInput } from "./composer-clean-input.mjs";
import { installUpdateControl } from "./update-ui.mjs";
import { createUpdateBridge } from "./update-bridge.mjs";
import { createThemeAppearanceModel } from "./theme-appearance.mjs";
import { createSkinModel } from "./skin-model.mjs";
import { createSkinRuntime } from "./skin-runtime.mjs";
import { createWorkshopBridge } from "./skin-workshop.mjs";
import { installWorkshopControl } from "./skin-workshop-ui.mjs";
import { installSkinUI } from "./skin-ui.mjs";
import { isDoubaoChatURL, doubaoPageGuard } from "./doubao-target.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const css = await readFile(path.join(scriptDirectory, "theme.css"), "utf8");
const skinUICss = await readFile(path.join(scriptDirectory, "skin-ui.css"), "utf8");
const skinModel = createSkinModel();
const skinDirectory = path.join(scriptDirectory, "skins");
const bundledSkins = await Promise.all((await readdir(skinDirectory)).filter(name => name.endsWith(".style.json")).map(async name => skinModel.normalize(JSON.parse(await readFile(path.join(skinDirectory, name), "utf8")))));
const appearanceConfig = JSON.parse(await readFile(path.join(scriptDirectory, "appearance.json"), "utf8"));
const requestedThemeName = process.env.DOUBAO_THEME_NAME || appearanceConfig.defaultTheme?.id || "mira";
if (!/^[a-z0-9-]+$/.test(requestedThemeName)) throw new Error(`Invalid theme name: ${requestedThemeName}`);

const themeDirectory = path.join(scriptDirectory, "themes");
const themeFiles = (await readdir(themeDirectory)).filter((fileName) => /^[a-z0-9-]+\.json$/.test(fileName));
const themeConfigs = await Promise.all(themeFiles.map(async (fileName) => {
  const fallbackId = fileName.replace(/\.json$/, "");
  const theme = JSON.parse(await readFile(path.join(themeDirectory, fileName), "utf8"));
  theme.id = String(theme.id || fallbackId);
  theme.name = String(theme.name || theme.id);
  theme.baseMode = theme.baseMode === "light" ? "light" : "dark";
  if (!/^[a-z0-9-]+$/.test(theme.id)) throw new Error(`Invalid theme id: ${theme.id}`);
  if (Object.keys(theme.tokens || {}).length === 0) throw new Error(`Theme ${theme.id} has no tokens`);
  return theme;
}));
const themeOrder = new Map(["doubao-default", "doubao-dark", "trae", "mira", "aime", "claude", "linear"].map((id, index) => [id, index]));
themeConfigs.sort((left, right) =>
  (themeOrder.get(left.id) ?? 999) - (themeOrder.get(right.id) ?? 999)
  || left.name.localeCompare(right.name, "zh-CN")
);
if (new Set(themeConfigs.map((theme) => theme.id)).size !== themeConfigs.length) throw new Error("Theme ids must be unique");
const defaultTheme = themeConfigs.find((theme) => theme.id === requestedThemeName);
if (!defaultTheme) throw new Error(`Theme not found: ${requestedThemeName}`);

const toKebabCase = (value) => value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const themeVariables = themeConfigs.map((theme) =>
  `:root[data-doubao-theme="${theme.id}"] {\n${Object.entries(theme.tokens)
    .map(([name, value]) => `  --db-theme-${toKebabCase(name)}: ${String(value)};`)
    .join("\n")}\n}`
).join("\n");
const interVariable = await readFile(path.join(scriptDirectory, "assets", "InterVariable.woff2"));
const fontFaces = [`@font-face {
  font-family: "Doubao Linear Inter";
  src: url("data:font/woff2;base64,${interVariable.toString("base64")}") format("woff2");
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
}`];
const bundledCss = `${fontFaces.join("\n")}\n${themeVariables}\n${css}\n${skinUICss}`;
const port = process.env.DOUBAO_THEME_PORT || "9237";
const sessions = new Map();
const startedAt = Date.now();
let hasSeenTarget = false;
let lastTargetAt = Date.now();
let stopping = false;

const workshopBridge = createWorkshopBridge();
const updateBridge = createUpdateBridge({ enabled: process.env.DOUBAO_UPDATE_ENABLED === "1", version: process.env.DOUBAO_APP_VERSION || "" });
const injectionSource = `(() => {
  ${doubaoPageGuard}
  const STYLE_ID = "doubao-local-theme";
  const ADAPTED_SURFACE_CLASS = "doubao-theme-adapted-surface";
  const SETTINGS_LAYER_ID = "doubao-theme-settings-layer";
  const SETTINGS_TRIGGER_ID = "doubao-theme-settings-trigger";
  const SETTINGS_ENTRY_SEEN_KEY = "doubao-style-sidebar-entry-seen-v1";
  let settingsEntrySeen = false;
  try { settingsEntrySeen = localStorage.getItem(SETTINGS_ENTRY_SEEN_KEY) === "1"; } catch {}
  const WELCOME_IMAGE_ID = "doubao-theme-welcome-image";
  const DEFAULT_THEME_ID = ${JSON.stringify(defaultTheme.id)};
  const DEFAULT_THEME_REVISION = Number(${JSON.stringify(appearanceConfig.defaultTheme?.revision)}) || 0;
  const THEMES = ${JSON.stringify(themeConfigs)};
  const CSS_TEXT = ${JSON.stringify(bundledCss)};
  const APPEARANCE = ${JSON.stringify(appearanceConfig)};
  const installCleanInput = ${installCleanInput.toString()};
  const installUpdateControl = ${installUpdateControl.toString()};
  const skinModel = (${createSkinModel.toString()})();
  const installWorkshopControl = ${installWorkshopControl.toString()};
  const installSkinUI = ${installSkinUI.toString()};
  let skinUI;
  const skinRuntime = (${createSkinRuntime.toString()})(skinModel, ${JSON.stringify(bundledSkins)}, () => {
    if (!skinRuntime.active()) appearanceSettings = themeAppearance.sync(appearanceSettings, systemAppearanceMode());
    applyAppearance(); refreshSettingsPanel(); scheduleSurfaceAdaptation(document.documentElement);
  });
  const effectiveLayout = () => skinRuntime.active()?.layout || appearanceSettings;
  const THEME_MAP = new Map(THEMES.map((theme) => [theme.id, theme]));
  const COLOR_CONTROLS = Array.isArray(APPEARANCE.colorControls) ? APPEARANCE.colorControls : [];
  const TOGGLES = Array.isArray(APPEARANCE.toggles) ? APPEARANCE.toggles : [];
  const COLOR_KEYS = new Set(COLOR_CONTROLS.map((control) => control.key));
  const themeAppearance = (${createThemeAppearanceModel.toString()})(THEMES, DEFAULT_THEME_ID, COLOR_KEYS, APPEARANCE.systemTheme);
  const systemAppearanceMedia = window.matchMedia("(prefers-color-scheme: dark)");
  const systemAppearanceMode = () => systemAppearanceMedia.matches ? "dark" : "light";
  let themePickers = [];
  let pendingSystemAppearance = false;
  let welcomeUploadsPending = 0;
  let themeSaveError = "";
  const TOGGLE_KEYS = new Set(TOGGLES.map((control) => control.key));
  const LAYOUT_CONTROL_MAP = new Map(APPEARANCE.controls.map((control) => [control.key, control]));
  const WELCOME = APPEARANCE.welcome || {};
  const DEFAULT_WELCOME_TEXT = String(WELCOME.defaultText || "今天有什么工作要处理？");
  const MAX_WELCOME_TEXT_LENGTH = Number(WELCOME.maxTextLength) || 40;
  const MAX_WELCOME_IMAGE_BYTES = Number(WELCOME.maxImageBytes) || 2097152;
  const MAX_WELCOME_IMAGE_COUNT = Number(WELCOME.maxImageCount) || 10;
  const ACCEPTED_WELCOME_IMAGE_TYPES = new Set(Array.isArray(WELCOME.acceptedImageTypes) ? WELCOME.acceptedImageTypes : []);
  const WELCOME_IMAGE_DB_NAME = "doubao-style-assets-v1";
  const WELCOME_IMAGE_STORE_NAME = "welcomeImages";
  const WELCOME_IMAGE_LAYOUT = WELCOME.imageLayout || {};
  const DEFAULT_WELCOME_IMAGE_LAYOUT = Object.freeze({
    zoom: Number(WELCOME_IMAGE_LAYOUT.zoom) || 100,
    positionX: Number(WELCOME_IMAGE_LAYOUT.positionX) || 50,
    positionY: Number(WELCOME_IMAGE_LAYOUT.positionY) || 50
  });
  const WELCOME_IMAGE_ZOOM_MIN = Number.isFinite(Number(WELCOME_IMAGE_LAYOUT.zoomMin)) ? Number(WELCOME_IMAGE_LAYOUT.zoomMin) : 0;
  const WELCOME_IMAGE_ZOOM_MAX = Number(WELCOME_IMAGE_LAYOUT.zoomMax) || 300;
  const WELCOME_IMAGE_ZOOM_STEP = Number(WELCOME_IMAGE_LAYOUT.zoomStep) || 10;
  const INLINE_THEME_TOKENS = [
    "accent", "accentRgb", "accentHover", "accentHoverRgb", "accentPressed", "accentPressedRgb",
    "accentDeep", "link", "linkRgb", "linkHover", "background", "backgroundRgb", "sidebar",
    "surface", "surfaceRgb", "surfaceSecondary", "surfaceSecondaryRgb", "surfaceTertiary",
    "surfaceTertiaryRgb", "surfaceElevated", "surfaceElevatedRgb", "surfaceHover", "surfaceHoverRgb",
    "border", "borderRgb", "borderStrong", "foreground", "foregroundRgb", "selectionBackground", "scrollbar",
    "scrollbarHover", "userMessageBackground", "userMessageText"
  ];

  const toKebabCase = (value) => value.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
  const tokenProperty = (name) => "--db-theme-" + toKebabCase(name);
  const normalizeHex = (value) => {
    if (typeof value !== "string") return null;
    let raw = value.trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(raw)) raw = raw.split("").map((character) => character + character).join("");
    if (!/^[0-9a-f]{6}$/i.test(raw)) return null;
    return "#" + raw.toUpperCase();
  };
  const hexToRgb = (value) => {
    const normalized = normalizeHex(value);
    if (!normalized) return null;
    return [1, 3, 5].map((index) => parseInt(normalized.slice(index, index + 2), 16));
  };
  const rgbText = (value) => hexToRgb(value).join(", ");
  const mixHex = (source, target, weight) => {
    const sourceRgb = hexToRgb(source);
    const targetRgb = hexToRgb(target);
    const mixed = sourceRgb.map((value, index) => Math.round(value + (targetRgb[index] - value) * weight));
    return "#" + mixed.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
  };
  const setThemeToken = (root, name, value) => root.style.setProperty(tokenProperty(name), value);
  const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const welcomeImageAssetId = (value) => typeof value === "string" && /^asset:[a-z0-9-]{8,80}$/i.test(value)
    ? value.slice(6)
    : null;
  const isWelcomeImageValue = (value) => {
    if (value === "none") return true;
    if (welcomeImageAssetId(value)) return true;
    if (typeof value !== "string" || value.length > Math.ceil(MAX_WELCOME_IMAGE_BYTES * 1.4) + 128) return false;
    return /^data:image\\/(?:png|jpeg|webp|gif|avif);base64,/i.test(value);
  };
  const readWelcomeImageLibrary = (value) => {
    if (!Array.isArray(value)) return [];
    const result = [];
    const ids = new Set();
    for (const entry of value) {
      const id = typeof entry?.id === "string" && /^[a-z0-9-]{8,80}$/i.test(entry.id) ? entry.id : null;
      if (!id || ids.has(id)) continue;
      ids.add(id);
      result.push({
        id,
        name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim().slice(0, 80) : "已上传图片",
        type: ACCEPTED_WELCOME_IMAGE_TYPES.has(entry.type) ? entry.type : "image/jpeg",
        createdAt: Number.isFinite(Number(entry.createdAt)) ? Number(entry.createdAt) : 0
      });
      if (result.length >= MAX_WELCOME_IMAGE_COUNT) break;
    }
    return result;
  };
  const readThemeStringMap = (value, validator) => {
    const result = {};
    if (!value || typeof value !== "object") return result;
    for (const [themeId, entry] of Object.entries(value)) {
      if (THEME_MAP.has(themeId) && validator(entry)) result[themeId] = entry;
    }
    return result;
  };
  const clampNumber = (value, min, max, fallback) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return fallback;
    return Math.min(max, Math.max(min, numericValue));
  };
  const normalizeWelcomeImageLayout = (value) => ({
    zoom: clampNumber(value?.zoom, WELCOME_IMAGE_ZOOM_MIN, WELCOME_IMAGE_ZOOM_MAX, DEFAULT_WELCOME_IMAGE_LAYOUT.zoom),
    positionX: clampNumber(value?.positionX, 0, 100, DEFAULT_WELCOME_IMAGE_LAYOUT.positionX),
    positionY: clampNumber(value?.positionY, 0, 100, DEFAULT_WELCOME_IMAGE_LAYOUT.positionY)
  });
  const readThemeWelcomeLayoutMap = (value) => {
    const result = {};
    if (!value || typeof value !== "object") return result;
    for (const [themeId, entry] of Object.entries(value)) {
      if (THEME_MAP.has(themeId) && entry && typeof entry === "object") {
        result[themeId] = normalizeWelcomeImageLayout(entry);
      }
    }
    return result;
  };
  const clampSetting = (control, value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return control.default;
    return Math.min(control.max, Math.max(control.min, numericValue));
  };
  const makeDefaultSettings = (themeId = DEFAULT_THEME_ID) => ({
    ...Object.fromEntries(APPEARANCE.controls.map((control) => [control.key, control.default])),
    ...Object.fromEntries(TOGGLES.map((control) => [control.key, control.default])),
    defaultThemeRevision: DEFAULT_THEME_REVISION,
    ...themeAppearance.normalize({ themeId }, systemAppearanceMode()),
    welcomeTextByTheme: {},
    welcomeImageByTheme: {},
    welcomeImageLayoutByTheme: {},
    welcomeImageLibrary: []
  });
  const readSettings = () => {
    const defaults = makeDefaultSettings();
    try {
      const saved = JSON.parse(localStorage.getItem(APPEARANCE.storageKey) || "{}");
      const savedDefaultThemeRevision = Number.isInteger(Number(saved.defaultThemeRevision))
        ? Number(saved.defaultThemeRevision)
        : 0;
      const needsDefaultThemeMigration = savedDefaultThemeRevision < DEFAULT_THEME_REVISION;
      const themeId = needsDefaultThemeMigration
        ? defaults.themeId
        : (THEME_MAP.has(saved.themeId) ? saved.themeId : defaults.themeId);
      const customColors = {};
      if (!needsDefaultThemeMigration && saved.customColors && typeof saved.customColors === "object") {
        for (const [key, value] of Object.entries(saved.customColors)) {
          const normalized = COLOR_KEYS.has(key) ? normalizeHex(value) : null;
          if (normalized) customColors[key] = normalized;
        }
      }
      return {
        ...Object.fromEntries(APPEARANCE.controls.map((control) => [
          control.key,
          clampSetting(control, saved[control.key] ?? control.default)
        ])),
        ...Object.fromEntries(TOGGLES.map((control) => [
          control.key,
          typeof saved[control.key] === "boolean" ? saved[control.key] : control.default
        ])),
        defaultThemeRevision: DEFAULT_THEME_REVISION,
        ...themeAppearance.normalize({
          ...saved, themeId,
          ...(owns(saved, "customColors") ? { customColors } : {}),
          ...(needsDefaultThemeMigration ? { themeMode: "fixed", customColorsByTheme: {}, customColors: {} } : {})
        }, systemAppearanceMode()),
        welcomeTextByTheme: readThemeStringMap(
          saved.welcomeTextByTheme,
          (value) => typeof value === "string" && value.length <= MAX_WELCOME_TEXT_LENGTH
        ),
        welcomeImageByTheme: readThemeStringMap(saved.welcomeImageByTheme, isWelcomeImageValue),
        welcomeImageLayoutByTheme: readThemeWelcomeLayoutMap(saved.welcomeImageLayoutByTheme),
        welcomeImageLibrary: readWelcomeImageLibrary(saved.welcomeImageLibrary),
        ...(Number.isFinite(Number(saved.contentMaxWidth))
          ? { __legacyContentMaxWidth: Number(saved.contentMaxWidth) }
          : {}),
        ...(owns(saved, "sendShortcut") ? { __needsSendShortcutMigration: true } : {}),
        ...(owns(saved, "sidebarItemVisibility") ? { __needsSidebarSettingsMigration: true } : {}),
        ...(needsDefaultThemeMigration ? { __needsDefaultThemeMigration: true } : {})
      };
    } catch {
      return { ...defaults, __needsDefaultThemeMigration: true };
    }
  };

  let appearanceSettings = readSettings();
  const needsDefaultThemeMigration = appearanceSettings.__needsDefaultThemeMigration === true;
  const needsSendShortcutMigration = appearanceSettings.__needsSendShortcutMigration === true;
  delete appearanceSettings.__needsSendShortcutMigration;
  const needsSidebarSettingsMigration = appearanceSettings.__needsSidebarSettingsMigration === true;
  delete appearanceSettings.__needsDefaultThemeMigration;
  delete appearanceSettings.__needsSidebarSettingsMigration;
  let pendingLegacyContentMaxWidth = Number.isFinite(appearanceSettings.__legacyContentMaxWidth)
    ? appearanceSettings.__legacyContentMaxWidth
    : null;
  delete appearanceSettings.__legacyContentMaxWidth;
  const currentTheme = () => skinRuntime.active() || THEME_MAP.get(appearanceSettings.themeId) || THEME_MAP.get(DEFAULT_THEME_ID);
  const effectiveWelcomeText = () => {
    if (skinRuntime.active()) return skinRuntime.active().welcome.text;
    const themeId = currentTheme().id;
    return owns(appearanceSettings.welcomeTextByTheme, themeId)
      ? appearanceSettings.welcomeTextByTheme[themeId]
      : String(currentTheme().welcome?.text || DEFAULT_WELCOME_TEXT);
  };
  const effectiveWelcomeImage = () => {
    const skin = skinRuntime.active();
    if (skin) return skin.welcome.image === "none" ? "none" : skin.assets[skin.welcome.image.slice(6)];
    const themeId = currentTheme().id;
    return owns(appearanceSettings.welcomeImageByTheme, themeId)
      ? appearanceSettings.welcomeImageByTheme[themeId]
      : String(currentTheme().welcome?.image || "none");
  };
  const effectiveWelcomeImageLayout = () => {
    if (skinRuntime.active()) return { ...DEFAULT_WELCOME_IMAGE_LAYOUT };
    const themeId = currentTheme().id;
    return owns(appearanceSettings.welcomeImageLayoutByTheme, themeId)
      ? normalizeWelcomeImageLayout(appearanceSettings.welcomeImageLayoutByTheme[themeId])
      : { ...DEFAULT_WELCOME_IMAGE_LAYOUT };
  };
  const writeSettings = () => {
    try {
      appearanceSettings = themeAppearance.remember(appearanceSettings);
      localStorage.setItem(APPEARANCE.storageKey, JSON.stringify(appearanceSettings));
      return true;
    } catch {
      return false;
    }
  };
  if (needsDefaultThemeMigration || needsSidebarSettingsMigration || needsSendShortcutMigration) writeSettings();

  let welcomeImageDatabasePromise;
  const welcomeImageSourceCache = new Map();
  const openWelcomeImageDatabase = () => {
    if (welcomeImageDatabasePromise) return welcomeImageDatabasePromise;
    welcomeImageDatabasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(WELCOME_IMAGE_DB_NAME, 1);
      request.addEventListener("upgradeneeded", () => {
        if (!request.result.objectStoreNames.contains(WELCOME_IMAGE_STORE_NAME)) {
          request.result.createObjectStore(WELCOME_IMAGE_STORE_NAME, { keyPath: "id" });
        }
      });
      request.addEventListener("success", () => {
        request.result.addEventListener("versionchange", () => request.result.close());
        resolve(request.result);
      });
      request.addEventListener("error", () => reject(request.error || new Error("图片库打开失败")));
    });
    return welcomeImageDatabasePromise;
  };
  const readWelcomeImageRecord = async (id) => {
    const database = await openWelcomeImageDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(WELCOME_IMAGE_STORE_NAME, "readonly").objectStore(WELCOME_IMAGE_STORE_NAME).get(id);
      request.addEventListener("success", () => resolve(request.result || null));
      request.addEventListener("error", () => reject(request.error || new Error("图片读取失败")));
    });
  };
  const saveWelcomeImageRecord = async (record) => {
    const database = await openWelcomeImageDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(WELCOME_IMAGE_STORE_NAME, "readwrite");
      transaction.objectStore(WELCOME_IMAGE_STORE_NAME).put(record);
      transaction.addEventListener("complete", resolve);
      transaction.addEventListener("abort", () => reject(transaction.error || new Error("图片保存失败")));
      transaction.addEventListener("error", () => reject(transaction.error || new Error("图片保存失败")));
    });
    welcomeImageSourceCache.set(record.id, record.dataUrl);
  };
  const removeWelcomeImageRecord = async (id) => {
    const database = await openWelcomeImageDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(WELCOME_IMAGE_STORE_NAME, "readwrite");
      transaction.objectStore(WELCOME_IMAGE_STORE_NAME).delete(id);
      transaction.addEventListener("complete", resolve);
      transaction.addEventListener("abort", () => reject(transaction.error || new Error("图片删除失败")));
      transaction.addEventListener("error", () => reject(transaction.error || new Error("图片删除失败")));
    });
    welcomeImageSourceCache.delete(id);
  };
  const resolveWelcomeImageSource = async (asset) => {
    const id = welcomeImageAssetId(asset);
    if (!id) return asset;
    if (welcomeImageSourceCache.has(id)) return welcomeImageSourceCache.get(id);
    const record = await readWelcomeImageRecord(id);
    if (!record?.dataUrl || !isWelcomeImageValue(record.dataUrl)) return null;
    welcomeImageSourceCache.set(id, record.dataUrl);
    return record.dataUrl;
  };
  const createWelcomeImageId = () => "img-" + (crypto.randomUUID?.() || (Date.now().toString(36) + "-" + Math.random().toString(36).slice(2)));

  const applyAccentColor = (root, color) => {
    const hover = mixHex(color, "#FFFFFF", 0.12);
    const pressed = mixHex(color, "#000000", 0.13);
    const deep = mixHex(color, "#000000", 0.08);
    const link = mixHex(color, "#FFFFFF", 0.25);
    const linkHover = mixHex(color, "#FFFFFF", 0.38);
    setThemeToken(root, "accent", color);
    setThemeToken(root, "accentRgb", rgbText(color));
    setThemeToken(root, "accentHover", hover);
    setThemeToken(root, "accentHoverRgb", rgbText(hover));
    setThemeToken(root, "accentPressed", pressed);
    setThemeToken(root, "accentPressedRgb", rgbText(pressed));
    setThemeToken(root, "accentDeep", deep);
    setThemeToken(root, "selectionBackground", "rgba(" + rgbText(color) + ", 0.16)");
    setThemeToken(root, "link", link);
    setThemeToken(root, "linkRgb", rgbText(link));
    setThemeToken(root, "linkHover", linkHover);
  };
  const applyBackgroundColor = (root, color) => {
    const target = currentTheme().baseMode === "light" ? "#000000" : "#FFFFFF";
    const palette = {
      background: color,
      sidebar: mixHex(color, target, 0.025),
      surface: mixHex(color, target, 0.045),
      surfaceSecondary: mixHex(color, target, 0.028),
      surfaceTertiary: mixHex(color, target, 0.012),
      surfaceElevated: mixHex(color, target, 0.075),
      surfaceHover: mixHex(color, target, 0.105),
      border: mixHex(color, target, 0.15),
      borderStrong: mixHex(color, target, 0.22),
      scrollbar: mixHex(color, target, 0.25),
      scrollbarHover: mixHex(color, target, 0.35)
    };
    for (const [name, value] of Object.entries(palette)) {
      setThemeToken(root, name, value);
      if (["background", "surface", "surfaceSecondary", "surfaceTertiary", "surfaceElevated", "surfaceHover", "border"].includes(name)) {
        setThemeToken(root, name + "Rgb", rgbText(value));
      }
    }
  };
  const clearCustomThemeTokens = (root) => {
    for (const name of INLINE_THEME_TOKENS) root.style.removeProperty(tokenProperty(name));
  };
  const applyCustomColors = (root) => {
    const colors = appearanceSettings.customColors || {};
    if (colors.accent) applyAccentColor(root, colors.accent);
    if (colors.background) applyBackgroundColor(root, colors.background);
    if (colors.foreground) {
      setThemeToken(root, "foreground", colors.foreground);
      setThemeToken(root, "foregroundRgb", rgbText(colors.foreground));
    }
    if (colors.userMessageBackground) setThemeToken(root, "userMessageBackground", colors.userMessageBackground);
    if (colors.userMessageText) setThemeToken(root, "userMessageText", colors.userMessageText);
  };
  let contentGridFrame = 0;
  const updateContentGridWidth = () => {
    const root = document.documentElement;
    if (!root) return;
    const main = document.querySelector('main[data-container-name="main"]') || document.querySelector("main");
    let gutter = Number(effectiveLayout().contentGutter);
    if (!main || !Number.isFinite(gutter)) {
      root.style.removeProperty("--db-layout-content-grid-width");
      return;
    }
    const mainWidth = main.getBoundingClientRect().width;
    if (pendingLegacyContentMaxWidth !== null && !skinRuntime.active()) {
      const gutterControl = LAYOUT_CONTROL_MAP.get("contentGutter");
      const legacyGridWidth = Math.max(0, Math.min(pendingLegacyContentMaxWidth, mainWidth - (2 * gutter)));
      const equivalentGutter = (mainWidth - legacyGridWidth) / 2;
      const snappedGutter = Math.round(equivalentGutter / gutterControl.step) * gutterControl.step;
      appearanceSettings.contentGutter = clampSetting(gutterControl, Math.max(gutter, snappedGutter));
      gutter = appearanceSettings.contentGutter;
      pendingLegacyContentMaxWidth = null;
      root.style.setProperty(gutterControl.cssVariable, String(gutter) + gutterControl.unit);
      writeSettings();
      refreshSettingsPanel();
    }
    const minimumGridWidth = Math.min(320, mainWidth);
    const gridWidth = Math.max(minimumGridWidth, mainWidth - (2 * gutter));
    root.style.setProperty("--db-layout-content-grid-width", Math.round(gridWidth * 2) / 2 + "px");
  };
  const scheduleContentGridWidth = () => {
    if (contentGridFrame) cancelAnimationFrame(contentGridFrame);
    contentGridFrame = requestAnimationFrame(() => {
      contentGridFrame = 0;
      updateContentGridWidth();
    });
  };
  const observeContentGridWidth = () => {
    const main = document.querySelector('main[data-container-name="main"]') || document.querySelector("main");
    if (!main || window.__doubaoThemeContentResizeTarget === main) return;
    window.__doubaoThemeContentResizeObserver?.disconnect();
    window.__doubaoThemeContentResizeObserver = new ResizeObserver(() => scheduleContentGridWidth());
    window.__doubaoThemeContentResizeObserver.observe(main);
    window.__doubaoThemeContentResizeTarget = main;
    scheduleContentGridWidth();
  };
  const destroyWelcomeAnimation = (host) => {
    try { host?.__doubaoWelcomeAnimation?.destroy(); } catch {}
    if (host) host.__doubaoWelcomeAnimation = null;
  };
  const renderWelcomeAsset = (host, asset, emptyLabel = "", animateBuiltin = true) => {
    if (!(host instanceof HTMLElement) || host.__doubaoWelcomeAsset === asset) return;
    destroyWelcomeAnimation(host);
    host.replaceChildren();
    host.__doubaoWelcomeAsset = asset;
    host.dataset.welcomeAsset = asset === "builtin:mira-cat" ? "mira-cat" : asset === "none" ? "none" : "custom";
    const libraryAssetId = welcomeImageAssetId(asset);
    if (libraryAssetId) {
      if (emptyLabel) {
        const loading = document.createElement("span");
        loading.className = "doubao-theme-welcome-preview-empty";
        loading.textContent = "正在读取图片";
        host.appendChild(loading);
      }
      resolveWelcomeImageSource(asset).then((source) => {
        if (host.__doubaoWelcomeAsset !== asset) return;
        host.replaceChildren();
        if (!source) {
          const unavailable = document.createElement("span");
          unavailable.className = "doubao-theme-welcome-preview-empty";
          unavailable.textContent = "图片不可用";
          host.appendChild(unavailable);
          return;
        }
        const image = document.createElement("img");
        image.className = "doubao-theme-welcome-media";
        image.alt = "";
        image.setAttribute("aria-hidden", "true");
        image.addEventListener("load", () => applyWelcomeImageLayoutToHost(host), { once: true });
        image.src = source;
        host.appendChild(image);
      }).catch(() => {
        if (host.__doubaoWelcomeAsset !== asset) return;
        host.replaceChildren();
        const unavailable = document.createElement("span");
        unavailable.className = "doubao-theme-welcome-preview-empty";
        unavailable.textContent = "图片读取失败";
        host.appendChild(unavailable);
      });
      return;
    }
    if (asset === "none") {
      if (emptyLabel) {
        const empty = document.createElement("span");
        empty.className = "doubao-theme-welcome-preview-empty";
        empty.textContent = emptyLabel;
        host.appendChild(empty);
      }
      return;
    }
    const image = document.createElement("img");
    image.className = "doubao-theme-welcome-media";
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    image.addEventListener("load", () => applyWelcomeImageLayoutToHost(host), { once: true });
    image.src = asset;
    host.appendChild(image);
  };
  const positionCustomWelcomeImage = (host, image, layout) => {
    if (!(host instanceof HTMLElement) || !(image instanceof HTMLImageElement) || !image.naturalWidth || !image.naturalHeight) return false;
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const coverScale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
    const scale = coverScale * (layout.zoom / 100);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const travelX = rect.width - width;
    const travelY = rect.height - height;
    image.style.setProperty("inset", "auto", "important");
    image.style.setProperty("left", (travelX * (layout.positionX / 100)) + "px", "important");
    image.style.setProperty("top", (travelY * (layout.positionY / 100)) + "px", "important");
    image.style.setProperty("right", "auto", "important");
    image.style.setProperty("bottom", "auto", "important");
    image.style.setProperty("width", width + "px", "important");
    image.style.setProperty("height", height + "px", "important");
    image.style.setProperty("object-fit", "cover", "important");
    image.style.setProperty("object-position", layout.positionX + "% " + layout.positionY + "%", "important");
    return true;
  };
  const applyWelcomeImageLayoutToHost = (host) => {
    if (!(host instanceof HTMLElement)) return;
    const layout = effectiveWelcomeImageLayout();
    const welcomeImage = effectiveWelcomeImage();
    const croppable = welcomeImage !== "none" && welcomeImage !== "builtin:mira-cat";
    host.dataset.welcomeFit = croppable ? "cover" : "contain";
    host.dataset.welcomeCroppable = String(croppable);
    host.dataset.welcomeZoom = String(layout.zoom);
    host.style.setProperty("--db-welcome-image-fit", croppable ? "cover" : "contain");
    host.style.setProperty("--db-welcome-image-position-x", layout.positionX + "%");
    host.style.setProperty("--db-welcome-image-position-y", layout.positionY + "%");
    for (const media of host.querySelectorAll("img, canvas")) {
      media.style.setProperty("display", "block", "important");
      media.style.setProperty("position", "absolute", "important");
      media.style.setProperty("max-width", "none", "important");
      media.style.setProperty("max-height", "none", "important");
      media.style.removeProperty("transform");
      media.style.removeProperty("transform-origin");
      if (croppable && media instanceof HTMLImageElement && positionCustomWelcomeImage(host, media, layout)) continue;
      media.style.setProperty("inset", "0", "important");
      media.style.setProperty("width", "100%", "important");
      media.style.setProperty("height", "100%", "important");
      media.style.setProperty("object-fit", croppable ? "cover" : "contain", "important");
      media.style.setProperty("object-position", layout.positionX + "% " + layout.positionY + "%", "important");
    }
  };
  const syncWelcomePreview = () => {
    const text = document.querySelector(".doubao-theme-welcome-preview-text");
    const image = document.querySelector(".doubao-theme-welcome-preview-image");
    const cropFrame = document.querySelector(".doubao-theme-welcome-crop-frame");
    const resetCrop = document.querySelector("#doubao-theme-welcome-crop-center");
    const zoomOut = document.querySelector("#doubao-theme-welcome-zoom-out");
    const zoomIn = document.querySelector("#doubao-theme-welcome-zoom-in");
    const zoomValue = document.querySelector("#doubao-theme-welcome-zoom-value");
    const layer = document.getElementById(SETTINGS_LAYER_ID);
    if (layer?.hidden) {
      if (image) {
        destroyWelcomeAnimation(image);
        image.__doubaoWelcomeAsset = undefined;
      }
      return;
    }
    if (text) text.textContent = effectiveWelcomeText() || " ";
    if (image) {
      renderWelcomeAsset(image, effectiveWelcomeImage(), "无欢迎图", false);
      applyWelcomeImageLayoutToHost(image);
    }
    const croppable = effectiveWelcomeImage() !== "none" && effectiveWelcomeImage() !== "builtin:mira-cat";
    const layout = effectiveWelcomeImageLayout();
    if (cropFrame) {
      cropFrame.dataset.croppable = String(croppable);
      cropFrame.setAttribute("aria-disabled", String(!croppable));
    }
    if (resetCrop) resetCrop.disabled = !croppable;
    if (zoomOut) zoomOut.disabled = !croppable || layout.zoom <= WELCOME_IMAGE_ZOOM_MIN;
    if (zoomIn) zoomIn.disabled = !croppable || layout.zoom >= WELCOME_IMAGE_ZOOM_MAX;
    if (zoomValue) zoomValue.textContent = Math.round(layout.zoom) + "%";
  };
  const syncWelcomeSurface = () => {
    const greeting = document.querySelector("#flow-chat-guidance-page [class*='greeting-text-']");
    if (!(greeting instanceof HTMLElement)) return;
    const welcomeText = effectiveWelcomeText();
    if (greeting.textContent !== welcomeText) greeting.textContent = welcomeText;
    greeting.dataset.doubaoStyleWelcome = "true";
    const parent = greeting.parentElement;
    if (!(parent instanceof HTMLElement)) return;
    const welcomeImage = effectiveWelcomeImage();
    let host = document.getElementById(WELCOME_IMAGE_ID);
    if (welcomeImage === "none") {
      if (host) {
        destroyWelcomeAnimation(host);
        host.remove();
      }
      return;
    }
    if (!host || host.parentElement !== parent) {
      if (host) {
        destroyWelcomeAnimation(host);
        host.remove();
      }
      host = document.createElement("div");
      host.id = WELCOME_IMAGE_ID;
      host.className = "doubao-theme-welcome-image";
      host.setAttribute("aria-hidden", "true");
      parent.insertBefore(host, greeting);
    }
    renderWelcomeAsset(host, welcomeImage);
    applyWelcomeImageLayoutToHost(host);
  };
  let welcomeFrame = 0;
  const scheduleWelcomeSync = () => {
    if (welcomeFrame) return;
    welcomeFrame = requestAnimationFrame(() => {
      welcomeFrame = 0;
      syncWelcomeSurface();
      syncWelcomePreview();
    });
  };
  const applyAppearance = () => {
    const root = document.documentElement;
    if (!root) return;
    const theme = currentTheme();
    if (!skinRuntime.active()) appearanceSettings.themeId = theme.id;
    if (root.getAttribute("data-theme") !== theme.baseMode) root.setAttribute("data-theme", theme.baseMode);
    if (root.getAttribute("data-doubao-theme") !== theme.id) root.setAttribute("data-doubao-theme", theme.id);
    root.setAttribute("data-doubao-uniform-chat-typography", effectiveLayout().uniformChatTypography ? "true" : "false");
    root.setAttribute("data-doubao-chat-icons", effectiveLayout().showConversationIcons ? "visible" : "hidden");
    window.__doubaoThemeCleanInput?.sync();
    for (const control of APPEARANCE.controls) {
      const value = clampSetting(control, effectiveLayout()[control.key]);
      if (!skinRuntime.active()) appearanceSettings[control.key] = value;
      root.style.setProperty(control.cssVariable, String(value) + control.unit);
    }
    clearCustomThemeTokens(root);
    if (!skinRuntime.active()) applyCustomColors(root);
    skinRuntime.sync();
    observeContentGridWidth();
    updateContentGridWidth();
    scheduleWelcomeSync();
  };
  const effectiveColor = (key) => {
    const customized = skinRuntime.active() ? null : normalizeHex(appearanceSettings.customColors?.[key]);
    if (customized) return customized;
    return normalizeHex(currentTheme().tokens[key]) || "#000000";
  };
  const formatSetting = (control, value) => {
    const normalized = control.step < 1
      ? Number(value).toFixed(2).replace(/0+$/, "").replace(/\\.$/, "")
      : String(Math.round(value));
    return normalized + control.unit;
  };

  // Lucide paths, with a wider reset-arc opening for legibility at 16px.
  const LUCIDE_ICON_PATHS = Object.freeze({
    x: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
    chevronDown: '<path d="m6 9 6 6 6-6"></path>',
    rotateCcw: '<path d="M4.2 16.5A9 9 0 1 0 6.3 5.1L3 8"></path><path d="M3 3v5h5"></path>',
    trash2: '<path d="M3 6h18"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><path d="M19 6l-1 14c0 1-1 2-2 2H8c-1 0-2-1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="m17 8-5-5-5 5"></path><path d="M12 3v12"></path>'
  });
  const lucideIcon = (name) => '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + LUCIDE_ICON_PATHS[name] + '</svg>';
  const makeIconButton = (button, iconName, label) => {
    button.classList.add("doubao-theme-icon-button");
    button.innerHTML = lucideIcon(iconName);
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  };
  const prependButtonIcon = (button, iconName) => {
    button.classList.add("doubao-theme-button-with-icon");
    button.insertAdjacentHTML("afterbegin", lucideIcon(iconName));
  };

  const SETTINGS_PANEL_EDGE_GAP = 12;
  const readSettingsPanelOffset = (panel) => panel.__doubaoSettingsPanelOffset || { x: 0, y: 0 };
  const setSettingsPanelOffset = (panel, offset) => {
    const normalized = {
      x: Math.round(offset.x * 100) / 100,
      y: Math.round(offset.y * 100) / 100
    };
    panel.__doubaoSettingsPanelOffset = normalized;
    panel.style.setProperty("transform", "translate3d(" + normalized.x + "px, " + normalized.y + "px, 0)", "important");
  };
  const clampSettingsPanelToViewport = (panel) => {
    if (!(panel instanceof HTMLElement) || panel.closest("[hidden]")) return;
    const rect = panel.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const maxLeft = Math.max(SETTINGS_PANEL_EDGE_GAP, viewportWidth - SETTINGS_PANEL_EDGE_GAP - rect.width);
    const maxTop = Math.max(SETTINGS_PANEL_EDGE_GAP, viewportHeight - SETTINGS_PANEL_EDGE_GAP - rect.height);
    const nextLeft = Math.min(maxLeft, Math.max(SETTINGS_PANEL_EDGE_GAP, rect.left));
    const nextTop = Math.min(maxTop, Math.max(SETTINGS_PANEL_EDGE_GAP, rect.top));
    if (nextLeft === rect.left && nextTop === rect.top) return;
    const offset = readSettingsPanelOffset(panel);
    setSettingsPanelOffset(panel, {
      x: offset.x + nextLeft - rect.left,
      y: offset.y + nextTop - rect.top
    });
  };

  const closeSettings = () => {
    const layer = document.getElementById(SETTINGS_LAYER_ID) || settingsLayer;
    if (layer) {
      themePickers.forEach((picker) => picker.close());
      if (layer.matches(":popover-open")) layer.hidePopover();
      const wasOpen = !layer.hidden;
      layer.hidden = true;
      const returnFocus = settingsHost || settingsTrigger?.hidden ? settingsReturnFocus : settingsTrigger;
      if (wasOpen && returnFocus?.isConnected && !returnFocus.hidden) returnFocus.focus({ preventScroll: true });
      settingsReturnFocus = null;
      const previewImage = layer.querySelector(".doubao-theme-welcome-preview-image");
      destroyWelcomeAnimation(previewImage);
      if (previewImage) previewImage.__doubaoWelcomeAsset = undefined;
    }
  };
  const updateThemeSummary = () => {
    const summary = document.querySelector(".doubao-theme-settings-theme-name");
    if (!summary) return;
    const themeId = currentTheme().id;
    if (skinRuntime.active()) { summary.textContent = currentTheme().name + " · 完整皮肤"; return; }
    const customCount = Object.keys(appearanceSettings.customColors || {}).length
      + Number(owns(appearanceSettings.welcomeTextByTheme, themeId))
      + Number(owns(appearanceSettings.welcomeImageByTheme, themeId))
      + Number(owns(appearanceSettings.welcomeImageLayoutByTheme, themeId));
    summary.textContent = (appearanceSettings.themeMode === "system" ? "跟随系统 · " : "")
      + currentTheme().name + (customCount ? " · 已自定义 " + customCount + " 项" : "") + " · 自动保存在本机";
  };
  const syncWelcomeImageLibrary = () => {
    const panel = document.querySelector(".doubao-theme-settings-panel");
    const grid = panel?.querySelector(".doubao-theme-welcome-library-grid");
    if (!panel || !grid) return;
    const library = appearanceSettings.welcomeImageLibrary;
    const currentAsset = effectiveWelcomeImage();
    const count = panel.querySelector("#doubao-theme-welcome-library-count");
    const empty = panel.querySelector(".doubao-theme-welcome-library-empty");
    const upload = panel.querySelector("#doubao-theme-welcome-image-upload");
    if (count) count.textContent = library.length + " / " + MAX_WELCOME_IMAGE_COUNT;
    if (empty) empty.hidden = library.length > 0;
    if (upload) {
      upload.disabled = library.length >= MAX_WELCOME_IMAGE_COUNT;
      upload.setAttribute("aria-label", upload.disabled ? "图片库已满，请先删除一张图片" : "上传图片");
    }
    grid.replaceChildren();
    for (const [index, item] of library.entries()) {
      const card = document.createElement("div");
      card.className = "doubao-theme-welcome-library-item";
      card.dataset.imageId = item.id;
      const select = document.createElement("button");
      select.type = "button";
      select.className = "doubao-theme-welcome-library-card";
      select.dataset.asset = "asset:" + item.id;
      select.setAttribute("aria-pressed", String(currentAsset === "asset:" + item.id));
      select.setAttribute("aria-label", "使用图片 " + item.name);
      select.title = item.name;
      const thumbnail = document.createElement("span");
      thumbnail.className = "doubao-theme-welcome-library-thumbnail";
      const caption = document.createElement("span");
      caption.className = "doubao-theme-welcome-library-caption";
      caption.textContent = item.name || "图片 " + (index + 1);
      select.append(thumbnail, caption);
      select.addEventListener("click", () => {
        if (commitWelcomeImageSelection("asset:" + item.id)) setWelcomeStatus("已切换欢迎图");
      });
      resolveWelcomeImageSource("asset:" + item.id).then((source) => {
        if (!source || !thumbnail.isConnected) return;
        const image = document.createElement("img");
        image.alt = "";
        image.setAttribute("aria-hidden", "true");
        image.src = source;
        thumbnail.replaceChildren(image);
      }).catch(() => {});
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "doubao-theme-welcome-library-remove";
      makeIconButton(remove, "x", "删除图片 " + item.name);
      remove.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (await removeWelcomeLibraryImage(item.id)) setWelcomeStatus("图片已从素材库删除");
      });
      card.append(select, remove);
      grid.appendChild(card);
    }
    for (const choice of panel.querySelectorAll(".doubao-theme-welcome-builtin-card")) {
      choice.setAttribute("aria-pressed", String(choice.dataset.asset === currentAsset));
    }
  };
  const refreshSettingsPanel = () => {
    const panel = document.querySelector(".doubao-theme-settings-panel");
    if (!panel) return;
    skinUI?.refresh();
    themePickers.forEach((picker) => picker.refresh());
    const automatic = appearanceSettings.themeMode === "system";
    const systemSection = panel.querySelector(".doubao-theme-system-section");
    if (systemSection) systemSection.hidden = !automatic;
    const colorContext = panel.querySelector(".doubao-theme-color-context");
    if (colorContext) {
      colorContext.hidden = !automatic;
      colorContext.textContent = "正在调整：" + currentTheme().name + " · 颜色仅保存到这套 Style";
    }
    const saveStatus = panel.querySelector(".doubao-theme-save-status");
    if (saveStatus) { saveStatus.hidden = !themeSaveError; saveStatus.textContent = themeSaveError; }
    const footerNote = panel.querySelector(".doubao-theme-settings-footer-note");
    if (footerNote) footerNote.textContent = themeSaveError ? "更改未保存" : "更改已自动保存";
    for (const control of COLOR_CONTROLS) {
      const value = effectiveColor(control.key);
      const picker = panel.querySelector("#doubao-theme-color-" + control.key);
      const textInput = panel.querySelector("#doubao-theme-hex-" + control.key);
      if (picker) picker.value = value;
      if (textInput) {
        textInput.value = value;
        textInput.removeAttribute("aria-invalid");
      }
    }
    for (const control of APPEARANCE.controls) {
      const input = panel.querySelector("#doubao-theme-setting-" + control.key);
      const output = panel.querySelector("#doubao-theme-output-" + control.key);
      if (input) input.value = String(appearanceSettings[control.key]);
      if (output) output.textContent = formatSetting(control, appearanceSettings[control.key]);
    }
    for (const control of TOGGLES) {
      const input = panel.querySelector("#doubao-theme-toggle-" + control.key);
      const enabled = control.inverted ? !Boolean(appearanceSettings[control.key]) : Boolean(appearanceSettings[control.key]);
      if (input) input.checked = enabled;
    }
    const welcomeText = panel.querySelector("#doubao-theme-welcome-text");
    if (welcomeText && welcomeText.value !== effectiveWelcomeText()) welcomeText.value = effectiveWelcomeText();
    const welcomeTextCount = panel.querySelector("#doubao-theme-welcome-text-count");
    if (welcomeTextCount) welcomeTextCount.textContent = effectiveWelcomeText().length + " / " + MAX_WELCOME_TEXT_LENGTH;
    syncWelcomeImageLibrary();
    syncWelcomePreview();
    updateThemeSummary();
  };
  // Keep references when React removes the native modal, so our controls can be
  // rehomed instead of leaving stale dialogs or duplicate event handlers behind.
  let settingsTrigger = null;
  let settingsLayer = null;
  let settingsHost = null;
  let settingsReturnFocus = null;
  let settingsTitleAnchor = null;
  let settingsTitleHost = null;
  let settingsSidebar = null;
  const positionSettingsTrigger = () => {
    if (!settingsTrigger || !document.body) return;
    const host = Array.from(document.querySelectorAll('[data-testid="settings_modal"]'))
      .find((element) => element.getAttribute("data-state") !== "closed" && element.getClientRects().length) || null;
    if (settingsHost !== host) {
      closeSettings();
      settingsHost = host;
    }
    const sidebar = document.querySelector("#flow_chat_sidebar");
    const title = sidebar?.querySelector('[data-testid="workspace-switch-chip"]');
    const titleHost = title?.parentElement || null;
    if (settingsTitleAnchor !== title || settingsTitleHost !== titleHost || settingsSidebar !== sidebar) {
      settingsTitleHost?.removeAttribute("data-doubao-style-title-host");
      settingsTitleAnchor = title;
      settingsTitleHost = titleHost;
      settingsSidebar = sidebar;
      titleHost?.setAttribute("data-doubao-style-title-host", "");
      window.__doubaoThemeTriggerResizeObserver?.disconnect();
      const observer = new ResizeObserver(positionSettingsTrigger);
      window.__doubaoThemeTriggerResizeObserver = observer;
      for (const element of new Set([sidebar, title, titleHost])) if (element) observer.observe(element);
    }
    const triggerParent = titleHost || document.body;
    if (settingsTrigger.parentElement !== triggerParent) triggerParent.appendChild(settingsTrigger);
    const titleRect = title?.getBoundingClientRect();
    const sidebarRect = sidebar?.getBoundingClientRect();
    let showTrigger = !host && titleRect?.width > 0 && titleRect.height > 0
      && sidebarRect?.width >= 120 && sidebarRect.height >= 80
      && getComputedStyle(sidebar).pointerEvents !== "none";
    if (showTrigger) {
      const parentRect = titleHost.getBoundingClientRect();
      const left = titleRect.right + 4;
      const top = titleRect.top + (titleRect.height - 32) / 2;
      // Reserve only the empty space after the title; never cover native controls.
      const overlapsControl = Array.from(titleHost.querySelectorAll('button, a, [role="button"]')).some(control => {
        if (control === title || control === settingsTrigger || title.contains(control)) return false;
        const rect = control.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && left < rect.right && left + 32 > rect.left
          && top < rect.bottom && top + 32 > rect.top;
      });
      showTrigger = !overlapsControl && left + 32 <= sidebarRect.right - 8;
      settingsTrigger.style.setProperty("left", (left - parentRect.left - titleHost.clientLeft) + "px", "important");
      settingsTrigger.style.setProperty("top", (top - parentRect.top - titleHost.clientTop) + "px", "important");
    }
    settingsTrigger.hidden = !showTrigger;
    const parent = host || document.body;
    if (settingsLayer && settingsLayer.parentElement !== parent) {
      // A native settings dialog traps focus. Keep Style inside that focus scope;
      // its popover top layer avoids the native modal's transform and clipping.
      if (settingsLayer.matches(":popover-open")) settingsLayer.hidePopover();
      settingsLayer.hidden = true;
      parent.appendChild(settingsLayer);
    }
    // Radix can hide our body-level nodes before they move into its dialog.
    // Clear only our own stale accessibility markers after entering that scope.
    const hiddenByNativeDialog = settingsLayer?.querySelectorAll("[data-aria-hidden]") || [];
    for (const control of [!host && settingsTrigger, settingsLayer, ...hiddenByNativeDialog]) {
      if (!control) continue;
      control.removeAttribute("aria-hidden");
      control.removeAttribute("data-aria-hidden");
    }
  };
  const openSettings = () => {
    installSettingsPanel();
    const layer = document.getElementById(SETTINGS_LAYER_ID);
    if (!layer) return false;
    positionSettingsTrigger();
    if (!layer.contains(document.activeElement)) settingsReturnFocus = document.activeElement;
    layer.hidden = false;
    layer.showPopover();
    refreshSettingsPanel();
    requestAnimationFrame(() => {
      positionSettingsTrigger();
      clampSettingsPanelToViewport(layer.querySelector(".doubao-theme-settings-panel"));
    });
    layer.querySelector('.doubao-theme-settings-tab[aria-selected="true"]')?.focus();
    return true;
  };
  const setWelcomeStatus = (message, isError = false) => {
    const status = document.querySelector(".doubao-theme-welcome-status");
    if (!status) return;
    status.textContent = message;
    status.dataset.error = String(isError);
  };
  const commitWelcomeValue = (mapKey, value) => {
    const themeId = currentTheme().id;
    const map = appearanceSettings[mapKey];
    const hadPrevious = owns(map, themeId);
    const previous = map[themeId];
    if (value === undefined) delete map[themeId];
    else map[themeId] = value;
    applyAppearance();
    if (!writeSettings()) {
      if (hadPrevious) map[themeId] = previous;
      else delete map[themeId];
      applyAppearance();
      refreshSettingsPanel();
      setWelcomeStatus("保存失败，请换一张更小的图片", true);
      return false;
    }
    refreshSettingsPanel();
    return true;
  };
  const previewWelcomeImageLayout = (patch) => {
    const themeId = currentTheme().id;
    appearanceSettings.welcomeImageLayoutByTheme[themeId] = normalizeWelcomeImageLayout({
      ...effectiveWelcomeImageLayout(),
      ...patch
    });
    syncWelcomeSurface();
    syncWelcomePreview();
    return appearanceSettings.welcomeImageLayoutByTheme[themeId];
  };
  const commitWelcomeImageLayout = (patch) => {
    const nextLayout = normalizeWelcomeImageLayout({ ...effectiveWelcomeImageLayout(), ...patch });
    return commitWelcomeValue("welcomeImageLayoutByTheme", nextLayout);
  };
  const getWelcomeCropTravel = (host) => {
    const image = host?.querySelector("img");
    if (!(host instanceof HTMLElement) || !(image instanceof HTMLImageElement) || !image.naturalWidth || !image.naturalHeight) {
      return { x: 0, y: 0 };
    }
    const rect = host.getBoundingClientRect();
    const coverScale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight) * (effectiveWelcomeImageLayout().zoom / 100);
    return {
      x: (image.naturalWidth * coverScale) - rect.width,
      y: (image.naturalHeight * coverScale) - rect.height
    };
  };
  const moveWelcomeCrop = (host, startLayout, deltaX, deltaY) => {
    const travel = getWelcomeCropTravel(host);
    return previewWelcomeImageLayout({
      positionX: Math.abs(travel.x) > 0.5 ? startLayout.positionX - ((deltaX / travel.x) * 100) : startLayout.positionX,
      positionY: Math.abs(travel.y) > 0.5 ? startLayout.positionY - ((deltaY / travel.y) * 100) : startLayout.positionY
    });
  };
  const resetWelcomeImageAndLayout = () => {
    const themeId = currentTheme().id;
    delete appearanceSettings.welcomeImageByTheme[themeId];
    delete appearanceSettings.welcomeImageLayoutByTheme[themeId];
    applyAppearance();
    if (!writeSettings()) return false;
    refreshSettingsPanel();
    return true;
  };
  const commitWelcomeImageSelection = (value) => {
    const themeId = currentTheme().id;
    delete appearanceSettings.welcomeImageLayoutByTheme[themeId];
    return commitWelcomeValue("welcomeImageByTheme", value);
  };
  const commitWelcomeImageUpload = async (file, dataUrl) => {
    if (appearanceSettings.welcomeImageLibrary.length >= MAX_WELCOME_IMAGE_COUNT) return false;
    const id = createWelcomeImageId();
    const metadata = {
      id,
      name: String(file?.name || "已上传图片").trim().slice(0, 80) || "已上传图片",
      type: ACCEPTED_WELCOME_IMAGE_TYPES.has(file?.type) ? file.type : "image/jpeg",
      createdAt: Date.now()
    };
    await saveWelcomeImageRecord({ ...metadata, dataUrl });
    const themeId = currentTheme().id;
    const previousLibrary = appearanceSettings.welcomeImageLibrary;
    const previousSelection = appearanceSettings.welcomeImageByTheme[themeId];
    const hadSelection = owns(appearanceSettings.welcomeImageByTheme, themeId);
    const previousLayout = appearanceSettings.welcomeImageLayoutByTheme[themeId];
    const hadLayout = owns(appearanceSettings.welcomeImageLayoutByTheme, themeId);
    appearanceSettings.welcomeImageLibrary = [metadata, ...previousLibrary];
    appearanceSettings.welcomeImageByTheme[themeId] = "asset:" + id;
    delete appearanceSettings.welcomeImageLayoutByTheme[themeId];
    applyAppearance();
    if (!writeSettings()) {
      appearanceSettings.welcomeImageLibrary = previousLibrary;
      if (hadSelection) appearanceSettings.welcomeImageByTheme[themeId] = previousSelection;
      else delete appearanceSettings.welcomeImageByTheme[themeId];
      if (hadLayout) appearanceSettings.welcomeImageLayoutByTheme[themeId] = previousLayout;
      else delete appearanceSettings.welcomeImageLayoutByTheme[themeId];
      applyAppearance();
      await removeWelcomeImageRecord(id).catch(() => {});
      refreshSettingsPanel();
      return false;
    }
    refreshSettingsPanel();
    return true;
  };
  const removeWelcomeLibraryImage = async (id) => {
    if (!appearanceSettings.welcomeImageLibrary.some((item) => item.id === id)) return false;
    const previousLibrary = appearanceSettings.welcomeImageLibrary;
    const previousSelections = { ...appearanceSettings.welcomeImageByTheme };
    const previousLayouts = { ...appearanceSettings.welcomeImageLayoutByTheme };
    appearanceSettings.welcomeImageLibrary = previousLibrary.filter((item) => item.id !== id);
    for (const [themeId, value] of Object.entries(appearanceSettings.welcomeImageByTheme)) {
      if (value !== "asset:" + id) continue;
      delete appearanceSettings.welcomeImageByTheme[themeId];
      delete appearanceSettings.welcomeImageLayoutByTheme[themeId];
    }
    applyAppearance();
    if (!writeSettings()) {
      appearanceSettings.welcomeImageLibrary = previousLibrary;
      appearanceSettings.welcomeImageByTheme = previousSelections;
      appearanceSettings.welcomeImageLayoutByTheme = previousLayouts;
      applyAppearance();
      refreshSettingsPanel();
      setWelcomeStatus("删除失败，请稍后再试", true);
      return false;
    }
    await removeWelcomeImageRecord(id).catch(() => {});
    refreshSettingsPanel();
    return true;
  };
  let legacyWelcomeImageMigrationPromise;
  const migrateLegacyWelcomeImages = () => {
    if (legacyWelcomeImageMigrationPromise) return legacyWelcomeImageMigrationPromise;
    legacyWelcomeImageMigrationPromise = (async () => {
      const legacyEntries = Object.entries(appearanceSettings.welcomeImageByTheme)
        .filter(([, value]) => typeof value === "string" && value.startsWith("data:image/"));
      if (!legacyEntries.length) return false;
      const previousLibrary = appearanceSettings.welcomeImageLibrary;
      const previousSelections = { ...appearanceSettings.welcomeImageByTheme };
      const nextLibrary = [...previousLibrary];
      const replacements = new Map();
      for (const [, dataUrl] of legacyEntries) {
        if (replacements.has(dataUrl) || nextLibrary.length >= MAX_WELCOME_IMAGE_COUNT) continue;
        const id = createWelcomeImageId();
        const type = dataUrl.slice(5, dataUrl.indexOf(";"));
        const metadata = { id, name: "旧欢迎图", type, createdAt: Date.now() };
        await saveWelcomeImageRecord({ ...metadata, dataUrl });
        nextLibrary.push(metadata);
        replacements.set(dataUrl, "asset:" + id);
      }
      if (!replacements.size) return false;
      appearanceSettings.welcomeImageLibrary = nextLibrary;
      for (const [themeId, dataUrl] of legacyEntries) {
        if (replacements.has(dataUrl)) appearanceSettings.welcomeImageByTheme[themeId] = replacements.get(dataUrl);
      }
      if (!writeSettings()) {
        appearanceSettings.welcomeImageLibrary = previousLibrary;
        appearanceSettings.welcomeImageByTheme = previousSelections;
        return false;
      }
      applyAppearance();
      refreshSettingsPanel();
      return true;
    })().catch(() => false);
    return legacyWelcomeImageMigrationPromise;
  };
  const resetCurrentThemeSettings = () => {
    if (skinRuntime.active()) return;
    const themeId = currentTheme().id;
    const welcomeTextByTheme = { ...appearanceSettings.welcomeTextByTheme };
    const welcomeImageByTheme = { ...appearanceSettings.welcomeImageByTheme };
    const welcomeImageLayoutByTheme = { ...appearanceSettings.welcomeImageLayoutByTheme };
    const welcomeImageLibrary = appearanceSettings.welcomeImageLibrary.map((item) => ({ ...item }));
    delete welcomeTextByTheme[themeId];
    delete welcomeImageByTheme[themeId];
    delete welcomeImageLayoutByTheme[themeId];
    const { themeMode, themePair, customColorsByTheme } = themeAppearance.remember(appearanceSettings);
    appearanceSettings = {
      ...makeDefaultSettings(themeId), themeMode, themePair,
      customColorsByTheme: { ...customColorsByTheme, [themeId]: {} },
      welcomeTextByTheme, welcomeImageByTheme, welcomeImageLayoutByTheme, welcomeImageLibrary
    };
  };

  const commitThemeAppearance = (next) => {
    if (!next) return false;
    const previous = appearanceSettings;
    appearanceSettings = next;
    const saved = writeSettings();
    if (!saved) appearanceSettings = previous;
    themeSaveError = saved ? "" : "无法保存 Style 设置，本次更改未生效，请检查本机存储空间。";
    applyAppearance();
    refreshSettingsPanel();
    scheduleSurfaceAdaptation(document.documentElement);
    return saved;
  };
  const restoreAdjustableStyle = () => {
    skinRuntime.select(null);
    syncSystemAppearance();
    return true;
  };
  const selectThemeAppearance = (value) => {
    const next = themeAppearance.select(appearanceSettings, value, systemAppearanceMode());
    if (!next) return false;
    const previousSkin = skinRuntime.active()?.id;
    try { if (previousSkin) skinRuntime.select(null); }
    catch (error) { themeSaveError = error.message; refreshSettingsPanel(); return false; }
    const saved = commitThemeAppearance(next);
    if (!saved && previousSkin) { try { skinRuntime.select(previousSkin); } catch {} }
    return saved;
  };
  const setThemePair = (mode, id) => !skinRuntime.active() && commitThemeAppearance(
    themeAppearance.setPair(appearanceSettings, mode, id, systemAppearanceMode())
  );
  const syncSystemAppearance = () => {
    if (skinRuntime.active()) { pendingSystemAppearance = false; return; }
    if (appearanceSettings.themeMode !== "system") { pendingSystemAppearance = false; return; }
    if (themeAppearance.resolve(appearanceSettings, systemAppearanceMode()) === appearanceSettings.themeId) {
      pendingSystemAppearance = false;
      return;
    }
    const panel = document.querySelector(".doubao-theme-settings-panel");
    const editing = panel && !panel.closest("[hidden]") && (
      (panel.contains(document.activeElement) && document.activeElement.matches("input, textarea"))
      || panel.querySelector(".is-dragging")
    );
    if (editing || welcomeUploadsPending) { pendingSystemAppearance = true; return; }
    pendingSystemAppearance = false;
    // Mode and pairing are already saved. A media change need not write storage.
    appearanceSettings = themeAppearance.sync(appearanceSettings, systemAppearanceMode());
    applyAppearance();
    refreshSettingsPanel();
    scheduleSurfaceAdaptation(document.documentElement);
  };

  const installSettingsPanel = () => {
    if (!document.body) return false;
    let trigger = document.getElementById(SETTINGS_TRIGGER_ID);
    if (!trigger) {
      trigger = document.createElement("button");
      trigger.id = SETTINGS_TRIGGER_ID;
      trigger.className = "doubao-theme-settings-trigger";
      trigger.hidden = true;
      trigger.dataset.discovered = String(settingsEntrySeen);
      settingsTrigger = trigger;
      trigger.type = "button";
      trigger.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><g><path fill="#FF3B30" d="M12 12C10.4 9.6 9.8 6.4 11.2 3.4c.4-.8 1.2-.8 1.6 0 1.4 3 0.8 6.2-.8 8.6Z" /><path fill="#FF6B00" transform="rotate(30 12 12)" d="M12 12C10.4 9.6 9.8 6.4 11.2 3.4c.4-.8 1.2-.8 1.6 0 1.4 3 0.8 6.2-.8 8.6Z" /><path fill="#FFB000" transform="rotate(60 12 12)" d="M12 12C10.4 9.6 9.8 6.4 11.2 3.4c.4-.8 1.2-.8 1.6 0 1.4 3 0.8 6.2-.8 8.6Z" /><path fill="#FFD60A" transform="rotate(90 12 12)" d="M12 12C10.4 9.6 9.8 6.4 11.2 3.4c.4-.8 1.2-.8 1.6 0 1.4 3 0.8 6.2-.8 8.6Z" /><path fill="#B7D500" transform="rotate(120 12 12)" d="M12 12C10.4 9.6 9.8 6.4 11.2 3.4c.4-.8 1.2-.8 1.6 0 1.4 3 0.8 6.2-.8 8.6Z" /><path fill="#34C759" transform="rotate(150 12 12)" d="M12 12C10.4 9.6 9.8 6.4 11.2 3.4c.4-.8 1.2-.8 1.6 0 1.4 3 0.8 6.2-.8 8.6Z" /><path fill="#00B894" transform="rotate(180 12 12)" d="M12 12C10.4 9.6 9.8 6.4 11.2 3.4c.4-.8 1.2-.8 1.6 0 1.4 3 0.8 6.2-.8 8.6Z" /><path fill="#00A7C4" transform="rotate(210 12 12)" d="M12 12C10.4 9.6 9.8 6.4 11.2 3.4c.4-.8 1.2-.8 1.6 0 1.4 3 0.8 6.2-.8 8.6Z" /><path fill="#007AFF" transform="rotate(240 12 12)" d="M12 12C10.4 9.6 9.8 6.4 11.2 3.4c.4-.8 1.2-.8 1.6 0 1.4 3 0.8 6.2-.8 8.6Z" /><path fill="#2948C7" transform="rotate(270 12 12)" d="M12 12C10.4 9.6 9.8 6.4 11.2 3.4c.4-.8 1.2-.8 1.6 0 1.4 3 0.8 6.2-.8 8.6Z" /><path fill="#7B2CBF" transform="rotate(300 12 12)" d="M12 12C10.4 9.6 9.8 6.4 11.2 3.4c.4-.8 1.2-.8 1.6 0 1.4 3 0.8 6.2-.8 8.6Z" /><path fill="#D6007F" transform="rotate(330 12 12)" d="M12 12C10.4 9.6 9.8 6.4 11.2 3.4c.4-.8 1.2-.8 1.6 0 1.4 3 0.8 6.2-.8 8.6Z" /></g></svg>';
      trigger.setAttribute("aria-label", "打开豆Style");
      trigger.setAttribute("title", "Style");
      trigger.addEventListener("click", () => {
        if (!openSettings()) return;
        settingsEntrySeen = true;
        trigger.dataset.discovered = "true";
        // Finding the entry is separate from theme preferences and imports.
        try { localStorage.setItem(SETTINGS_ENTRY_SEEN_KEY, "1"); } catch {}
      });
      document.body.appendChild(trigger);
      requestAnimationFrame(positionSettingsTrigger);
    }
    if (document.getElementById(SETTINGS_LAYER_ID)) return true;

    const layer = document.createElement("div");
    layer.id = SETTINGS_LAYER_ID;
    settingsLayer = layer;
    layer.setAttribute("popover", "manual");
    layer.className = "doubao-theme-settings-layer";
    layer.hidden = true;
    layer.setAttribute("role", "presentation");
    const panel = document.createElement("section");
    panel.className = "doubao-theme-settings-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "doubao-theme-settings-title");

    const header = document.createElement("header");
    header.className = "doubao-theme-settings-header";
    header.setAttribute("aria-label", "拖动设置窗口");
    const headingGroup = document.createElement("div");
    const title = document.createElement("h2");
    title.id = "doubao-theme-settings-title";
    title.className = "doubao-theme-settings-title";
    title.textContent = "选择你的 Style";
    const themeNameElement = document.createElement("p");
    themeNameElement.className = "doubao-theme-settings-theme-name";
    headingGroup.append(title, themeNameElement);
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "doubao-theme-settings-close";
    makeIconButton(closeButton, "x", "关闭 Style 设置");
    closeButton.addEventListener("click", closeSettings);
    header.append(headingGroup, closeButton);
    const endPanelDrag = (event) => {
      const drag = panel.__doubaoSettingsPanelDrag;
      if (!drag || (event && drag.pointerId !== event.pointerId)) return;
      panel.__doubaoSettingsPanelDrag = null;
      panel.classList.remove("is-dragging");
      try {
        if (header.hasPointerCapture(drag.pointerId)) header.releasePointerCapture(drag.pointerId);
      } catch {}
    };
    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest("button, a, input, select, textarea")) return;
      const rect = panel.getBoundingClientRect();
      panel.__doubaoSettingsPanelDrag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        rect,
        offset: { ...readSettingsPanelOffset(panel) }
      };
      panel.classList.add("is-dragging");
      try { header.setPointerCapture(event.pointerId); } catch {}
      event.preventDefault();
    });
    header.addEventListener("pointermove", (event) => {
      const drag = panel.__doubaoSettingsPanelDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const maxLeft = Math.max(SETTINGS_PANEL_EDGE_GAP, viewportWidth - SETTINGS_PANEL_EDGE_GAP - drag.rect.width);
      const maxTop = Math.max(SETTINGS_PANEL_EDGE_GAP, viewportHeight - SETTINGS_PANEL_EDGE_GAP - drag.rect.height);
      const left = Math.min(maxLeft, Math.max(SETTINGS_PANEL_EDGE_GAP, drag.rect.left + event.clientX - drag.x));
      const top = Math.min(maxTop, Math.max(SETTINGS_PANEL_EDGE_GAP, drag.rect.top + event.clientY - drag.y));
      setSettingsPanelOffset(panel, {
        x: drag.offset.x + left - drag.rect.left,
        y: drag.offset.y + top - drag.rect.top
      });
      event.preventDefault();
    });
    header.addEventListener("pointerup", endPanelDrag);
    header.addEventListener("pointercancel", endPanelDrag);
    header.addEventListener("lostpointercapture", endPanelDrag);

    const tabs = document.createElement("div");
    tabs.className = "doubao-theme-settings-tabs";
    tabs.setAttribute("role", "tablist");
    const tabDefinitions = [
      { id: "colors", label: "Style 配色" },
      { id: "layout", label: "排版布局" },
      { id: "welcome", label: "欢迎页" }
    ];
    const panes = new Map();
    const setActiveTab = (activeId) => {
      for (const definition of tabDefinitions) {
        const button = tabs.querySelector("[data-tab='" + definition.id + "']");
        const pane = panes.get(definition.id);
        const active = definition.id === activeId;
        if (button) {
          button.setAttribute("aria-selected", String(active));
          button.tabIndex = active ? 0 : -1;
        }
        if (pane) pane.hidden = !active;
      }
    };
    for (const definition of tabDefinitions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "doubao-theme-settings-tab";
      button.dataset.tab = definition.id;
      button.setAttribute("role", "tab");
      button.id = "doubao-theme-tab-" + definition.id;
      button.setAttribute("aria-controls", "doubao-theme-pane-" + definition.id);
      button.textContent = definition.label;
      button.addEventListener("click", () => setActiveTab(definition.id));
      tabs.appendChild(button);
    }
    tabs.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = tabDefinitions.findIndex((definition) => definition.id === document.activeElement?.dataset.tab);
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabDefinitions.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabDefinitions.length) % tabDefinitions.length;
      const nextTab = tabDefinitions[nextIndex];
      setActiveTab(nextTab.id);
      tabs.querySelector("[data-tab='" + nextTab.id + "']")?.focus();
    });

    const content = document.createElement("div");
    content.className = "doubao-theme-settings-content";
    const colorsPane = document.createElement("div");
    colorsPane.id = "doubao-theme-pane-colors";
    colorsPane.className = "doubao-theme-settings-pane";
    colorsPane.setAttribute("role", "tabpanel");
    colorsPane.setAttribute("aria-labelledby", "doubao-theme-tab-colors");
    panes.set("colors", colorsPane);

    const presetRow = document.createElement("div");
    presetRow.className = "doubao-theme-preset-row";
    const presetCopy = document.createElement("div");
    presetCopy.className = "doubao-theme-setting-copy";
    const presetLabel = document.createElement("label");
    presetLabel.className = "doubao-theme-setting-label";
    presetLabel.htmlFor = "doubao-theme-preset-button";
    presetLabel.textContent = "Style";
    const presetDescription = document.createElement("span");
    presetDescription.className = "doubao-theme-setting-description";
    presetDescription.textContent = "固定一套 Style，或跟随系统自动切换";
    presetCopy.append(presetLabel, presetDescription);
    themePickers = [];
    const createThemePicker = (id, label, options, getValue, onChange) => {
      const themeSelect = document.createElement("select");
      themeSelect.id = id;
      themeSelect.className = "doubao-theme-preset-select";
      themeSelect.tabIndex = -1;
      themeSelect.setAttribute("aria-hidden", "true");
      for (const theme of options) {
        const option = document.createElement("option");
        option.value = theme.id;
        option.textContent = theme.name;
        themeSelect.appendChild(option);
      }
      themeSelect.addEventListener("change", () => {
        onChange(themeSelect.value);
      });
      const presetControl = document.createElement("div");
      presetControl.className = "doubao-theme-preset-control";
      const presetButton = document.createElement("button");
      presetButton.type = "button";
      presetButton.id = id + "-button";
      presetButton.className = "doubao-theme-preset-button";
      presetButton.setAttribute("aria-haspopup", "listbox");
      presetButton.setAttribute("aria-expanded", "false");
      presetButton.setAttribute("aria-controls", id + "-menu");
      const presetValue = document.createElement("span");
      presetValue.className = "doubao-theme-preset-value";
      const presetChevron = document.createElement("span");
      presetChevron.className = "doubao-theme-preset-chevron";
      presetChevron.setAttribute("aria-hidden", "true");
      presetChevron.innerHTML = lucideIcon("chevronDown");
      presetButton.append(presetValue, presetChevron);
      const presetMenu = document.createElement("div");
      presetMenu.id = id + "-menu";
      presetMenu.className = "doubao-theme-preset-menu";
      presetMenu.setAttribute("role", "listbox");
      presetMenu.setAttribute("aria-label", label);
      presetMenu.hidden = true;
      const presetOptions = [];
      const closePresetMenu = (returnFocus = false) => {
        presetMenu.hidden = true;
        presetButton.setAttribute("aria-expanded", "false");
        if (returnFocus) presetButton.focus();
      };
      const openPresetMenu = (focusIndex = options.findIndex((theme) => theme.id === themeSelect.value)) => {
        themePickers.forEach((picker) => picker.close());
        presetMenu.hidden = false;
        presetButton.setAttribute("aria-expanded", "true");
        const index = Math.max(0, Math.min(presetOptions.length - 1, focusIndex));
        presetOptions[index]?.focus();
      };
      const selectPreset = (themeId) => {
        if (!options.some((theme) => theme.id === themeId)) return;
        themeSelect.value = themeId;
        themeSelect.dispatchEvent(new Event("change", { bubbles: true }));
        closePresetMenu(true);
      };
      for (const theme of options) {
        const optionButton = document.createElement("button");
        optionButton.type = "button";
        optionButton.className = "doubao-theme-preset-option";
        optionButton.dataset.themeId = theme.id;
        optionButton.setAttribute("role", "option");
        optionButton.textContent = theme.name;
        optionButton.addEventListener("click", () => selectPreset(theme.id));
        presetOptions.push(optionButton);
        presetMenu.appendChild(optionButton);
      }
      presetButton.addEventListener("click", () => {
        if (presetMenu.hidden) openPresetMenu();
        else closePresetMenu();
      });
      presetButton.addEventListener("keydown", (event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Home") openPresetMenu(0);
        else if (event.key === "End") openPresetMenu(presetOptions.length - 1);
        else {
          const selectedIndex = options.findIndex((theme) => theme.id === themeSelect.value);
          openPresetMenu(selectedIndex + (event.key === "ArrowDown" ? 1 : -1));
        }
      });
      presetMenu.addEventListener("keydown", (event) => {
        const currentIndex = presetOptions.indexOf(document.activeElement);
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closePresetMenu(true);
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === "Home"
          ? 0
          : event.key === "End"
            ? presetOptions.length - 1
            : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + presetOptions.length) % presetOptions.length;
        presetOptions[nextIndex]?.focus();
      });
      presetControl.addEventListener("focusout", (event) => {
        if (!presetControl.contains(event.relatedTarget)) closePresetMenu();
      });
      presetControl.append(themeSelect, presetButton, presetMenu);
      themePickers.push({
        element: presetControl, close: closePresetMenu,
        refresh: () => {
          themeSelect.value = getValue();
          const selected = options.find((theme) => theme.id === getValue());
          presetValue.textContent = selected?.name || "";
          presetButton.setAttribute("aria-label", label + "，当前 " + (selected?.name || ""));
          presetOptions.forEach((option) => {
            const selected = option.dataset.themeId === getValue();
            option.setAttribute("aria-selected", String(selected));
            option.tabIndex = selected ? 0 : -1;
          });
        }
      });
      return presetControl;
    };
    const presetControl = createThemePicker("doubao-theme-preset", "选择 Style",
      [{ id: "system", name: "跟随系统" }, ...THEMES],
      () => appearanceSettings.themeMode === "system" ? "system" : appearanceSettings.themeId,
      selectThemeAppearance);
    presetRow.append(presetCopy, presetControl);
    colorsPane.appendChild(presetRow);

    const systemSection = document.createElement("section");
    systemSection.className = "doubao-theme-system-section";
    const pairControls = document.createElement("div");
    pairControls.id = "doubao-theme-system-pair";
    pairControls.className = "doubao-theme-system-pair";
    for (const mode of ["light", "dark"]) {
      const copy = document.createElement("div");
      const label = document.createElement("label");
      label.className = "doubao-theme-setting-label";
      label.textContent = mode === "light" ? "系统浅色时" : "系统深色时";
      label.htmlFor = "doubao-theme-pair-" + mode + "-button";
      copy.append(label, createThemePicker("doubao-theme-pair-" + mode, label.textContent,
        THEMES.filter((theme) => theme.baseMode === mode),
        () => appearanceSettings.themePair[mode], (id) => setThemePair(mode, id)));
      pairControls.appendChild(copy);
    }
    systemSection.appendChild(pairControls);
    const colorContext = document.createElement("p");
    colorContext.className = "doubao-theme-color-context";
    const saveStatus = document.createElement("p");
    saveStatus.className = "doubao-theme-save-status";
    saveStatus.setAttribute("role", "status");
    colorsPane.append(systemSection, colorContext, saveStatus);

    for (const control of COLOR_CONTROLS) {
      const row = document.createElement("div");
      row.className = "doubao-theme-color-row";
      const copy = document.createElement("div");
      copy.className = "doubao-theme-setting-copy";
      const label = document.createElement("label");
      label.className = "doubao-theme-setting-label";
      label.htmlFor = "doubao-theme-color-" + control.key;
      label.textContent = control.label;
      const description = document.createElement("span");
      description.className = "doubao-theme-setting-description";
      description.textContent = control.description;
      copy.append(label, description);
      const colorControl = document.createElement("div");
      colorControl.className = "doubao-theme-color-control";
      const picker = document.createElement("input");
      picker.id = "doubao-theme-color-" + control.key;
      picker.className = "doubao-theme-color-picker";
      picker.type = "color";
      picker.setAttribute("aria-label", control.label + "取色器");
      const hexInput = document.createElement("input");
      hexInput.id = "doubao-theme-hex-" + control.key;
      hexInput.className = "doubao-theme-color-hex";
      hexInput.type = "text";
      hexInput.maxLength = 7;
      hexInput.spellcheck = false;
      hexInput.setAttribute("aria-label", control.label + "十六进制色值");
      const commitColor = (rawValue) => {
        const value = normalizeHex(rawValue);
        if (!value) return false;
        appearanceSettings.customColors[control.key] = value;
        picker.value = value;
        hexInput.value = value;
        hexInput.removeAttribute("aria-invalid");
        applyAppearance();
        writeSettings();
        updateThemeSummary();
        return true;
      };
      picker.addEventListener("input", () => commitColor(picker.value));
      hexInput.addEventListener("input", () => {
        if (!commitColor(hexInput.value)) hexInput.setAttribute("aria-invalid", "true");
      });
      hexInput.addEventListener("blur", () => {
        if (!normalizeHex(hexInput.value)) {
          hexInput.value = effectiveColor(control.key);
          hexInput.removeAttribute("aria-invalid");
        }
      });
      colorControl.append(picker, hexInput);
      row.append(copy, colorControl);
      colorsPane.appendChild(row);
    }

    const layoutPane = document.createElement("div");
    layoutPane.id = "doubao-theme-pane-layout";
    layoutPane.className = "doubao-theme-settings-pane doubao-theme-settings-controls";
    layoutPane.setAttribute("role", "tabpanel");
    layoutPane.setAttribute("aria-labelledby", "doubao-theme-tab-layout");
    panes.set("layout", layoutPane);
    for (const control of APPEARANCE.controls) {
      const row = document.createElement("div");
      row.className = "doubao-theme-setting-row";
      const copy = document.createElement("div");
      copy.className = "doubao-theme-setting-copy";
      const label = document.createElement("label");
      label.className = "doubao-theme-setting-label";
      label.htmlFor = "doubao-theme-setting-" + control.key;
      label.textContent = control.label;
      const description = document.createElement("span");
      description.className = "doubao-theme-setting-description";
      description.id = "doubao-theme-setting-description-" + control.key;
      description.textContent = control.description;
      copy.append(label, description);
      const input = document.createElement("input");
      input.id = "doubao-theme-setting-" + control.key;
      input.className = "doubao-theme-setting-input";
      input.type = "range";
      input.min = String(control.min);
      input.max = String(control.max);
      input.step = String(control.step);
      input.setAttribute("aria-describedby", description.id);
      const output = document.createElement("output");
      output.id = "doubao-theme-output-" + control.key;
      output.className = "doubao-theme-setting-output";
      output.htmlFor = input.id;
      input.addEventListener("input", () => {
        appearanceSettings[control.key] = clampSetting(control, input.value);
        output.textContent = formatSetting(control, appearanceSettings[control.key]);
        applyAppearance();
        writeSettings();
      });
      row.append(copy, input, output);
      layoutPane.appendChild(row);
    }
    for (const control of TOGGLES) {
      const row = document.createElement("div");
      row.className = "doubao-theme-setting-row doubao-theme-toggle-row";
      const copy = document.createElement("div");
      copy.className = "doubao-theme-setting-copy";
      const label = document.createElement("label");
      label.className = "doubao-theme-setting-label";
      label.htmlFor = "doubao-theme-toggle-" + control.key;
      label.textContent = control.label;
      const description = document.createElement("span");
      description.className = "doubao-theme-setting-description";
      description.id = "doubao-theme-toggle-description-" + control.key;
      description.textContent = control.description;
      copy.append(label, description);
      const toggleControl = document.createElement("div");
      toggleControl.className = "doubao-theme-toggle-control";
      const input = document.createElement("input");
      input.id = "doubao-theme-toggle-" + control.key;
      input.className = "doubao-theme-setting-toggle";
      input.type = "checkbox";
      input.setAttribute("role", "switch");
      input.setAttribute("aria-describedby", description.id);
      input.addEventListener("change", () => {
        appearanceSettings[control.key] = control.inverted ? !input.checked : input.checked;
        applyAppearance();
        writeSettings();
        refreshSettingsPanel();
      });
      toggleControl.append(input);
      row.append(copy, toggleControl);
      layoutPane.appendChild(row);
    }

    const welcomePane = document.createElement("div");
    welcomePane.id = "doubao-theme-pane-welcome";
    welcomePane.className = "doubao-theme-settings-pane doubao-theme-welcome-pane";
    welcomePane.setAttribute("role", "tabpanel");
    welcomePane.setAttribute("aria-labelledby", "doubao-theme-tab-welcome");
    panes.set("welcome", welcomePane);

    const welcomePreview = document.createElement("div");
    welcomePreview.className = "doubao-theme-welcome-preview";
    welcomePreview.setAttribute("aria-label", "欢迎页预览");
    const welcomePreviewHeader = document.createElement("div");
    welcomePreviewHeader.className = "doubao-theme-welcome-preview-header";
    const welcomePreviewLabel = document.createElement("span");
    welcomePreviewLabel.textContent = "实时预览";
    const welcomePreviewActions = document.createElement("div");
    welcomePreviewActions.className = "doubao-theme-welcome-preview-actions";
    const welcomePreviewHint = document.createElement("span");
    welcomePreviewHint.textContent = "拖动裁剪 · 滚轮缩放";
    const welcomeZoomControl = document.createElement("div");
    welcomeZoomControl.className = "doubao-theme-welcome-zoom-control";
    welcomeZoomControl.setAttribute("role", "group");
    welcomeZoomControl.setAttribute("aria-label", "图片缩放");
    const zoomOut = document.createElement("button");
    zoomOut.id = "doubao-theme-welcome-zoom-out";
    zoomOut.type = "button";
    zoomOut.setAttribute("aria-label", "缩小图片");
    zoomOut.textContent = "−";
    zoomOut.addEventListener("click", () => {
      const layout = effectiveWelcomeImageLayout();
      if (commitWelcomeImageLayout({ zoom: layout.zoom - WELCOME_IMAGE_ZOOM_STEP })) setWelcomeStatus("图片已缩小");
    });
    const zoomValue = document.createElement("output");
    zoomValue.id = "doubao-theme-welcome-zoom-value";
    zoomValue.setAttribute("aria-live", "polite");
    zoomValue.textContent = DEFAULT_WELCOME_IMAGE_LAYOUT.zoom + "%";
    const zoomIn = document.createElement("button");
    zoomIn.id = "doubao-theme-welcome-zoom-in";
    zoomIn.type = "button";
    zoomIn.setAttribute("aria-label", "放大图片");
    zoomIn.textContent = "+";
    zoomIn.addEventListener("click", () => {
      const layout = effectiveWelcomeImageLayout();
      if (commitWelcomeImageLayout({ zoom: layout.zoom + WELCOME_IMAGE_ZOOM_STEP })) setWelcomeStatus("图片已放大");
    });
    welcomeZoomControl.append(zoomOut, zoomValue, zoomIn);
    const centerWelcomeCrop = document.createElement("button");
    centerWelcomeCrop.id = "doubao-theme-welcome-crop-center";
    centerWelcomeCrop.className = "doubao-theme-welcome-quiet-action";
    centerWelcomeCrop.type = "button";
    makeIconButton(centerWelcomeCrop, "rotateCcw", "复位图片显示区域");
    centerWelcomeCrop.addEventListener("click", () => {
      if (commitWelcomeImageLayout({ ...DEFAULT_WELCOME_IMAGE_LAYOUT })) setWelcomeStatus("图片显示区域已复位");
    });
    welcomePreviewActions.append(welcomePreviewHint, welcomeZoomControl, centerWelcomeCrop);
    welcomePreviewHeader.append(welcomePreviewLabel, welcomePreviewActions);
    const welcomePreviewStage = document.createElement("div");
    welcomePreviewStage.className = "doubao-theme-welcome-preview-stage";
    const welcomeCropFrame = document.createElement("div");
    welcomeCropFrame.className = "doubao-theme-welcome-crop-frame";
    welcomeCropFrame.tabIndex = 0;
    welcomeCropFrame.setAttribute("role", "group");
    welcomeCropFrame.setAttribute("aria-label", "欢迎图裁剪区，拖动或使用方向键移动，加减键或滚轮缩放，数字 0 复位");
    const welcomePreviewImage = document.createElement("div");
    welcomePreviewImage.className = "doubao-theme-welcome-preview-image";
    welcomePreviewImage.setAttribute("aria-hidden", "true");
    const welcomeCropHint = document.createElement("span");
    welcomeCropHint.className = "doubao-theme-welcome-crop-hint";
    welcomeCropHint.textContent = "拖动调整 · 滚轮缩放";
    welcomeCropFrame.append(welcomePreviewImage, welcomeCropHint);
    welcomeCropFrame.addEventListener("pointerdown", (event) => {
      if (welcomeCropFrame.dataset.croppable !== "true" || event.button !== 0) return;
      event.preventDefault();
      welcomeCropFrame.__doubaoCropDrag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        layout: effectiveWelcomeImageLayout()
      };
      welcomeCropFrame.classList.add("is-dragging");
      try { welcomeCropFrame.setPointerCapture(event.pointerId); } catch {}
    });
    welcomeCropFrame.addEventListener("pointermove", (event) => {
      const drag = welcomeCropFrame.__doubaoCropDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      moveWelcomeCrop(welcomePreviewImage, drag.layout, event.clientX - drag.x, event.clientY - drag.y);
    });
    const finishWelcomeCrop = (event) => {
      const drag = welcomeCropFrame.__doubaoCropDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      welcomeCropFrame.__doubaoCropDrag = null;
      welcomeCropFrame.classList.remove("is-dragging");
      try { welcomeCropFrame.releasePointerCapture(event.pointerId); } catch {}
      if (commitWelcomeImageLayout(effectiveWelcomeImageLayout())) setWelcomeStatus("裁剪位置已保存");
    };
    welcomeCropFrame.addEventListener("pointerup", finishWelcomeCrop);
    welcomeCropFrame.addEventListener("pointercancel", finishWelcomeCrop);
    let welcomeWheelCommitTimer = 0;
    let welcomeWheelDelta = 0;
    welcomeCropFrame.addEventListener("wheel", (event) => {
      if (welcomeCropFrame.dataset.croppable !== "true") return;
      event.preventDefault();
      welcomeWheelDelta += event.deltaY;
      if (Math.abs(welcomeWheelDelta) < 30) return;
      const layout = effectiveWelcomeImageLayout();
      const nextZoom = layout.zoom + (welcomeWheelDelta < 0 ? WELCOME_IMAGE_ZOOM_STEP : -WELCOME_IMAGE_ZOOM_STEP);
      welcomeWheelDelta = 0;
      previewWelcomeImageLayout({ zoom: nextZoom });
      window.clearTimeout(welcomeWheelCommitTimer);
      welcomeWheelCommitTimer = window.setTimeout(() => {
        if (commitWelcomeImageLayout(effectiveWelcomeImageLayout())) setWelcomeStatus("图片缩放已保存");
      }, 240);
    }, { passive: false });
    welcomeCropFrame.addEventListener("keydown", (event) => {
      const supportedKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "_", "0"];
      if (welcomeCropFrame.dataset.croppable !== "true" || !supportedKeys.includes(event.key)) return;
      event.preventDefault();
      const layout = effectiveWelcomeImageLayout();
      const patch = {};
      if (event.key === "ArrowLeft") patch.positionX = layout.positionX + 3;
      if (event.key === "ArrowRight") patch.positionX = layout.positionX - 3;
      if (event.key === "ArrowUp") patch.positionY = layout.positionY + 3;
      if (event.key === "ArrowDown") patch.positionY = layout.positionY - 3;
      if (["+", "="].includes(event.key)) patch.zoom = layout.zoom + WELCOME_IMAGE_ZOOM_STEP;
      if (["-", "_"].includes(event.key)) patch.zoom = layout.zoom - WELCOME_IMAGE_ZOOM_STEP;
      if (event.key === "0") Object.assign(patch, DEFAULT_WELCOME_IMAGE_LAYOUT);
      if (commitWelcomeImageLayout(patch)) setWelcomeStatus("裁剪位置已保存");
    });
    const welcomePreviewText = document.createElement("div");
    welcomePreviewText.className = "doubao-theme-welcome-preview-text";
    welcomePreviewStage.append(welcomeCropFrame, welcomePreviewText);
    welcomePreview.append(welcomePreviewHeader, welcomePreviewStage);

    const welcomeTextRow = document.createElement("div");
    welcomeTextRow.className = "doubao-theme-welcome-section";
    const welcomeTextHeader = document.createElement("div");
    welcomeTextHeader.className = "doubao-theme-welcome-section-header";
    const welcomeTextCopy = document.createElement("div");
    welcomeTextCopy.className = "doubao-theme-setting-copy";
    const welcomeTextLabel = document.createElement("label");
    welcomeTextLabel.className = "doubao-theme-setting-label";
    welcomeTextLabel.htmlFor = "doubao-theme-welcome-text";
    welcomeTextLabel.textContent = "欢迎语";
    const welcomeTextDescription = document.createElement("span");
    welcomeTextDescription.className = "doubao-theme-setting-description";
    welcomeTextDescription.textContent = "显示在新会话输入框上方";
    welcomeTextCopy.append(welcomeTextLabel, welcomeTextDescription);
    const resetWelcomeText = document.createElement("button");
    resetWelcomeText.className = "doubao-theme-welcome-quiet-action";
    resetWelcomeText.type = "button";
    makeIconButton(resetWelcomeText, "rotateCcw", "恢复默认欢迎语");
    resetWelcomeText.addEventListener("click", () => {
      if (commitWelcomeValue("welcomeTextByTheme", undefined)) setWelcomeStatus("欢迎语已恢复默认");
    });
    welcomeTextHeader.append(welcomeTextCopy, resetWelcomeText);
    const welcomeTextControl = document.createElement("div");
    welcomeTextControl.className = "doubao-theme-welcome-text-control";
    const welcomeTextInput = document.createElement("input");
    welcomeTextInput.id = "doubao-theme-welcome-text";
    welcomeTextInput.className = "doubao-theme-welcome-text-input";
    welcomeTextInput.type = "text";
    welcomeTextInput.maxLength = MAX_WELCOME_TEXT_LENGTH;
    welcomeTextInput.placeholder = DEFAULT_WELCOME_TEXT;
    welcomeTextInput.addEventListener("input", () => {
      commitWelcomeValue("welcomeTextByTheme", welcomeTextInput.value);
      const counter = document.getElementById("doubao-theme-welcome-text-count");
      if (counter) counter.textContent = welcomeTextInput.value.length + " / " + MAX_WELCOME_TEXT_LENGTH;
      setWelcomeStatus("");
    });
    const welcomeTextCount = document.createElement("output");
    welcomeTextCount.id = "doubao-theme-welcome-text-count";
    welcomeTextCount.className = "doubao-theme-welcome-text-count";
    welcomeTextCount.htmlFor = welcomeTextInput.id;
    welcomeTextControl.append(welcomeTextInput, welcomeTextCount);
    welcomeTextRow.append(welcomeTextHeader, welcomeTextControl);

    const welcomeImageRow = document.createElement("div");
    welcomeImageRow.className = "doubao-theme-welcome-section";
    const welcomeImageHeader = document.createElement("div");
    welcomeImageHeader.className = "doubao-theme-welcome-section-header";
    const welcomeImageCopy = document.createElement("div");
    welcomeImageCopy.className = "doubao-theme-setting-copy";
    const welcomeImageLabel = document.createElement("span");
    welcomeImageLabel.className = "doubao-theme-setting-label";
    welcomeImageLabel.textContent = "欢迎图";
    const welcomeImageDescription = document.createElement("span");
    welcomeImageDescription.className = "doubao-theme-setting-description";
    welcomeImageDescription.textContent = "上传后可在上方拖动裁剪、滚轮缩放 · 最多 " + MAX_WELCOME_IMAGE_COUNT + " 张，单张不超过 " + Math.round(MAX_WELCOME_IMAGE_BYTES / 1048576) + "MB";
    welcomeImageCopy.append(welcomeImageLabel, welcomeImageDescription);
    welcomeImageHeader.appendChild(welcomeImageCopy);
    const welcomeImageControl = document.createElement("div");
    welcomeImageControl.className = "doubao-theme-welcome-image-control";
    const welcomeImageInput = document.createElement("input");
    welcomeImageInput.className = "doubao-theme-welcome-file-input";
    welcomeImageInput.type = "file";
    welcomeImageInput.multiple = true;
    welcomeImageInput.accept = Array.from(ACCEPTED_WELCOME_IMAGE_TYPES).join(",");
    const chooseWelcomeImage = document.createElement("button");
    chooseWelcomeImage.id = "doubao-theme-welcome-image-upload";
    chooseWelcomeImage.className = "doubao-theme-welcome-primary-action";
    chooseWelcomeImage.type = "button";
    chooseWelcomeImage.textContent = "上传图片";
    prependButtonIcon(chooseWelcomeImage, "upload");
    chooseWelcomeImage.addEventListener("click", () => welcomeImageInput.click());
    const resetWelcomeImage = document.createElement("button");
    resetWelcomeImage.className = "doubao-theme-welcome-quiet-action";
    resetWelcomeImage.type = "button";
    resetWelcomeImage.textContent = "恢复主题默认";
    prependButtonIcon(resetWelcomeImage, "rotateCcw");
    resetWelcomeImage.addEventListener("click", () => {
      if (resetWelcomeImageAndLayout()) setWelcomeStatus("欢迎图已恢复当前 Style 默认");
    });
    welcomeImageInput.addEventListener("change", async () => {
      const files = Array.from(welcomeImageInput.files || []);
      welcomeImageInput.value = "";
      if (!files.length) return;
      const remaining = MAX_WELCOME_IMAGE_COUNT - appearanceSettings.welcomeImageLibrary.length;
      if (remaining <= 0) {
        setWelcomeStatus("图片库已满，请先删除一张图片", true);
        return;
      }
      let uploaded = 0;
      let rejected = 0;
      welcomeUploadsPending += 1;
      for (const file of files.slice(0, remaining)) {
        if (!ACCEPTED_WELCOME_IMAGE_TYPES.has(file.type) || file.size > MAX_WELCOME_IMAGE_BYTES) {
          rejected += 1;
          continue;
        }
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.addEventListener("load", () => resolve(reader.result), { once: true });
            reader.addEventListener("error", () => reject(reader.error || new Error("图片读取失败")), { once: true });
            reader.readAsDataURL(file);
          });
          if (!isWelcomeImageValue(dataUrl) || !(await commitWelcomeImageUpload(file, dataUrl))) {
            rejected += 1;
            continue;
          }
          uploaded += 1;
        } catch {
          rejected += 1;
        }
      }
      rejected += Math.max(0, files.length - remaining);
      if (uploaded) {
        setWelcomeStatus("已上传 " + uploaded + " 张图片" + (rejected ? "，另有 " + rejected + " 张未加入" : ""));
      } else {
        setWelcomeStatus("图片未加入，请检查格式、大小或素材库容量", true);
      }
      welcomeUploadsPending -= 1;
      if (pendingSystemAppearance) syncSystemAppearance();
    });
    welcomeImageControl.append(welcomeImageInput, chooseWelcomeImage, resetWelcomeImage);

    const welcomeLibrarySection = document.createElement("section");
    welcomeLibrarySection.className = "doubao-theme-welcome-library-section";
    const welcomeLibraryHeader = document.createElement("div");
    welcomeLibraryHeader.className = "doubao-theme-welcome-library-header";
    const welcomeLibraryTitle = document.createElement("span");
    welcomeLibraryTitle.className = "doubao-theme-welcome-library-title";
    welcomeLibraryTitle.textContent = "我的图片";
    const welcomeLibraryCount = document.createElement("output");
    welcomeLibraryCount.id = "doubao-theme-welcome-library-count";
    welcomeLibraryCount.className = "doubao-theme-welcome-library-count";
    welcomeLibraryHeader.append(welcomeLibraryTitle, welcomeLibraryCount);
    const welcomeLibraryEmpty = document.createElement("p");
    welcomeLibraryEmpty.className = "doubao-theme-welcome-library-empty";
    welcomeLibraryEmpty.textContent = "还没有上传图片";
    const welcomeLibraryGrid = document.createElement("div");
    welcomeLibraryGrid.className = "doubao-theme-welcome-library-grid";
    welcomeLibraryGrid.setAttribute("aria-label", "已上传图片");
    welcomeLibrarySection.append(welcomeLibraryHeader, welcomeLibraryEmpty, welcomeLibraryGrid);

    const welcomeBuiltinSection = document.createElement("section");
    welcomeBuiltinSection.className = "doubao-theme-welcome-library-section";
    const welcomeBuiltinTitle = document.createElement("span");
    welcomeBuiltinTitle.className = "doubao-theme-welcome-library-title";
    welcomeBuiltinTitle.textContent = "内置素材";
    const welcomeBuiltinGrid = document.createElement("div");
    welcomeBuiltinGrid.className = "doubao-theme-welcome-builtin-grid";
    const createBuiltinCard = (id, label, asset) => {
      const button = document.createElement("button");
      button.id = id;
      button.type = "button";
      button.className = "doubao-theme-welcome-builtin-card";
      button.dataset.asset = asset;
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", "使用" + label);
      const thumbnail = document.createElement("span");
      thumbnail.className = "doubao-theme-welcome-builtin-thumbnail";
      if (asset === "none") {
        const emptyMark = document.createElement("span");
        emptyMark.className = "doubao-theme-welcome-none-mark";
        emptyMark.textContent = "无";
        thumbnail.appendChild(emptyMark);
      }
      const caption = document.createElement("span");
      caption.className = "doubao-theme-welcome-library-caption";
      caption.textContent = label;
      button.append(thumbnail, caption);
      button.addEventListener("click", () => {
        if (commitWelcomeImageSelection(asset)) setWelcomeStatus("已使用" + label);
      });
      return button;
    };
    const noWelcomeImage = createBuiltinCard("doubao-theme-welcome-image-none", "无欢迎图", "none");
    welcomeBuiltinGrid.append(noWelcomeImage);
    welcomeBuiltinSection.append(welcomeBuiltinTitle, welcomeBuiltinGrid);

    welcomeImageRow.append(welcomeImageHeader, welcomeImageControl, welcomeLibrarySection, welcomeBuiltinSection);

    const welcomeStatus = document.createElement("p");
    welcomeStatus.className = "doubao-theme-welcome-status";
    welcomeStatus.setAttribute("role", "status");
    welcomeStatus.setAttribute("aria-live", "polite");
    welcomePane.append(welcomePreview, welcomeImageRow, welcomeTextRow, welcomeStatus);
    content.append(colorsPane, layoutPane, welcomePane);

    const footer = document.createElement("footer");
    footer.className = "doubao-theme-settings-footer";
    const footerNote = document.createElement("span");
    footerNote.className = "doubao-theme-settings-footer-note";
    footerNote.textContent = "更改已自动保存";
    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className = "doubao-theme-settings-reset";
    resetButton.textContent = "恢复 Style 默认";
    prependButtonIcon(resetButton, "rotateCcw");
    resetButton.addEventListener("click", () => {
      resetCurrentThemeSettings();
      applyAppearance();
      writeSettings();
      refreshSettingsPanel();
    });
    const footerLeft = document.createElement("div");
    footerLeft.className = "doubao-theme-footer-left";
    footerLeft.append(footerNote);
    installUpdateControl(footerLeft, window.__doubaoThemeLastUpdateState || ${JSON.stringify(updateBridge.state)});
    footer.append(footerLeft, resetButton);
    panel.append(header, tabs, content, footer);
    skinUI = installSkinUI({ panel, header, tabs, content, footer, resetButton, runtime: skinRuntime, model: skinModel, restore: restoreAdjustableStyle, close: closeSettings });
    layer.appendChild(panel);
    layer.addEventListener("click", (event) => {
      themePickers.forEach((picker) => { if (!picker.element.contains(event.target)) picker.close(); });
      if (event.target === layer) closeSettings();
    });
    document.body.appendChild(layer);
    setActiveTab("colors");
    refreshSettingsPanel();
    return true;
  };

  const adaptHardcodedSurface = (element) => {
    if (currentTheme().baseMode !== "dark") return;
    if (!(element instanceof Element)) return;
    const isEmptyInteractionOverlay = element.matches('[data-slot="dropdown-menu-trigger"]')
      && !(element.textContent || "").trim()
      && !element.querySelector("svg, img, canvas, video");
    if (isEmptyInteractionOverlay) {
      element.classList.remove(ADAPTED_SURFACE_CLASS);
      return;
    }
    if (element.classList.contains(ADAPTED_SURFACE_CLASS)) return;
    if (element.closest(".html-previewer")) return;
    if (["IMG", "VIDEO", "CANVAS", "IFRAME"].includes(element.tagName)) return;
    const style = getComputedStyle(element);
    const color = style.backgroundColor.match(/^rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
    if (!color) return;
    const [, red, green, blue] = color.map(Number);
    if (red < 240 || green < 240 || blue < 240) return;
    const rect = element.getBoundingClientRect();
    if (rect.width < 18 || rect.height < 18) return;
    const className = typeof element.className === "string" ? element.className : "";
    const namedSurface = /toolbar|header|popover|dropdown|modal|menu|to-bottom-button/i.test(className);
    const semanticSurface = ["dialog", "menu", "listbox"].includes(element.getAttribute("role"));
    const positionedOverlay = ["absolute", "fixed", "sticky"].includes(style.position)
      && rect.width * rect.height < innerWidth * innerHeight * 0.4 && rect.height <= 180;
    if (namedSurface || semanticSurface || positionedOverlay || element.tagName === "BUTTON") {
      element.classList.add(ADAPTED_SURFACE_CLASS);
    }
  };
  const adaptHardcodedSurfaces = (root) => {
    if (!(root instanceof Element)) return;
    adaptHardcodedSurface(root);
    for (const element of root.querySelectorAll("*")) adaptHardcodedSurface(element);
  };
  let adaptationFrame = 0;
  const adaptationRoots = new Set();
  const scheduleSurfaceAdaptation = (root = document.documentElement) => {
    if (root instanceof Element) adaptationRoots.add(root);
    if (adaptationFrame) return;
    adaptationFrame = requestAnimationFrame(() => {
      adaptationFrame = 0;
      const roots = Array.from(adaptationRoots);
      adaptationRoots.clear();
      for (const candidateRoot of roots) adaptHardcodedSurfaces(candidateRoot);
      positionSettingsTrigger();
      scheduleContentGridWidth();
    });
  };

  const apply = () => {
    const root = document.documentElement;
    if (!root) return false;
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || root).appendChild(style);
    }
    if (style.textContent !== CSS_TEXT) style.textContent = CSS_TEXT;
    applyAppearance();
    installSettingsPanel();
    return true;
  };
  const install = () => {
    window.__doubaoThemeCleanInput?.cleanup();
    window.__doubaoThemeCleanInput = null;
    window.__doubaoThemeSystemAppearanceCleanup?.();
    const flushSystemAppearance = () => { if (pendingSystemAppearance) syncSystemAppearance(); };
    const deferFlushSystemAppearance = () => queueMicrotask(flushSystemAppearance);
    systemAppearanceMedia.addEventListener("change", syncSystemAppearance);
    window.addEventListener("focus", syncSystemAppearance);
    document.addEventListener("visibilitychange", syncSystemAppearance);
    document.addEventListener("focusout", deferFlushSystemAppearance);
    document.addEventListener("pointerup", deferFlushSystemAppearance);
    document.addEventListener("pointercancel", deferFlushSystemAppearance);
    window.__doubaoThemeSystemAppearanceCleanup = () => {
      systemAppearanceMedia.removeEventListener("change", syncSystemAppearance);
      window.removeEventListener("focus", syncSystemAppearance);
      document.removeEventListener("visibilitychange", syncSystemAppearance);
      document.removeEventListener("focusout", deferFlushSystemAppearance);
      document.removeEventListener("pointerup", deferFlushSystemAppearance);
      document.removeEventListener("pointercancel", deferFlushSystemAppearance);
    };
    window.__doubaoThemeComposerShortcutsCleanup?.();
    delete window.__doubaoThemeComposerShortcutsCleanup;
    delete window.__doubaoThemeSetSendShortcut;
    window.__doubaoLinearThemeObserver?.disconnect();
    window.__doubaoLinearCompatibilityObserver?.disconnect();
    window.__doubaoThemeContentResizeObserver?.disconnect();
    window.__doubaoThemeTriggerResizeObserver?.disconnect();
    window.__doubaoLinearThemeObserver = null;
    window.__doubaoLinearCompatibilityObserver = null;
    window.__doubaoThemeContentResizeObserver = null;
    window.__doubaoThemeContentResizeTarget = null;
    const previousSettingsLayer = document.getElementById(SETTINGS_LAYER_ID);
    destroyWelcomeAnimation(previousSettingsLayer?.querySelector(".doubao-theme-welcome-preview-image"));
    previousSettingsLayer?.remove();
    document.getElementById(SETTINGS_TRIGGER_ID)?.remove();
    for (const element of document.querySelectorAll("[data-doubao-style-host], [data-doubao-style-title-host]")) {
      element.removeAttribute("data-doubao-style-host");
      element.removeAttribute("data-doubao-style-title-host");
    }
    for (const entry of document.querySelectorAll("[data-doubao-sidebar-item], [data-doubao-sidebar-collapsed]")) {
      entry.removeAttribute("data-doubao-sidebar-item");
      entry.removeAttribute("data-doubao-sidebar-collapsed");
    }
    delete window.__doubaoThemeSetSidebarItem;
    if (!apply()) { setTimeout(install, 0); return; }
    window.__doubaoThemeCleanInput = installCleanInput(() => appearanceSettings.cleanInput);
    window.__doubaoLinearThemeObserver = new MutationObserver(() => apply());
    window.__doubaoLinearThemeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-doubao-theme"],
      childList: true
    });
    window.__doubaoLinearCompatibilityObserver = new MutationObserver((mutations) => {
      positionSettingsTrigger();
      observeContentGridWidth();
      scheduleContentGridWidth();
      scheduleWelcomeSync();
      skinRuntime.sync();
      for (const mutation of mutations) for (const node of mutation.addedNodes) scheduleSurfaceAdaptation(node);
    });
    window.__doubaoLinearCompatibilityObserver.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
    scheduleSurfaceAdaptation(document.documentElement);
    if (window.__doubaoLinearPointerAdapter) document.removeEventListener("pointerover", window.__doubaoLinearPointerAdapter, true);
    window.__doubaoLinearPointerAdapter = (event) => {
      let element = event.target;
      for (let depth = 0; element instanceof Element && depth < 6; depth += 1) {
        adaptHardcodedSurface(element);
        element = element.parentElement;
      }
    };
    document.addEventListener("pointerover", window.__doubaoLinearPointerAdapter, true);
    if (window.__doubaoThemeSettingsKeydownHandler) {
      document.removeEventListener("keydown", window.__doubaoThemeSettingsKeydownHandler, true);
      window.removeEventListener("keydown", window.__doubaoThemeSettingsKeydownHandler, true);
    }
    const windowsShortcuts = /Win/i.test(navigator.userAgentData?.platform || navigator.platform || "");
    const settingsKeydownHandler = (event) => {
      if ((windowsShortcuts ? event.ctrlKey && !event.metaKey : event.metaKey && !event.ctrlKey) && event.altKey && !event.shiftKey && event.code === "Comma") {
        event.preventDefault();
        event.stopPropagation();
        openSettings();
        return;
      }
      if (event.key === "Escape") {
        if (skinUI?.handleEscape()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const presetButton = document.querySelector('.doubao-theme-preset-button[aria-expanded="true"]');
        const presetMenu = presetButton && document.getElementById(presetButton.getAttribute("aria-controls"));
        if (presetButton && presetMenu && !presetMenu.hidden) {
          event.preventDefault();
          event.stopPropagation();
          presetMenu.hidden = true;
          presetButton.setAttribute("aria-expanded", "false");
          presetButton.focus();
          return;
        }
        const layer = document.getElementById(SETTINGS_LAYER_ID);
        if (layer && !layer.hidden) {
          event.preventDefault();
          event.stopPropagation();
          closeSettings();
        }
      }
    };
    // Run before native document-level Escape handlers, including after a live
    // reinjection while the settings modal is already mounted.
    window.addEventListener("keydown", settingsKeydownHandler, true);
    window.__doubaoThemeSettingsKeydownHandler = settingsKeydownHandler;
    if (window.__doubaoThemeSettingsResizeHandler) {
      window.removeEventListener("resize", window.__doubaoThemeSettingsResizeHandler);
    }
    const settingsResizeHandler = () => {
        positionSettingsTrigger();
        scheduleContentGridWidth();
        clampSettingsPanelToViewport(document.querySelector(".doubao-theme-settings-panel"));
    };
    window.addEventListener("resize", settingsResizeHandler);
    window.__doubaoThemeSettingsResizeHandler = settingsResizeHandler;
    window.__doubaoThemeSettingsKeyboardInstalled = true;
    window.__doubaoStyleSkins = {
      version: 1,
      list: () => skinRuntime.list().map(({ id, name, author, version, builtin, active }) => ({ id, name, author, version, builtin, active })),
      active: () => skinRuntime.active()?.id || null,
      install: input => skinRuntime.install(input),
      apply: id => skinRuntime.select(id),
      restore: restoreAdjustableStyle,
      remove: id => skinRuntime.remove(id),
      export: id => skinRuntime.export(id),
      open: () => { openSettings(); skinUI?.showSkins(); return true; }
    };
    window.__doubaoThemeOpenSettings = openSettings;
    window.__doubaoThemeCloseSettings = closeSettings;
    window.__doubaoThemeGetSettings = () => ({
      ...appearanceSettings,
      themePair: { ...appearanceSettings.themePair },
      customColorsByTheme: JSON.parse(JSON.stringify(themeAppearance.remember(appearanceSettings).customColorsByTheme)),
      customColors: { ...appearanceSettings.customColors },
      welcomeTextByTheme: { ...appearanceSettings.welcomeTextByTheme },
      welcomeImageByTheme: { ...appearanceSettings.welcomeImageByTheme },
      welcomeImageLayoutByTheme: Object.fromEntries(
        Object.entries(appearanceSettings.welcomeImageLayoutByTheme).map(([themeId, layout]) => [themeId, { ...layout }])
      ),
      welcomeImageLibrary: appearanceSettings.welcomeImageLibrary.map((item) => ({ ...item }))
    });
    window.__doubaoThemeGetThemes = () => THEMES.map(({ id, name, baseMode }) => ({ id, name, baseMode }));
    window.__doubaoThemeSetTheme = selectThemeAppearance;
    window.__doubaoThemeSetThemePair = setThemePair;
    window.__doubaoThemeGetSystemMode = systemAppearanceMode;
    window.__doubaoThemeSetColor = (key, value) => {
      if (skinRuntime.active()) return false;
      const normalized = COLOR_KEYS.has(key) ? normalizeHex(value) : null;
      if (!normalized) return false;
      appearanceSettings.customColors[key] = normalized;
      applyAppearance();
      writeSettings();
      refreshSettingsPanel();
      return true;
    };
    window.__doubaoThemeSetToggle = (key, value) => {
      if (skinRuntime.active()) return false;
      if (!TOGGLE_KEYS.has(key) || typeof value !== "boolean") return false;
      appearanceSettings[key] = value;
      applyAppearance();
      writeSettings();
      refreshSettingsPanel();
      return true;
    };
    window.__doubaoThemeSetLayout = (key, value) => {
      if (skinRuntime.active()) return false;
      const control = LAYOUT_CONTROL_MAP.get(key);
      if (!control || !Number.isFinite(Number(value))) return false;
      appearanceSettings[key] = clampSetting(control, value);
      applyAppearance();
      writeSettings();
      refreshSettingsPanel();
      return true;
    };
    window.__doubaoThemeSetWelcomeText = (value) => {
      if (skinRuntime.active()) return false;
      if (typeof value !== "string" || value.length > MAX_WELCOME_TEXT_LENGTH) return false;
      return commitWelcomeValue("welcomeTextByTheme", value);
    };
    window.__doubaoThemeSetWelcomeImage = (value) => {
      if (skinRuntime.active()) return false;
      if (!isWelcomeImageValue(value)) return false;
      return commitWelcomeImageSelection(value);
    };
    window.__doubaoThemeSetWelcomeImageLayout = (value) => {
      if (skinRuntime.active()) return false;
      if (!value || typeof value !== "object") return false;
      return commitWelcomeImageLayout(value);
    };
    window.__doubaoThemeResetWelcomeText = () => skinRuntime.active() ? false : commitWelcomeValue("welcomeTextByTheme", undefined);
    window.__doubaoThemeResetWelcomeImage = () => skinRuntime.active() ? false : resetWelcomeImageAndLayout();
    window.__doubaoThemeResetSettings = () => {
      if (skinRuntime.active()) return false;
      resetCurrentThemeSettings();
      applyAppearance();
      writeSettings();
      refreshSettingsPanel();
      return true;
    };
    void migrateLegacyWelcomeImages();
    window.__doubaoLinearThemeInstalled = true;
  };
  install();
  return true;
})()`;

new Function(injectionSource);
export { injectionSource };

function createSession(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const contexts = new Map();
  const pushUpdateState = state => call("Runtime.evaluate", {
    expression: `window.__doubaoThemeLastUpdateState = ${JSON.stringify(state)}; window.__doubaoThemeUpdateState?.(window.__doubaoThemeLastUpdateState);`,
  }).catch(() => {});
  const unsubscribe = updateBridge.subscribe(pushUpdateState);
  const pushWorkshopState = state => call("Runtime.evaluate", {
    expression: `window.__doubaoWorkshopLastState = ${JSON.stringify(state)}; window.__doubaoWorkshopState?.(window.__doubaoWorkshopLastState);`,
  }).catch(() => {});
  const unsubscribeWorkshop = workshopBridge.subscribe(pushWorkshopState);
  let sequence = 0;
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.executionContextCreated") {
      contexts.set(message.params.context.id, message.params.context);
    } else if (message.method === "Runtime.executionContextDestroyed") {
      contexts.delete(message.params.executionContextId);
    } else if (message.method === "Runtime.executionContextsCleared") {
      contexts.clear();
    } else if (message.method === "Runtime.bindingCalled" && message.params.name === "__doustyleUpdateCommand") {
      updateBridge.request(message.params.payload, contexts.get(message.params.executionContextId));
      pushUpdateState(updateBridge.state);
    } else if (message.method === "Runtime.bindingCalled" && message.params.name === "__doustyleWorkshopCommand") {
      if (workshopBridge.request(message.params.payload, contexts.get(message.params.executionContextId))) pushWorkshopState(workshopBridge.state);
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  socket.addEventListener("close", () => {
    unsubscribe();
    unsubscribeWorkshop();
    sessions.delete(target.id);
    for (const waiter of pending.values()) waiter.reject(new Error("DevTools connection closed"));
    pending.clear();
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", async () => {
      try {
        await call("Page.enable");
        await call("Runtime.enable");
        await call("Runtime.addBinding", { name: "__doustyleWorkshopCommand" });
        if (process.env.DOUBAO_UPDATE_ENABLED === "1") await call("Runtime.addBinding", { name: "__doustyleUpdateCommand" });
        await call("Page.addScriptToEvaluateOnNewDocument", { source: injectionSource });
        await call("Runtime.evaluate", { expression: injectionSource, returnByValue: true });
        await pushUpdateState(updateBridge.state);
        await workshopBridge.refresh();
        await pushWorkshopState(workshopBridge.state);
        resolve();
      } catch (error) { reject(error); }
    }, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return { socket, call, ready };
}

async function listTargets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
  if (!response.ok) throw new Error(`DevTools returned ${response.status}`);
  return response.json();
}
async function refreshTargets() {
  const targets = await listTargets();
  const chatTargets = targets.filter((target) => target.type === "page" && isDoubaoChatURL(target.url));
  if (chatTargets.length > 0) {
    hasSeenTarget = true;
    lastTargetAt = Date.now();
  }
  for (const target of chatTargets) {
    if (sessions.has(target.id)) {
      continue;
    }
    const session = createSession(target);
    sessions.set(target.id, session);
    await session.ready;
    console.log(`DouStyle applied to ${target.url}`);
  }
}
function shouldExit() {
  const now = Date.now();
  if (!hasSeenTarget) return now - startedAt > 45_000;
  return sessions.size === 0 && now - lastTargetAt > 12_000;
}
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const session of sessions.values()) session.socket.close();
  process.exit(0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  updateBridge.start();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  while (!stopping) {
    try { await refreshTargets(); } catch (error) {
      if (hasSeenTarget && shouldExit()) break;
    }
    if (shouldExit()) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  await stop();
}
