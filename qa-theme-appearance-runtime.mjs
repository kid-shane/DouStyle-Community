// Isolated browser fixture only: never connects to Doubao or uses a user's profile.
import assert from "node:assert/strict";
import { injectionSource } from "./injector.mjs";
import { doubaoPageGuard as guard } from "./doubao-target.mjs";
const { chromium } = await import(process.env.DOUBAO_QA_PLAYWRIGHT || "playwright");
assert.ok(injectionSource.includes(guard));
const source = injectionSource.replace(guard, 'if (location.hostname !== "style.test") return false;');
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage({ colorScheme: "light", viewport: { width: 1470, height: 923 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.fulfill({
    contentType: "text/html", body: '<!doctype html><html><head></head><body><main>Style test fixture</main></body></html>'
  }));
  await page.goto("http://style.test/");
  await page.evaluate(() => localStorage.setItem("doubao-local-appearance-v1", JSON.stringify({
    defaultThemeRevision: 1, themeId: "trae", customColors: { background: "#202224" },
    sendShortcut: "command-enter", contentGutter: 100,
    welcomeTextByTheme: { trae: "深色欢迎语", claude: "浅色欢迎语" }
  })));
  await page.addInitScript({ content: source });
  await page.evaluate(source);
  const settings = () => page.evaluate(() => window.__doubaoThemeGetSettings());
  const waitTheme = (id) => page.waitForFunction((id) => document.documentElement.dataset.doubaoTheme === id, id);
  const choose = async (picker, value) => {
    await page.locator("#" + picker + "-button").click();
    await page.locator("#" + picker + '-menu [data-theme-id="' + value + '"]').click();
  };
  await page.keyboard.press("Meta+Alt+Comma");
  await waitTheme("trae");
  assert.equal(await page.locator(".doubao-theme-system-section").isVisible(), false);
  const height = (await page.locator(".doubao-theme-settings-panel").boundingBox()).height;
  assert.equal(height, 651);
  assert.equal((await settings()).cleanInput, false);
  await page.getByRole("tab", { name: "排版布局", exact: true }).click();
  await page.getByRole("switch", { name: "清爽输入", exact: true }).check();
  assert.equal((await settings()).cleanInput, true);
  await page.getByRole("tab", { name: "Style 配色", exact: true }).click();
  await choose("doubao-theme-preset", "system");
  await waitTheme("doubao-default");
  assert.equal(await page.locator("#doubao-theme-system-pair").isVisible(), true);
  assert.equal(await page.locator(".doubao-theme-system-summary, .doubao-theme-system-adjust").count(), 0);
  assert.deepEqual(await page.locator("#doubao-theme-pair-light option").evaluateAll((options) => options.map(o => o.value)), ["doubao-default", "mira", "aime", "claude"]);
  assert.deepEqual(await page.locator("#doubao-theme-pair-dark option").evaluateAll((options) => options.map(o => o.value)), ["doubao-dark", "trae", "linear"]);
  await choose("doubao-theme-pair-light", "claude");
  await choose("doubao-theme-pair-dark", "trae");
  await waitTheme("claude");
  // Escape closes the secondary picker, not the whole settings dialog.
  await page.locator("#doubao-theme-pair-dark-button").click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".doubao-theme-settings-panel").isVisible(), true);
  assert.equal(await page.locator("#doubao-theme-pair-dark-menu").isVisible(), false);
  await page.evaluate(() => window.__doubaoThemeSetColor("accent", "#654321"));
  await page.emulateMedia({ colorScheme: "dark" });
  await waitTheme("trae");
  assert.deepEqual((await settings()).customColors, { background: "#202224" });
  assert.match(await page.locator(".doubao-theme-color-context").innerText(), /Trae/);
  assert.equal(await page.locator("#doubao-theme-preset-button").innerText(), "跟随系统");
  // While a field is being edited the media change is queued, then applied on blur.
  await page.locator("#doubao-theme-hex-background").focus();
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(100);
  assert.equal((await settings()).themeId, "trae");
  await page.getByRole("tab", { name: "Style 配色", exact: true }).focus();
  await waitTheme("claude");
  assert.deepEqual((await settings()).customColors, { accent: "#654321" });
  for (const tab of ["排版布局", "欢迎页", "Style 配色"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    assert.equal((await page.locator(".doubao-theme-settings-panel").boundingBox()).height, height);
    if (tab === "欢迎页") assert.equal(await page.locator("#doubao-theme-welcome-text").inputValue(), "浅色欢迎语");
  }
  await choose("doubao-theme-preset", "trae");
  assert.equal(await page.locator("#doubao-theme-system-pair").isVisible(), false);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(100);
  assert.equal((await settings()).themeId, "trae");
  await choose("doubao-theme-preset", "system");
  assert.equal(await page.locator("#doubao-theme-system-pair").isVisible(), true);
  await waitTheme("claude");
  await page.reload();
  await waitTheme("claude");
  assert.deepEqual((await settings()).themePair, { light: "claude", dark: "trae" });
  assert.equal((await settings()).sendShortcut, undefined);
  assert.equal((await settings()).contentGutter, 100);
  assert.equal((await settings()).cleanInput, true);
  await page.evaluate(source); // Reinjection removes the prior media listener.
  await page.emulateMedia({ colorScheme: "dark" });
  await waitTheme("trae");
  await page.evaluate(() => window.__doubaoThemeResetSettings());
  assert.equal((await settings()).themeMode, "system");
  assert.deepEqual((await settings()).themePair, { light: "claude", dark: "trae" });
  assert.deepEqual((await settings()).customColors, {});
  assert.deepEqual((await settings()).customColorsByTheme.claude, { accent: "#654321" });
  assert.equal((await settings()).sendShortcut, undefined);
  // Storage failures roll back manual theme changes and provide feedback.
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("quota fixture"); }; });
  assert.equal(await page.evaluate(() => window.__doubaoThemeSetTheme("linear")), false);
  assert.equal((await settings()).themeId, "trae");
  await page.keyboard.press("Meta+Alt+Comma");
  assert.match(await page.locator(".doubao-theme-save-status").innerText(), /无法保存/);
  assert.equal(await page.locator(".doubao-theme-settings-footer-note").innerText(), "更改未保存");
  assert.deepEqual(errors, []);
  console.log("PASS isolated runtime: pickers, media changes, editing deferral, color retention, reload, reinjection, fixed height, reset, save failure");
} finally {
  await browser.close();
}
