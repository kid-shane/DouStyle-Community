// Isolated reproduction of the 2.33.7 long-message wrapper and mask.
// The client moves the bubble background to this wrapper while collapsed.
import assert from "node:assert/strict";
import { injectionSource } from "./injector.mjs";
import { doubaoPageGuard } from "./doubao-target.mjs";
const { chromium } = await import(process.env.DOUBAO_QA_PLAYWRIGHT || "playwright");
const source = injectionSource.replace(doubaoPageGuard, 'if (location.hostname !== "style.test") return false;');
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><style>
    :root {--g-send-msg-bubble-bg:#ededed;--color-g-send-msg-bubble-text:#222;--dbx-static-black:#000;--dbx-static-white:#fff}
    @media(prefers-color-scheme:dark) {:root {--g-send-msg-bubble-bg:#262626;--color-g-send-msg-bubble-text:#fff}}
    .shell {position:relative;width:400px;--send-collapse-bg:var(--g-send-msg-bubble-bg)}
    .shell[data-collapse-theme=coco] {--send-collapse-bg:#06f}
    .shell[data-collapse-theme=coco-immerse] {--send-collapse-bg:var(--dbx-static-black)}
    .is-collapsed {background:var(--send-collapse-bg);border-radius:24px;height:var(--send-collapse-height);overflow:hidden}
    .is-collapsed .content {mask-image:linear-gradient(to bottom,var(--dbx-static-black) calc(var(--send-collapse-height) - 74px),transparent calc(var(--send-collapse-height) - 44px));mask-repeat:no-repeat;mask-size:100% var(--send-collapse-height)}
    .is-collapsed .content .bg-g-send-msg-bubble-bg {background-color:initial!important}
    .bg-g-send-msg-bubble-bg {padding:16px;border-radius:24px;background:var(--g-send-msg-bubble-bg);color:var(--color-g-send-msg-bubble-text)}
    .trigger {position:absolute;bottom:0;left:0;right:0;height:48px;display:flex;align-items:center;justify-content:center;cursor:pointer}
    .trigger span {color:var(--color-g-send-msg-bubble-text);opacity:.7}
    .trigger:hover span {opacity:1}
    [data-collapse-theme=coco] .trigger span,[data-collapse-theme=coco-immerse] .trigger span {color:var(--dbx-static-white)}
    [data-send-message-collapsed=false] .trigger {display:none}
  </style><div data-testid=send_message>
    <div class="shell is-collapsed" data-send-message-collapsed=true data-collapse-theme=coco-immerse style="--send-collapse-height:254px">
      <div class=content><div class=bg-g-send-msg-bubble-bg><div class=md-box-root data-testid=message_text_content>
        <p>长消息第一段：折叠时正文仍需清晰可读。</p>
        <p><strong>主题背景和文字</strong>应该与普通消息一致，保留原生渐隐。</p>
        <p>包含代码 <code>example.css</code> 的段落也应使用消息配色。</p>
        <p>第四段内容。</p><p>第五段内容。</p><p>最后一段完整内容。</p>
      </div></div></div>
      <div class=trigger data-testid=message_expand_all_button><span>展开全部</span></div>
    </div>
  </div><div data-testid=receive_message><div class=md-box-root>助手消息保持原有配色。</div></div>` }));
  await page.goto("http://style.test/");
  await page.evaluate(() => document.querySelector(".trigger").onclick = () => {
    const shell = document.querySelector(".shell");
    shell.dataset.sendMessageCollapsed = "false";
    shell.classList.remove("is-collapsed");
  });
  await page.evaluate(source);
  const css = (selector, property) => page.locator(selector).first().evaluate((element, key) => getComputedStyle(element)[key], property);
  const rgb = hex => "rgb(" + hex.slice(1).match(/../g).map(x => parseInt(x, 16)).join(", ") + ")";
  const checkBubble = async label => {
    const colors = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return Object.fromEntries(["user-message-background", "user-message-text", "foreground"].map(key => [key, style.getPropertyValue("--db-theme-" + key).trim()]));
    });
    const background = rgb(colors["user-message-background"]), text = rgb(colors["user-message-text"]);
    assert.equal(await css(".shell", "backgroundColor"), background, label + " collapsed background");
    assert.equal(await css(".content .bg-g-send-msg-bubble-bg", "backgroundColor"), "rgba(0, 0, 0, 0)", label + " native transparent inner bubble");
    for (const selector of [".content p", ".content strong", ".content code", ".trigger span"]) {
      assert.equal(await css(selector, "color"), text, label + " " + selector);
    }
    assert.ok((await css(".content", "maskImage")).includes("linear-gradient"), "keep native fade mask");
    {
      const channels = hex => hex.slice(1).match(/../g).map(x => parseInt(x, 16));
      const bg = channels(colors["user-message-background"]), fg = channels(colors["user-message-text"]);
      const alpha = Number(await css(".trigger span", "opacity"));
      const luminance = color => color.map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
      const blended = fg.map((x, i) => x * alpha + bg[i] * (1 - alpha));
      const [hi, lo] = [luminance(bg), luminance(blended)].sort((a, b) => b - a);
      assert.ok((hi + .05) / (lo + .05) >= 4.5, label + " expand control contrast");
    }
    await page.getByTestId("message_expand_all_button").click();
    assert.equal(await page.locator(".shell").getAttribute("data-send-message-collapsed"), "false");
    assert.equal(await css(".content", "maskImage"), "none", "expansion removes native fade");
    assert.equal(await css(".content .bg-g-send-msg-bubble-bg", "backgroundColor"), background, label + " expanded bubble");
    assert.equal(await css(".content p", "color"), text, label + " expanded text");
    assert.equal(await css('[data-testid="receive_message"] .md-box-root', "color"), rgb(colors.foreground), "assistant text remains separate");
  };
  const collapse = theme => page.evaluate(theme => {
    const shell = document.querySelector(".shell");
    shell.dataset.collapseTheme = theme;
    shell.dataset.sendMessageCollapsed = "true";
    shell.classList.add("is-collapsed");
  }, theme);
  const themes = await page.evaluate(() => window.__doubaoThemeGetThemes());
  for (const nativeMode of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: nativeMode });
    for (const theme of themes) {
      await page.evaluate(id => window.__doubaoThemeSetTheme(id), theme.id);
      for (const variant of ["samantha", "coco", "coco-immerse"]) {
        await collapse(variant);
        await page.mouse.move(950, 750);
        await checkBubble([nativeMode, theme.id, variant].join("/"));
      }
    }
  }
  await page.evaluate(() => {
    window.__doubaoThemeSetColor("userMessageBackground", "#402040");
    window.__doubaoThemeSetColor("userMessageText", "#FFF0D0");
  });
  await collapse("coco-immerse");
  await page.evaluate(source);
  assert.equal(await css(".shell", "backgroundColor"), "rgb(64, 32, 64)", "custom background is applied");
  assert.equal(await css(".content p", "color"), "rgb(255, 240, 208)", "custom text is applied");
  await checkBubble("custom colors after reinjection");
  assert.deepEqual(errors, []);
  console.log("PASS long messages: 7 themes × 2 native modes × 3 collapse variants; text/CTA contrast, native mask, expansion, custom colors, reinjection");
} finally { await browser.close(); }
