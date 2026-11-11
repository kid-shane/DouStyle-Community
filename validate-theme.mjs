import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const requestedTheme = process.argv[2] || "all";
if (requestedTheme !== "all" && !/^[a-z0-9-]+$/.test(requestedTheme)) {
  throw new Error(`Invalid theme name: ${requestedTheme}`);
}

const [css, appearanceText, themeFileNames] = await Promise.all([
  readFile(path.join(projectDirectory, "theme.css"), "utf8"),
  readFile(path.join(projectDirectory, "appearance.json"), "utf8"),
  readdir(path.join(projectDirectory, "themes")),
]);
const appearance = JSON.parse(appearanceText);
const availableThemes = themeFileNames
  .filter((fileName) => /^[a-z0-9-]+\.json$/.test(fileName))
  .map((fileName) => fileName.replace(/\.json$/, ""));
const themeNames = requestedTheme === "all" ? availableThemes : [requestedTheme];
const toKebabCase = (value) => value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const used = new Set(css.match(/--db-theme-[a-z0-9-]+/g) || []);
const hardcodedHexColors = css.match(/#[0-9a-f]{3,8}\b/gi) || [];
const controls = Array.isArray(appearance.controls) ? appearance.controls : [];
const colorControls = Array.isArray(appearance.colorControls) ? appearance.colorControls : [];
const toggles = Array.isArray(appearance.toggles) ? appearance.toggles : [];
const welcome = appearance.welcome || {};
const defaultTheme = appearance.defaultTheme || {};
const preferenceVariables = controls.map((control) => control.cssVariable);
const definedPreferences = new Set(preferenceVariables);
const usedPreferences = new Set(css.match(/--db-pref-[a-z0-9-]+/g) || []);
const missingPreferences = Array.from(usedPreferences).filter((token) => !definedPreferences.has(token));
const unusedPreferences = Array.from(definedPreferences).filter((token) => !usedPreferences.has(token));
const duplicatePreferenceVariables = preferenceVariables.filter((token, index) => preferenceVariables.indexOf(token) !== index);
const invalidControls = controls
  .filter((control) =>
    typeof control.key !== "string"
    || typeof control.label !== "string"
    || !/^--db-pref-[a-z0-9-]+$/.test(control.cssVariable || "")
    || !Number.isFinite(control.min)
    || !Number.isFinite(control.max)
    || !Number.isFinite(control.step)
    || !Number.isFinite(control.default)
    || control.min >= control.max
    || control.step <= 0
    || control.default < control.min
    || control.default > control.max
  )
  .map((control) => control.key || "unknown");
const invalidColorControls = colorControls
  .filter((control) => typeof control.key !== "string" || typeof control.label !== "string" || typeof control.description !== "string")
  .map((control) => control.key || "unknown");
const duplicateColorKeys = colorControls
  .map((control) => control.key)
  .filter((key, index, keys) => keys.indexOf(key) !== index);
const invalidToggles = toggles
  .filter((control) =>
    typeof control.key !== "string"
    || typeof control.label !== "string"
    || typeof control.description !== "string"
    || typeof control.default !== "boolean"
    || (control.inverted !== undefined && typeof control.inverted !== "boolean")
  )
  .map((control) => control.key || "unknown");
const duplicateToggleKeys = toggles
  .map((control) => control.key)
  .filter((key, index, keys) => keys.indexOf(key) !== index);
const invalidWelcome = [
  typeof welcome.defaultText !== "string" || !welcome.defaultText.length,
  !Number.isInteger(welcome.maxTextLength) || welcome.maxTextLength < welcome.defaultText.length,
  !Number.isInteger(welcome.maxImageBytes) || welcome.maxImageBytes < 1024,
  !Number.isInteger(welcome.maxImageCount) || welcome.maxImageCount < 1 || welcome.maxImageCount > 50,
  !welcome.imageLayout || typeof welcome.imageLayout !== "object",
  !Number.isFinite(welcome.imageLayout?.zoom) || welcome.imageLayout.zoom < 0,
  !Number.isFinite(welcome.imageLayout?.zoomMin) || welcome.imageLayout.zoomMin < 0,
  !Number.isFinite(welcome.imageLayout?.zoomMax) || welcome.imageLayout.zoomMax <= welcome.imageLayout.zoomMin,
  !Number.isFinite(welcome.imageLayout?.zoomStep) || welcome.imageLayout.zoomStep <= 0,
  welcome.imageLayout?.zoom < welcome.imageLayout?.zoomMin || welcome.imageLayout?.zoom > welcome.imageLayout?.zoomMax,
  !Number.isFinite(welcome.imageLayout?.positionX) || welcome.imageLayout.positionX < 0 || welcome.imageLayout.positionX > 100,
  !Number.isFinite(welcome.imageLayout?.positionY) || welcome.imageLayout.positionY < 0 || welcome.imageLayout.positionY > 100,
  !Array.isArray(welcome.acceptedImageTypes) || welcome.acceptedImageTypes.length === 0,
  ...(Array.isArray(welcome.acceptedImageTypes)
    ? welcome.acceptedImageTypes.map((type) => !/^image\/(?:png|jpeg|webp|gif|avif)$/.test(type))
    : []),
].some(Boolean);

const sharedErrors = {
  invalidSystemTheme: (await Promise.all(["light", "dark"].map(async (mode) => {
    const id = appearance.systemTheme?.[mode];
    if (!availableThemes.includes(id)) return true;
    const theme = JSON.parse(await readFile(path.join(projectDirectory, "themes", id + ".json"), "utf8"));
    return theme.baseMode !== mode;
  }))).some(Boolean),
  hardcodedHexColors,
  missingPreferences,
  unusedPreferences,
  duplicatePreferenceVariables,
  invalidControls,
  invalidColorControls,
  duplicateColorKeys,
  invalidToggles,
  duplicateToggleKeys,
  invalidWelcome,
  invalidDefaultTheme: typeof defaultTheme.id !== "string"
    || !availableThemes.includes(defaultTheme.id)
    || !Number.isInteger(defaultTheme.revision)
    || defaultTheme.revision < 1,
};
if (
  hardcodedHexColors.length
  || controls.length === 0
  || colorControls.length === 0
  || missingPreferences.length
  || unusedPreferences.length
  || duplicatePreferenceVariables.length
  || invalidControls.length
  || invalidColorControls.length
  || duplicateColorKeys.length
  || toggles.length === 0
  || invalidToggles.length
  || duplicateToggleKeys.length
  || invalidWelcome
  || sharedErrors.invalidDefaultTheme
) {
  console.error(JSON.stringify(sharedErrors, null, 2));
  process.exit(1);
}

const summaries = [];
for (const themeName of themeNames) {
  const config = JSON.parse(await readFile(path.join(projectDirectory, "themes", `${themeName}.json`), "utf8"));
  const defined = new Set(Object.keys(config.tokens || {}).map((name) => `--db-theme-${toKebabCase(name)}`));
  const missing = Array.from(used).filter((token) => !defined.has(token));
  const unused = Array.from(defined).filter((token) => !used.has(token));
  const missingColorTokens = colorControls
    .map((control) => control.key)
    .filter((key) => typeof config.tokens?.[key] !== "string" || !/^#[0-9a-f]{6}$/i.test(config.tokens[key]));
  const invalidWelcomeImage = config.welcome?.image && !["none", "builtin:mira-cat"].includes(config.welcome.image);
  if (missing.length || unused.length || missingColorTokens.length || invalidWelcomeImage) {
    console.error(JSON.stringify({ theme: themeName, missing, unused, missingColorTokens, invalidWelcomeImage }, null, 2));
    process.exit(1);
  }
  summaries.push(`${config.name || themeName}: ${defined.size} semantic tokens`);
}

console.log(`${summaries.join("; ")}; ${controls.length} layout controls; ${colorControls.length} color controls; ${toggles.length} toggles; welcome customization validated`);
