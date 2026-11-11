import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createThemeAppearanceModel } from "../../theme-appearance.mjs";

const appearance = JSON.parse(await readFile(new URL("../../appearance.json", import.meta.url)));
const themes = await Promise.all((await readdir(new URL("../../themes/", import.meta.url)))
  .filter((name) => name.endsWith(".json"))
  .map(async (name) => JSON.parse(await readFile(new URL("../../themes/" + name, import.meta.url)))));
const model = createThemeAppearanceModel(themes, appearance.defaultTheme.id,
  appearance.colorControls.map((control) => control.key), appearance.systemTheme);
const fixture = (saved = {}, mode = "light") => ({
  contentSideMargin: 76,
  welcomeTextByTheme: { trae: "工作时间" }, ...model.normalize(saved, mode)
});

test("legacy fixed theme and its custom colors survive migration", () => {
  const state = fixture({ themeId: "trae", customColors: { accent: "#aabbcc", bad: "#112233", background: "bad" } });
  assert.equal(state.themeMode, "fixed");
  assert.equal(state.themeId, "trae");
  assert.deepEqual(state.customColors, { accent: "#AABBCC" });
  assert.deepEqual(state.customColorsByTheme.trae, state.customColors);
});

test("automatic mode is ready to use with native light/dark defaults", () => {
  const state = model.select(fixture({ themeId: "trae" }), "system", "light");
  assert.equal(state.themeId, "doubao-default");
  assert.equal(model.sync(state, "dark").themeId, "doubao-dark");
  assert.equal(model.sync(model.sync(state, "dark"), "light").themeId, "doubao-default");
});

test("fixed presets ignore appearance changes", () => {
  for (const theme of themes) {
    const state = fixture({ themeId: theme.id });
    assert.equal(model.sync(state, "light").themeId, theme.id);
    assert.equal(model.sync(state, "dark").themeId, theme.id);
  }
});

test("pair selection is filtered, inactive changes do not switch current theme", () => {
  let state = model.select(fixture(), "system", "light");
  assert.equal(model.setPair(state, "dark", "claude", "light"), null);
  assert.equal(model.setPair(state, "nope", "trae", "light"), null);
  state = model.setPair(state, "dark", "trae", "light");
  assert.equal(state.themeId, "doubao-default");
  state = model.setPair(state, "light", "claude", "light");
  assert.equal(state.themeId, "claude");
  assert.equal(model.sync(state, "dark").themeId, "trae");
});

test("pair survives fixed/automatic toggling and restart", () => {
  let state = model.select(fixture(), "system", "light");
  state = model.setPair(state, "light", "claude", "light");
  state = model.setPair(state, "dark", "trae", "light");
  state = model.select(state, "mira", "light");
  state = model.normalize(JSON.parse(JSON.stringify(state)), "dark");
  assert.equal(state.themeId, "mira");
  state = model.select(state, "system", "dark");
  assert.equal(state.themeId, "trae");
  assert.equal(model.normalize(state, "light").themeId, "claude");
});

test("each style remembers its own colors through automatic and fixed changes", () => {
  let state = fixture({ themeId: "trae", customColors: { background: "#102030" } });
  state = model.select(state, "system", "light");
  state = model.setPair(state, "dark", "trae", "light");
  state.customColors.accent = "#ABCDEF";
  state = model.sync(state, "dark");
  assert.deepEqual(state.customColors, { background: "#102030" });
  state.customColors.background = "#203040";
  state = model.sync(state, "light");
  assert.deepEqual(state.customColors, { accent: "#ABCDEF" });
  state = model.select(state, "trae", "light");
  assert.deepEqual(state.customColors, { background: "#203040" });
  const restored = model.normalize(model.remember(state), "dark");
  assert.deepEqual(restored.customColors, state.customColors);
});

test("mode and pair changes leave layout and welcome maps untouched", () => {
  const original = fixture();
  const next = model.sync(model.setPair(model.select(original, "system", "light"), "dark", "trae", "light"), "dark");
  assert.equal(next.contentSideMargin, original.contentSideMargin);
  assert.deepEqual(next.welcomeTextByTheme, original.welcomeTextByTheme);
});

test("invalid saved ids and cross-mode pairs fall back safely", () => {
  const state = model.normalize({ themeId: "missing", themeMode: "system", themePair: { light: "trae", dark: "deleted" }, customColorsByTheme: { deleted: { accent: "#000000" } } }, "dark");
  assert.equal(state.themeId, "doubao-dark");
  assert.deepEqual(state.themePair, appearance.systemTheme);
  assert.equal(state.customColorsByTheme.deleted, undefined);
  assert.equal(model.select(state, "missing", "light"), null);
});

test("state transitions do not mutate the outgoing settings or color maps", () => {
  const state = fixture({ themeId: "trae", customColors: { accent: "#102030" } });
  const before = structuredClone(state);
  const next = model.select(state, "system", "light");
  next.customColors.accent = "#FFFFFF";
  assert.deepEqual(state, before);
});

test("browser injection compiles, including the serialized appearance model", async () => {
  const { injectionSource } = await import("../../injector.mjs");
  assert.doesNotThrow(() => new Function(injectionSource));
});
