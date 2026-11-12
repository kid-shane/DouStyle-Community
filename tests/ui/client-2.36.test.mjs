// Sanitized selectors and native token declarations sampled from Doubao Work 2.36.15.
import assert from "node:assert/strict";
import test from "node:test";
import { injectionSource } from "../../injector.mjs";
import { doubaoPageGuard } from "../../doubao-target.mjs";
const { chromium } = await import(process.env.DOUBAO_QA_PLAYWRIGHT || "playwright");
const source = injectionSource.replace(doubaoPageGuard, 'if (location.hostname !== "style.test") return false;');
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const fixturePage = async (body, css = "") => {
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  page.setDefaultTimeout(6000);
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><style>${css}</style>${body}` }));
  await page.goto("http://style.test/");
  await page.evaluate(source);
  return page;
};
const settled = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
try {
  await test("welcome replaces both legacy and 2.36 native logos across Styles and remounts", async () => {
    const page = await fixturePage('<main><div id="flow-chat-guidance-page"></div></main>', `
      [data-guidance-position=welcome] {display:flex;flex-direction:column;align-items:center;gap:20px;position:relative}
      [data-guidance-office-logo] {width:90px;height:90px}
      .legacy-welcome {position:absolute;top:40%}
    `);
    try {
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      const themes = await page.evaluate(() => window.__doubaoThemeGetThemes());
      for (const markup of ["legacy", "current"]) {
        await page.evaluate(markup => {
          document.getElementById("flow-chat-guidance-page").innerHTML = markup === "legacy"
            ? '<div class="legacy-welcome"><img src="/doubao-office-logo.png"><div class="greeting-text-fixture">原生欢迎语</div></div>'
            : '<div data-guidance-position="welcome"><img data-guidance-office-logo="true" src="/doubaowork_logo_new_390.png"><div class="greeting-text-fixture">原生欢迎语</div></div>';
        }, markup);
        for (const theme of themes) {
          await page.evaluate(id => window.__doubaoThemeSetTheme(id), theme.id);
          await page.evaluate(() => window.__doubaoThemeSetWelcomeImage("none"));
          await settled(page);
          assert.equal(await page.locator("#flow-chat-guidance-page > div > img").isVisible(), false, markup + "/" + theme.id + " native logo hidden");
          assert.equal(await page.locator("#doubao-theme-welcome-image").count(), 0, "none leaves no image slot");
          await page.evaluate(png => window.__doubaoThemeSetWelcomeImage(png), png);
          await page.locator("#doubao-theme-welcome-image img").waitFor({ state: "visible" });
          assert.equal(await page.locator("#doubao-theme-welcome-image").count(), 1);
          assert.equal(await page.locator("#flow-chat-guidance-page > div > img").isVisible(), false, "custom image replaces the native logo");
          await page.evaluate(() => window.__doubaoThemeOpenSettings());
          assert.equal(await page.locator(".doubao-theme-welcome-preview-image img").getAttribute("src"), png);
        }
        await page.evaluate(() => {
          const old = document.querySelector("#flow-chat-guidance-page > div");
          const next = old.cloneNode(true);
          next.querySelector("#doubao-theme-welcome-image")?.remove();
          old.replaceWith(next);
        });
        await page.locator("#doubao-theme-welcome-image img").waitFor({ state: "visible" });
        await page.evaluate(source);
        await settled(page);
        assert.equal(await page.locator("#doubao-theme-welcome-image").count(), 1, "route remount and reinjection keep a single image");
        if (markup === "current") {
          assert.equal(await page.locator("[data-guidance-position=welcome]").evaluate(e => getComputedStyle(e).transform), "none", "native flex positioning remains intact");
        }
      }
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  await test("2.36 native settings keep readable surfaces in both native appearance modes", async () => {
    const page = await fixturePage(`<main></main><div data-testid="settings_modal" data-setting-modal-layer>
      <nav><button aria-current="page">通用</button></nav>
      <section><h2>通用</h2><div class="native-setting-cell">发送按键设置</div><button role="switch" aria-checked="true">开机自动启动</button></section>
    </div><div id="outside-native">未适配的原生素材</div>`, `
      :root[data-dbd-color-mode=light] {--dbd-bg-subtle-3:#f9f9f9;--dbd-bg-base-4:#fff;--dbd-bg-subtle-4:#f3f3f3;--dbd-bg-base-5:#fff}
      :root[data-dbd-color-mode=dark] {--dbd-bg-subtle-3:#1f1f1f;--dbd-bg-base-4:#252525;--dbd-bg-subtle-4:#252525;--dbd-bg-base-5:#3a3a3a}
      [data-setting-modal-layer] {--setting-background:var(--dbd-bg-subtle-3);--setting-cell-background:var(--dbd-bg-base-4);--setting-navigation-background:var(--dbd-bg-subtle-4);--setting-navigation-selected-background:var(--dbd-bg-base-5);background:var(--setting-background)!important;color:var(--dbx-text-primary);display:flex;width:700px;height:400px}
      [data-setting-modal-layer] nav {background:var(--setting-navigation-background);padding:20px}
      [data-setting-modal-layer] nav [aria-current] {background:var(--setting-navigation-selected-background)}
      .native-setting-cell {padding:20px;background:var(--setting-cell-background);color:var(--dbx-text-primary)}
      #outside-native {background:var(--dbd-bg-subtle-3)}
    `);
    try {
      const themes = await page.evaluate(() => window.__doubaoThemeGetThemes());
      const rgb = hex => "rgb(" + hex.slice(1).match(/../g).map(v => parseInt(v, 16)).join(", ") + ")";
      const contrast = (a, b) => {
        const luminance = c => c.match(/[\d.]+/g).slice(0,3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126,.7152,.0722][i], 0);
        const [high, low] = [luminance(a), luminance(b)].sort((a, b) => b - a);
        return (high + .05) / (low + .05);
      };
      for (const nativeMode of ["dark", "light"]) {
        await page.evaluate(mode => document.documentElement.dataset.dbdColorMode = mode, nativeMode);
        for (const theme of themes) {
          await page.evaluate(id => window.__doubaoThemeSetTheme(id), theme.id);
          await settled(page);
          const colors = await page.evaluate(() => {
            const root = getComputedStyle(document.documentElement);
            const bg = selector => getComputedStyle(document.querySelector(selector)).backgroundColor;
            return {
              modal: bg('[data-setting-modal-layer]'), cell: bg('.native-setting-cell'), nav: bg('nav'),
              text: getComputedStyle(document.querySelector('.native-setting-cell')).color,
              selected: bg('nav button'), outside: bg('#outside-native'),
              tokens: Object.fromEntries(['surface-elevated','surface','sidebar','selection-background','foreground'].map(k => [k,root.getPropertyValue('--db-theme-' + k).trim()]))
            };
          });
          assert.equal(colors.modal, rgb(colors.tokens['surface-elevated']), nativeMode + "/" + theme.id + " dialog surface");
          assert.equal(colors.cell, rgb(colors.tokens.surface));
          assert.equal(colors.nav, rgb(colors.tokens.sidebar));
          const selection = await page.evaluate(value => {
            const e = document.createElement('div'); e.style.backgroundColor = value; return e.style.backgroundColor;
          }, colors.tokens['selection-background']);
          assert.equal(colors.selected, selection, "native navigation keeps the Style's selection color");
          for (const bg of [colors.modal, colors.cell, colors.nav]) assert.ok(contrast(colors.text, bg) > 4.5, nativeMode + "/" + theme.id + " text contrast");
          assert.equal(colors.outside, nativeMode === "dark" ? "rgb(31, 31, 31)" : "rgb(249, 249, 249)", "DBD colors outside settings stay native");
          assert.equal(await page.getByRole('switch').getAttribute('aria-checked'), 'true');
        }
      }
      await page.evaluate(() => window.__doubaoThemeSetColor('background', '#EEE8DF'));
      await page.evaluate(source);
      await settled(page);
      const custom = await page.locator('[data-setting-modal-layer]').evaluate(e => ({ actual: getComputedStyle(e).backgroundColor, expected: getComputedStyle(document.documentElement).getPropertyValue('--db-theme-surface-elevated').trim() }));
      assert.equal(custom.actual, rgb(custom.expected), "custom colors survive reinjection in native settings");
    } finally { await page.close(); }
  });
} finally { await browser.close(); }
