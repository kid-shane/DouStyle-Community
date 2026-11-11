// Isolated fixture for our adapter. Native Blueprint/Radix integration is also
// checked in the real client; this test never connects to the user's chat.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { installCleanInput } from "../../composer-clean-input.mjs";
const { chromium } = await import(process.env.DOUBAO_QA_PLAYWRIGHT || "playwright");
const css = await readFile(new URL("../../theme.css", import.meta.url), "utf8");
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent(`<html data-doubao-theme="trae"><head><style>
    .guidance-input-actions, .toolbar, .bp5-overflow-list {display:flex;gap:4px}
    .toolbar {width:700px;margin-top:400px} .overflow-host {flex:1}
    button {height:32px} [data-radix-popper-content-wrapper] {position:fixed;top:200px;left:80px}
    [role=menuitem] {height:38px} [role=menu] {background:white}
    /* The fixture models Blueprint's collapsed state; the client verifies its real repartitioning. */
    [data-doubao-clean-input=overflow] > .native-visible {display:none}
  </style></head><body><div id="mount"></div><button id="outside">outside</button></body></html>`);
  await page.addStyleTag({ content: css });
  await page.evaluate(() => {
    window.renderComposer = () => {
      document.getElementById("mount").innerHTML = `<div id="input-engine-container" data-testid="chat_input">
        <div class="guidance-input-actions"><div class="toolbar">
          <button data-testid="upload_file_button">+</button><div></div>
          <div data-valid-btn="mode-select-action-btn" data-slot="dropdown-menu-trigger" aria-haspopup="menu" aria-expanded="false" id="computer">
            <div id="computer-popup-host"></div><button><svg></svg>本地电脑</button>
          </div><div></div><div class="overflow-host"><div class="bp5-overflow-list">
            <div class="native-visible">项目</div><div class="native-visible">按需确认</div>
            <button id="more" data-slot="dropdown-menu-trigger" aria-haspopup="menu" aria-expanded="false">…</button>
          </div></div><button id="model">模型</button><button id="send">发送</button>
        </div></div><div contenteditable="true" class="tiptap ProseMirror">未发送草稿</div></div>`;
      const more = document.getElementById("more");
      const mode = document.getElementById("computer");
      const close = (trigger, id) => { document.getElementById(id)?.remove(); trigger.setAttribute("aria-expanded", "false"); };
      const toggleMore = () => {
        if (more.getAttribute("aria-expanded") === "true") return close(more, "more-menu");
        const menu = document.createElement("div");
        menu.id = "more-menu"; menu.setAttribute("role", "menu"); menu.dataset.state = "open";
        // Project intentionally has no tabindex, matching the current client.
        menu.innerHTML = '<div role="menuitem">项目</div><div role="menuitem" tabindex="-1">按需确认</div><div role="menuitem" tabindex="-1">企业知识</div>';
        document.body.append(menu); more.setAttribute("aria-expanded", "true"); more.setAttribute("aria-controls", menu.id);
      };
      more.addEventListener("click", toggleMore);
      more.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); toggleMore(); } });
      mode.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        window.computerOpens = (window.computerOpens || 0) + 1;
        document.getElementById("computer-popup-host").innerHTML = '<div data-radix-popper-content-wrapper><div id="computer-menu" role="menu" data-state="open"><button role="menuitem">原生电脑选择</button></div></div>';
        mode.setAttribute("aria-expanded", "true"); mode.setAttribute("aria-controls", "computer-menu");
      });
    };
    window.renderComposer();
    window.cleanEnabled = false;
  });
  const install = () => page.evaluate(`window.cleanController?.cleanup(); window.cleanController = (${installCleanInput.toString()})(() => window.cleanEnabled);`);
  const enabled = async (value) => {
    await page.evaluate((value) => { window.cleanEnabled = value; window.cleanController.sync(); }, value);
    await page.waitForFunction((value) => document.getElementById("input-engine-container").hasAttribute("data-doubao-clean-input") === value, value);
  };
  await install();
  assert.equal(await page.locator("[data-doubao-clean-input]").count(), 0);
  await enabled(true);
  assert.equal((await page.locator(".bp5-overflow-list").boundingBox()).width, 40);
  assert.equal(await page.locator("#computer > button").isVisible(), false);
  assert.equal(await page.locator("#model").isVisible(), true);
  assert.equal(await page.locator("#send").isVisible(), true);
  await page.locator("#more").click();
  const proxy = page.locator(".doubao-theme-clean-computer-item");
  await proxy.waitFor();
  await proxy.focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "项目");
  await page.keyboard.press("End");
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "企业知识");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await page.locator("#computer-menu").waitFor();
  assert.equal(await page.locator("#computer-menu").isVisible(), true, "nested native popup must not inherit the hidden trigger");
  assert.equal(await page.locator("#more-menu").count(), 0);
  assert.equal(await page.evaluate(() => window.computerOpens), 1);
  await page.evaluate(() => {
    document.getElementById("computer-popup-host").replaceChildren();
    document.getElementById("computer").setAttribute("aria-expanded", "false");
    document.getElementById("outside").focus();
  });
  await enabled(false);
  assert.equal(await page.locator("#computer > button").isVisible(), true);
  assert.equal(await page.locator("[data-doubao-clean-input]").count(), 0);
  assert.equal(await page.locator("#more").getAttribute("aria-label"), null);
  await enabled(true);
  await install();
  await page.locator("#more").click();
  await proxy.waitFor();
  assert.equal(await proxy.count(), 1);
  await enabled(false);
  assert.equal(await proxy.count(), 0);
  await page.locator("#more").click();
  await enabled(true);
  await page.evaluate(() => window.renderComposer());
  await page.waitForFunction(() => document.getElementById("input-engine-container").dataset.doubaoCleanInput === "enabled");
  assert.equal(await page.locator(".tiptap").innerText(), "未发送草稿");
  // No mouse movement or manual sync: native rerenders may reset our markers
  // while keeping the same DOM nodes, or finish assigning selectors later.
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    for (const node of document.querySelectorAll("[data-doubao-clean-input]")) node.removeAttribute("data-doubao-clean-input");
  });
  await page.waitForFunction(() => document.querySelector(".bp5-overflow-list").dataset.doubaoCleanInput === "overflow", undefined, {timeout:1500});
  assert.equal(await page.locator("#computer > button").isVisible(), false);
  await page.evaluate(() => {
    const list = document.querySelector(".bp5-overflow-list");
    const wrapper = document.createElement("div");
    list.replaceWith(wrapper); wrapper.append(list);
  });
  await page.waitForFunction(() => document.querySelector(".bp5-overflow-list").parentElement.dataset.doubaoCleanInput === "overflow-container");
  await page.evaluate(() => document.querySelector(".bp5-overflow-list").classList.remove("bp5-overflow-list"));
  await page.waitForFunction(() => !document.getElementById("input-engine-container").hasAttribute("data-doubao-clean-input"));
  assert.equal(await page.locator("#computer > button").isVisible(), true, "unrecognized markup must fall back to native controls");
  await page.evaluate(() => document.getElementById("more").parentElement.classList.add("bp5-overflow-list"));
  await page.waitForFunction(() => document.getElementById("input-engine-container").dataset.doubaoCleanInput === "enabled");
  await page.evaluate(() => document.getElementById("more").removeAttribute("aria-haspopup"));
  await page.waitForFunction(() => !document.getElementById("input-engine-container").hasAttribute("data-doubao-clean-input"));
  await page.evaluate(() => document.getElementById("more").setAttribute("aria-haspopup", "menu"));
  await page.waitForFunction(() => document.getElementById("input-engine-container").dataset.doubaoCleanInput === "enabled");
  // Idempotent repair must settle instead of generating an endless observer loop.
  await page.evaluate(() => {
    window.cleanMutations = 0;
    window.cleanMutationProbe = new MutationObserver(records => window.cleanMutations += records.length);
    window.cleanMutationProbe.observe(document.getElementById("input-engine-container"), {attributes:true,subtree:true,childList:true});
  });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => { window.cleanMutationProbe.disconnect(); return window.cleanMutations; }), 0);
  await page.evaluate(() => window.cleanController.cleanup());
  // 2.33.7 also ships a deterministic list with hidden measurement copies. Its More
  // trigger is nested and mounts only after the available width shrinks.
  await page.addStyleTag({ content: `
    .deterministic-overflow-list-fixture {display:flex;position:relative;gap:4px;flex:1}
    .overflow-measurement-layer-fixture, .overflow-measurement-item-fixture {
      position:absolute;visibility:hidden;pointer-events:none
    }
  ` });
  await page.evaluate(() => {
    window.renderComposer();
    const list = document.querySelector(".bp5-overflow-list");
    list.className = "deterministic-overflow-list-fixture";
    list.innerHTML = `<div class="overflow-visible-item-fixture" id="native-tools"><button>项目</button><button>企业知识</button><button>插件</button></div>
      <div class="overflow-measurement-layer-fixture" aria-hidden="true"><button data-slot="dropdown-menu-trigger" aria-haspopup="menu">测量用技能菜单</button><button>测量用更多</button></div>`;
    const nativeTools = document.getElementById("native-tools");
    window.originalNativeTools = nativeTools;
    window.modernResizeObserver = new ResizeObserver(() => {
      const collapsed = list.getBoundingClientRect().width <= 40;
      nativeTools.classList.toggle("overflow-measurement-item-fixture", collapsed);
      nativeTools.setAttribute("aria-hidden", String(collapsed));
      if (!collapsed) { list.querySelector("#modern-more-wrap")?.remove(); return; }
      if (list.querySelector("#modern-more-wrap")) return;
      const wrap = document.createElement("div");
      wrap.id = "modern-more-wrap";
      wrap.innerHTML = '<button id="more" data-slot="dropdown-menu-trigger" aria-haspopup="menu" aria-expanded="false"><div>…</div></button>';
      list.append(wrap);
      const more = wrap.firstElementChild;
      const toggle = () => {
        if (more.getAttribute("aria-expanded") === "true") {
          document.getElementById("more-menu")?.remove(); more.setAttribute("aria-expanded", "false"); return;
        }
        const menu = document.createElement("div");
        menu.id = "more-menu"; menu.setAttribute("role", "menu"); menu.dataset.state = "open";
        menu.innerHTML = '<div role="menuitem" tabindex="-1">项目</div><div role="menuitem" tabindex="-1">企业知识</div><div role="menuitem" tabindex="-1">技能</div><div role="menuitem" tabindex="-1">插件</div>';
        document.body.append(menu); more.setAttribute("aria-expanded", "true"); more.setAttribute("aria-controls", menu.id);
      };
      more.addEventListener("click", toggle);
      more.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); toggle(); } });
    });
    window.modernResizeObserver.observe(list.parentElement);
  });
  await install();
  await page.getByRole("button", { name: "更多输入选项", exact: true }).waitFor({timeout:2000});
  assert.equal(await page.locator("#computer > button").isVisible(), false);
  assert.equal(await page.locator("#native-tools").isVisible(), false);
  assert.equal(await page.getByTestId("upload_file_button").isVisible(), true);
  assert.equal(await page.locator("#model").isVisible(), true);
  assert.equal(await page.locator("#send").isVisible(), true);
  await page.getByRole("button", { name: "更多输入选项", exact: true }).click();
  await proxy.waitFor();
  assert.deepEqual(await page.locator('#more-menu [role="menuitem"]').allTextContents(), ["本地电脑›", "项目", "企业知识", "技能", "插件"]);
  await proxy.click();
  await page.locator("#computer-menu").waitFor();
  assert.equal(await page.locator("#computer-menu").isVisible(), true);
  await page.evaluate(() => {
    document.getElementById("computer-popup-host").replaceChildren();
    document.getElementById("computer").setAttribute("aria-expanded", "false");
  });
  await enabled(false);
  await page.locator("#native-tools").waitFor({state:"visible"});
  assert.equal(await page.locator("#computer > button").isVisible(), true);
  assert.equal(await page.evaluate(() => window.originalNativeTools === document.getElementById("native-tools")), true, "React-owned tool nodes stay in place");
  await enabled(true);
  await page.getByRole("button", { name: "更多输入选项", exact: true }).waitFor();
  await install();
  await page.getByRole("button", { name: "更多输入选项", exact: true }).waitFor();
  assert.equal(await page.locator(".tiptap").innerText(), "未发送草稿");
  // A single-mode task puts Computer among the native tool items, without the
  // separate mode-select anchor used by the old toolbar.
  await page.locator("#computer").evaluate(node => node.remove());
  await page.getByRole("button", { name: "更多输入选项", exact: true }).click();
  await page.locator("#more-menu").waitFor();
  assert.equal(await proxy.count(), 0, "no duplicate Computer proxy when native overflow owns it");
  assert.equal(await page.getByRole("menuitem", { name: "插件", exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "更多输入选项", exact: true }).click();
  await enabled(false);
  await page.locator("#native-tools").waitFor({state:"visible"});
  await enabled(true);
  await page.getByRole("button", { name: "更多输入选项", exact: true }).waitFor();
  await page.evaluate(() => {
    window.cleanMutations = 0;
    window.cleanMutationProbe = new MutationObserver(records => window.cleanMutations += records.length);
    window.cleanMutationProbe.observe(document.getElementById("input-engine-container"), {attributes:true,subtree:true,childList:true});
  });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => { window.cleanMutationProbe.disconnect(); return window.cleanMutations; }), 0);
  await page.evaluate(() => { window.cleanController.cleanup(); window.modernResizeObserver.disconnect(); });
  // The live client's Blueprint variant also has no More at wide widths and
  // lazy-loads its real menu only when the placeholder receives mouseover.
  await page.evaluate(() => {
    window.renderComposer();
    const list = document.querySelector(".bp5-overflow-list");
    const more = document.getElementById("more");
    more.remove();
    window.moreWarmups = 0;
    window.lazyMoreObserver = new ResizeObserver(() => {
      if (list.getBoundingClientRect().width > 40) { more.remove(); list.querySelector("#lazy-more")?.remove(); return; }
      if (more.isConnected || list.querySelector("#lazy-more")) return;
      const placeholder = document.createElement("button");
      placeholder.id = "lazy-more"; placeholder.textContent = "…";
      placeholder.addEventListener("mouseover", () => {
        window.moreWarmups++;
        requestAnimationFrame(() => { if (placeholder.isConnected) placeholder.replaceWith(more); });
      });
      list.append(placeholder);
    });
    window.lazyMoreObserver.observe(list.parentElement);
  });
  await install();
  await page.getByRole("button", { name: "更多输入选项", exact: true }).waitFor({timeout:2000});
  assert.equal(await page.evaluate(() => window.moreWarmups), 1, "lazy menu loads without mouse movement");
  assert.equal(await page.locator("#computer > button").isVisible(), false);
  await page.getByRole("button", { name: "更多输入选项", exact: true }).click();
  await proxy.waitFor();
  assert.equal(await page.getByRole("menuitem", { name: "项目", exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "更多输入选项", exact: true }).click();
  await enabled(false);
  assert.equal(await page.locator("#computer > button").isVisible(), true);
  await page.evaluate(() => { window.cleanController.cleanup(); window.lazyMoreObserver.disconnect(); });
  assert.deepEqual(errors, []);
  console.log("PASS clean input fixture: legacy and current deterministic toolbars, lazy nested More, measurement copies, native popup, keyboard, remount, marker repair, reparenting, delayed selectors, no mouse/manual sync, settled observers, fail-open, draft preservation");
} finally { await browser.close(); }
