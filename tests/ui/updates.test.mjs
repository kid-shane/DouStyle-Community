// Full settings UI in an isolated browser; no real Doubao session is used.
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { doubaoPageGuard } from "../../doubao-target.mjs";
process.env.DOUBAO_UPDATE_ENABLED = "1";
process.env.DOUBAO_APP_VERSION = "1.0.7";
const { injectionSource } = await import("../../injector.mjs");
const { chromium } = await import(process.env.DOUBAO_QA_PLAYWRIGHT || "playwright");
const source = injectionSource.replace(doubaoPageGuard, 'if (location.hostname !== "style.test") return false;');
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 750 } });
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><style>*,::before,::after{box-sizing:border-box}</style></head><body><aside id="flow_chat_sidebar">豆包 工作</aside><main>豆Style 更新验证</main></body></html>' }));
  await page.goto("http://style.test/");
  await page.evaluate(source);
  const commands = [];
  await page.exposeFunction("__doustyleUpdateCommand", command => commands.push(command));
  await page.keyboard.press("Meta+Alt+Comma");
  const button = page.locator("#doubao-theme-check-updates");
  assert.equal(await button.isEnabled(), true);
  await page.evaluate(() => window.__doubaoThemeUpdateState({ enabled: true, busy: false, version: "1.0.8" }));
  assert.match(await page.locator(".doubao-theme-update").innerText(), /v1\.0\.8/);
  await button.click();
  assert.deepEqual(commands, ["check"]);
  assert.equal(await button.isDisabled(), true);
  await page.evaluate(() => window.__doubaoThemeUpdateState({ enabled: true, busy: false, version: "1.0.8", message: "无法连接更新服务" }));
  assert.equal(await button.isEnabled(), true);
  assert.match(await button.getAttribute("title"), /无法连接/);
  for (const mode of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: mode });
    for (const theme of ["mira", "trae", "doubao-default", "doubao-dark"]) {
      await page.evaluate(theme => window.__doubaoThemeSetTheme(theme), theme);
      const footer = await page.locator(".doubao-theme-settings-footer").boundingBox();
      const buttons = await button.boundingBox();
      assert.ok(buttons.x >= footer.x && buttons.x + buttons.width <= footer.x + footer.width);
    }
  }
  await page.evaluate(() => window.__doubaoThemeSetTheme("mira"));
  await mkdir(new URL("../../qa/update/", import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL("../../qa/update/settings.png", import.meta.url)) });
  await page.evaluate(() => window.__doubaoThemeUpdateState({ enabled: false, busy: false }));
  assert.equal(await button.isDisabled(), true);
  console.log("PASS update entry: real click, busy, failure retry, disconnected state, four themes × two native modes");
} finally { await browser.close(); }
