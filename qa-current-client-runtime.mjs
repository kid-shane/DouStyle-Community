// Isolated fixture for the 2.33.7 settings/composer markup; no real account or CDP.
import assert from "node:assert/strict";
import { injectionSource } from "./injector.mjs";
import { doubaoPageGuard } from "./doubao-target.mjs";
const { chromium } = await import(process.env.DOUBAO_QA_PLAYWRIGHT || "playwright");
const source = injectionSource.replace(doubaoPageGuard, 'if (location.hostname !== "style.test") return false;');
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: `<!doctype html>
    <style>
      #flow_chat_sidebar {width:280px;height:700px;transform:translateX(0)} .group\\/sidebar_nav_item {display:flex;padding:8px}
      .sidebar-title {height:36px;position:relative}
      [data-testid=workspace-switch-chip] {width:100px;height:36px;padding:0}
      [data-testid=global-search-icon-entry] {position:absolute;right:4px;top:5px;width:26px;height:26px}
      .sidebar-scroll {height:180px;overflow:auto}
      svg {width:18px;height:18px} #input-engine-container:focus-within {box-shadow:var(--active-shadow)}
      [data-testid=settings_modal] {position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:600px;height:680px;overflow:hidden;pointer-events:auto;background:white}
      .native-header {height:56px;box-sizing:border-box;padding:12px 16px;display:flex;align-items:center;justify-content:space-between}
      .native-header button {width:32px;height:32px;padding:0;border:0}
      .native-body {height:624px;overflow:auto}
      [data-slot=switch] {background:rgba(0,0,0,.1)}
      [data-slot=switch][data-state=checked] {background:var(--dbx-fill-highlight,#06f)}
      [data-slot=switch][data-state=checked]:hover {background:var(--dbx-fill-highlight-hover,#006ce0)}
      [data-slot=switch][data-state=checked][disabled] {background:var(--dbx-fill-highlight-disable,#0066ff4d)}
    </style>
    <aside id=flow_chat_sidebar>
      <div><button id=native-back>后退</button><button id=native-forward>前进</button></div>
      <div class=sidebar-title><button data-testid=workspace-switch-chip aria-disabled=true>豆包 工作</button><button data-testid=global-search-icon-entry aria-label="搜索">⌕</button></div>
      <div class=sidebar-scroll>
      <button class="group/sidebar_nav_item"><svg><path/></svg><div><div class="truncate" style="color:black"><span style="color:black">新工作任务</span></div></div></button>
      <a class="group/sidebar_nav_item" href="#jobs"><svg><path/></svg><span>自动任务</span></a>
      <a class="group/sidebar_nav_item" href="#plugins"><svg><path/></svg><span>插件</span></a>
      <button class="group/sidebar_nav_item"><svg><path/></svg><span>更多</span></button>
      <div style="height:600px"></div></div>
    </aside><main><a id=body-link href="#reference">正文链接</a>
    <div id=input-engine-container data-testid=chat_input style="--active-shadow:0 8px 24px rgba(95,178,255,.17);box-shadow:0 8px 24px rgba(95,178,255,.17)"><textarea aria-label="Draft"></textarea></div>
    <button data-slot=switch data-state=checked role=switch aria-checked=true aria-label="Enabled"></button>
    <button data-slot=switch data-state=checked role=switch aria-checked=true aria-label="Disabled" disabled></button>
    <button data-slot=switch data-state=unchecked role=switch aria-checked=false aria-label="Off"></button></main>` }));
  await page.goto("http://style.test/");
  await page.evaluate(source);
  const trigger = page.locator("#doubao-theme-settings-trigger");
  const panel = page.locator(".doubao-theme-settings-panel");
  const entrySeenKey = "doubao-style-sidebar-entry-seen-v1";
  const expectFlower = async opacity => page.waitForFunction(expected => {
    const svg = document.querySelector("#doubao-theme-settings-trigger svg");
    return svg && getComputedStyle(svg).opacity === expected;
  }, opacity);
  await trigger.waitFor({ state: "visible" });
  const checkTitlePosition = async () => {
    const rect = await trigger.boundingBox();
    const title = await page.getByTestId("workspace-switch-chip").boundingBox();
    const search = await page.getByTestId("global-search-icon-entry").boundingBox();
    assert.ok(Math.abs(rect.x - title.x - title.width - 4) < 1, "entry follows title width");
    assert.ok(Math.abs(rect.y + rect.height / 2 - title.y - title.height / 2) < 1, "entry aligns with title center");
    assert.ok(rect.x + rect.width < search.x, "search remains unobstructed");
    return rect;
  };
  const initialRect = await checkTitlePosition();
  await expectFlower("1");
  await page.keyboard.press("Meta+Alt+Comma");
  await page.keyboard.press("Escape");
  await page.getByTestId("global-search-icon-entry").focus();
  await expectFlower("1");
  assert.equal(await page.evaluate(key => localStorage.getItem(key), entrySeenKey), null, "shortcut does not mark the sidebar entry as discovered");
  await page.locator(".sidebar-scroll").evaluate(x => x.scrollTop = 300);
  assert.deepEqual(await trigger.boundingBox(), initialRect, "entry stays with title while sidebar content scrolls");
  await page.getByTestId("workspace-switch-chip").evaluate(x => x.style.width = "140px");
  await page.waitForFunction(() => parseFloat(document.getElementById("doubao-theme-settings-trigger").style.left) >= 144);
  await checkTitlePosition();
  await trigger.click();
  assert.equal(await panel.isVisible(), true);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), entrySeenKey), "1", "successful entry activation is remembered");
  await page.keyboard.press("Escape");
  assert.equal(await trigger.evaluate(x => x === document.activeElement), true);
  await page.mouse.move(1090, 810);
  await page.getByTestId("global-search-icon-entry").focus();
  await expectFlower("0");
  await trigger.hover();
  await expectFlower("1");
  await page.mouse.move(1090, 810);
  await expectFlower("0");
  await page.keyboard.press("Tab");
  assert.equal(await trigger.evaluate(x => x === document.activeElement), true);
  await expectFlower("1");
  await page.keyboard.press("Enter");
  assert.equal(await panel.isVisible(), true, "keyboard discovery still opens the panel");
  await page.keyboard.press("Escape");
  await page.locator("#flow_chat_sidebar").evaluate(x => x.style.display = "none");
  await trigger.waitFor({ state: "hidden" });
  await page.keyboard.press("Meta+Alt+Comma");
  assert.equal(await panel.isVisible(), true, "shortcut works with sidebar collapsed");
  await page.keyboard.press("Escape");
  await page.locator("#flow_chat_sidebar").evaluate(x => x.style.display = "");
  await trigger.waitFor({ state: "visible" });
  await checkTitlePosition();
  // The entry follows a transformed sidebar instead of floating over the chat.
  await page.locator("#flow_chat_sidebar").evaluate(x => x.style.transform = "translateX(20px)");
  await checkTitlePosition();
  await page.locator("#flow_chat_sidebar").evaluate(x => x.style.transform = "");
  for (const theme of await page.evaluate(() => window.__doubaoThemeGetThemes())) {
    await page.evaluate(id => window.__doubaoThemeSetTheme(id), theme.id);
    await page.locator("textarea").focus();
    const colors = await page.evaluate(() => {
      const token = name => getComputedStyle(document.documentElement).getPropertyValue("--db-theme-" + name).trim();
      const rgb = hex => "rgb(" + hex.slice(1).match(/../g).map(x => parseInt(x, 16)).join(", ") + ")";
      return {
        labels: [...document.querySelectorAll('#flow_chat_sidebar [class*="group/sidebar_nav_item"] span')].map(x => getComputedStyle(x).color),
        icons: [...document.querySelectorAll('#flow_chat_sidebar [class*="group/sidebar_nav_item"] svg')].map(x => getComputedStyle(x).color),
        foreground: rgb(token("foreground")), accent: rgb(token("accent")),
        accentHover: rgb(token("accent-hover")),
        switches: [...document.querySelectorAll('[data-slot="switch"]')].map(x => getComputedStyle(x).backgroundColor),
        link: getComputedStyle(document.querySelector("#body-link")).color, expectedLink: rgb(token("link")),
        shadow: getComputedStyle(document.querySelector("#input-engine-container")).boxShadow,
        channels: token("accent-rgb")
      };
    });
    assert.ok(colors.labels.every(x => x === colors.foreground), theme.id + " navigation labels");
    assert.ok(colors.icons.every(x => x === colors.accent), theme.id + " navigation icons");
    assert.equal(colors.link, colors.expectedLink, "body links keep link semantics");
    assert.deepEqual(colors.switches, [colors.accent, `rgba(${colors.channels}, 0.45)`, "rgba(0, 0, 0, 0.1)"], theme.id + " checked/disabled/unchecked switch colors");
    await page.getByRole("switch", { name: "Enabled", exact: true }).hover();
    assert.equal(await page.getByRole("switch", { name: "Enabled", exact: true }).evaluate(x => getComputedStyle(x).backgroundColor), colors.accentHover, theme.id + " highlight hover");
    await page.mouse.move(1090, 810);
    assert.equal(await page.getByRole("switch", { name: "Enabled", exact: true }).getAttribute("aria-checked"), "true", "theme does not toggle native settings");
    assert.ok(colors.shadow.includes(colors.channels + ", 0.17"), theme.id + " focus glow");
    await page.locator("textarea").blur();
    const restingShadow = await page.locator("#input-engine-container").evaluate(x => getComputedStyle(x).boxShadow);
    assert.ok(!restingShadow.includes("95, 178, 255") && !restingShadow.includes(colors.channels), "resting shadow stays neutral");
  }
  // The native shortcut must reach the client; Style has a separate shortcut.
  await page.evaluate(() => document.addEventListener("keydown", event => {
    if (event.metaKey && event.shiftKey && event.code === "Comma") window.nativeShortcutReceived = true;
  }));
  await page.keyboard.press("Meta+Shift+Comma");
  assert.equal(await page.evaluate(() => window.nativeShortcutReceived), true);
  await page.keyboard.press("Meta+Alt+Comma");
  assert.equal(await panel.isVisible(), true);
  await page.keyboard.press("Escape");

  const mountNative = async () => page.evaluate(() => {
    for (const id of ["doubao-theme-settings-trigger", "doubao-theme-settings-layer"]) {
      document.getElementById(id).setAttribute("aria-hidden", "true");
      document.getElementById(id).setAttribute("data-aria-hidden", "true");
    }
    const header = document.querySelector(".doubao-theme-settings-header");
    header.setAttribute("aria-hidden", "true");
    header.setAttribute("data-aria-hidden", "true");
    const modal = document.createElement("section");
    modal.dataset.testid = "settings_modal";
    modal.setAttribute("role", "dialog");
    modal.innerHTML = '<div class="native-header"><div><button data-testid="setting-modal-back" aria-label="返回">←</button></div><div>设置</div><button data-testid="setting-modal-close" aria-label="关闭原生设置">×</button></div><div class="native-body"><div style="height:1500px"><button>设置选项</button></div></div>';
    modal.querySelector('[data-testid="setting-modal-close"]').onclick = () => { modal.remove(); document.body.style.pointerEvents = ""; };
    document.body.append(modal);
    document.body.style.pointerEvents = "none";
    // Model native focus trapping and outside/Escape dismissal.
    document.addEventListener("focusin", event => {
      if (modal.isConnected && !modal.contains(event.target)) modal.querySelector("button").focus();
    });
    document.addEventListener("keydown", event => {
      if (modal.isConnected && event.key === "Escape") modal.querySelector('[data-testid="setting-modal-close"]').click();
    }, true);
    modal.querySelector("button").focus();
  });
  await mountNative();
  await trigger.waitFor({ state: "hidden" });
  const native = await page.getByTestId("settings_modal").boundingBox();
  const back = await page.getByTestId("setting-modal-back").boundingBox();
  assert.equal(back.x - native.x, 16, "native back keeps its original position");
  assert.equal(await page.getByTestId("settings_modal").locator("#doubao-theme-settings-trigger").count(), 0, "old settings entry removed");
  await page.keyboard.press("Meta+Alt+Comma");
  assert.equal(await panel.isVisible(), true);
  await page.getByRole("heading", { name: "选择你的 Style", exact: true }).waitFor();
  const panelRect = await panel.boundingBox();
  assert.ok(panelRect.width > native.width && panelRect.x >= 16, "popover escapes transformed modal clipping");
  assert.equal(await page.locator(".doubao-theme-settings-tab[aria-selected=true]").evaluate(x => x === document.activeElement), true);
  await page.getByRole("tab", { name: "排版布局", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal(await panel.isVisible(), false);
  assert.equal(await page.getByTestId("settings_modal").isVisible(), true, "Escape closes only Style");
  assert.equal(await page.getByTestId("setting-modal-back").evaluate(x => x === document.activeElement), true);
  await page.keyboard.press("Meta+Alt+Comma");
  await page.getByRole("button", { name: "关闭 Style 设置", exact: true }).click();
  assert.equal(await page.getByTestId("settings_modal").isVisible(), true);
  await page.getByTestId("setting-modal-close").click();
  await trigger.waitFor({ state: "visible" });
  await mountNative();
  await trigger.waitFor({ state: "hidden" });
  await page.keyboard.press("Meta+Alt+Comma");
  // Native unmount while the nested panel is open must not strand the top layer.
  await page.getByTestId("settings_modal").evaluate(x => x.remove());
  await panel.waitFor({ state: "hidden" });
  await mountNative();
  await page.evaluate(source);
  await trigger.waitFor({ state: "hidden" });
  assert.equal(await trigger.count(), 1);
  assert.equal(await panel.count(), 1);
  await page.keyboard.press("Meta+Alt+Comma");
  assert.equal(await panel.isVisible(), true, "shortcut works after reinjection in a native modal");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByTestId("settings_modal").isVisible(), true, "reinjection does not let native capture Escape first");
  await page.getByTestId("setting-modal-close").click();
  await trigger.waitFor({ state: "visible" });
  await trigger.click();
  await page.setViewportSize({ width: 720, height: 640 });
  const small = await panel.boundingBox();
  assert.ok(small.x >= 12 && small.y >= 12 && small.x + small.width <= 708 && small.y + small.height <= 628);
  await page.keyboard.press("Escape");
  await checkTitlePosition();
  // React can replace the title row during route or workspace changes.
  await page.locator(".sidebar-title").evaluate(x => {
    const next = x.cloneNode(true);
    next.querySelector("#doubao-theme-settings-trigger")?.remove();
    x.replaceWith(next);
  });
  await trigger.waitFor({ state: "visible" });
  assert.equal(await trigger.count(), 1);
  await trigger.click();
  assert.equal(await panel.isVisible(), true, "entry survives sidebar header remount");
  await page.keyboard.press("Escape");
  await page.mouse.move(700, 620);
  await page.getByTestId("global-search-icon-entry").focus();
  await expectFlower("0");
  await page.reload();
  await page.evaluate(source);
  await trigger.waitFor({ state: "visible" });
  await expectFlower("0");
  await trigger.hover();
  await expectFlower("1");
  await page.mouse.move(700, 620);
  await page.evaluate(source);
  await expectFlower("0");
  // A denied storage write must not break opening or the current session.
  await page.evaluate(() => {
    localStorage.clear();
    Storage.prototype.setItem = () => { throw new DOMException("Storage denied", "SecurityError"); };
  });
  await page.evaluate(source);
  await expectFlower("1");
  await trigger.click();
  assert.equal(await panel.isVisible(), true);
  await page.keyboard.press("Escape");
  await page.mouse.move(700, 620);
  await page.getByTestId("global-search-icon-entry").focus();
  await expectFlower("0");
  assert.deepEqual(errors, []);
  console.log("PASS current-client: 7 themes, sidebar/link semantics, switch states, focus glow, title entry discovery/hover/keyboard/persistence, scroll/resize/collapse/remount, native shortcut/focus/Escape, reinjection, small viewport");
} finally { await browser.close(); }
