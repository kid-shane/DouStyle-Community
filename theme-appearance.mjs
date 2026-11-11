// Kept self-contained so the same model can run in Node tests and the injected page.
export function createThemeAppearanceModel(themes, defaultThemeId, colorKeys, defaultPair) {
  const themeMap = new Map(themes.map((theme) => [theme.id, theme]));
  const keys = new Set(colorKeys);
  const modes = ["light", "dark"];
  const isPairTheme = (mode, id) => modes.includes(mode) && themeMap.get(id)?.baseMode === mode;
  const cleanColors = (colors) => Object.fromEntries(
    Object.entries(colors && typeof colors === "object" ? colors : {})
      .filter(([key, value]) => keys.has(key) && typeof value === "string" && /^#[\da-f]{6}$/i.test(value))
      .map(([key, value]) => [key, value.toUpperCase()])
  );
  const cleanPair = (pair) => Object.fromEntries(modes.map((mode) => [mode,
    isPairTheme(mode, pair?.[mode]) ? pair[mode]
      : isPairTheme(mode, defaultPair?.[mode]) ? defaultPair[mode]
        : themes.find((theme) => theme.baseMode === mode)?.id || defaultThemeId
  ]));
  const remember = (settings) => ({
    ...settings,
    customColorsByTheme: {
      ...settings.customColorsByTheme,
      [settings.themeId]: { ...settings.customColors }
    }
  });
  const resolve = (settings, systemMode) => settings.themeMode === "system"
    ? settings.themePair[systemMode === "dark" ? "dark" : "light"]
    : settings.themeId;
  const activate = (settings, systemMode) => {
    const themeId = resolve(settings, systemMode);
    return { ...settings, themeId, customColors: { ...settings.customColorsByTheme[themeId] } };
  };
  const normalize = (saved, systemMode) => {
    const themeId = themeMap.has(saved.themeId) ? saved.themeId : defaultThemeId;
    const customColorsByTheme = Object.fromEntries(
      Object.entries(saved.customColorsByTheme || {})
        .filter(([id]) => themeMap.has(id))
        .map(([id, colors]) => [id, cleanColors(colors)])
    );
    // The legacy active-color field remains an API-compatible alias.
    if (saved.customColors && typeof saved.customColors === "object") {
      customColorsByTheme[themeId] = cleanColors(saved.customColors);
    }
    return activate({
      themeId,
      themeMode: saved.themeMode === "system" ? "system" : "fixed",
      themePair: cleanPair(saved.themePair),
      customColorsByTheme
    }, systemMode);
  };
  const sync = (settings, systemMode) => activate(remember(settings), systemMode);
  const select = (settings, value, systemMode) => {
    if (value !== "system" && !themeMap.has(value)) return null;
    return activate({
      ...remember(settings),
      themeMode: value === "system" ? "system" : "fixed",
      themeId: value === "system" ? settings.themeId : value
    }, systemMode);
  };
  const setPair = (settings, mode, id, systemMode) => {
    if (!isPairTheme(mode, id)) return null;
    return activate({
      ...remember(settings), themePair: { ...settings.themePair, [mode]: id }
    }, systemMode);
  };
  return { normalize, remember, resolve, sync, select, setPair };
}
