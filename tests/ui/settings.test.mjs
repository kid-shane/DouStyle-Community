// Full-injection regression in an isolated Chrome profile. Native scope/selector
// samples below were inspected in the client; no live chats or preferences change.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { injectionSource } from "../../injector.mjs";
import { doubaoPageGuard } from "../../doubao-target.mjs";
const { chromium } = await import(process.env.DOUBAO_QA_PLAYWRIGHT || "playwright");
const source = injectionSource.replace(
  doubaoPageGuard,
  'if (location.hostname !== "style.test") return false;'
);
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const output = new URL("../../qa/release-regression/", import.meta.url);
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1470, height: 923 }, colorScheme: "dark" });
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
    *,::before,::after {box-sizing:border-box;}
    body { margin:0; --s-color-bg-float:#fff; --s-color-bg-tertiary:#f3f4f6; --s-color-text-primary:#111; }
    @media(prefers-color-scheme:dark) { body { --s-color-bg-float:#232528; --s-color-bg-tertiary:#121317; --s-color-text-primary:#fff; } }
    #flow_chat_sidebar { position:fixed;left:0;top:0;width:260px;height:100vh; }
    main { margin:60px 60px 0 300px; } .md-box-root {margin:20px 0;}
    .table-wrapper-fixture {border:1px solid var(--s-color-border-secondary);border-radius:12px;overflow:hidden;}
    .table-header-fixture {background:var(--s-color-bg-tertiary,#f3f4f6);padding:14px;}
    table {border-collapse:collapse;width:100%;} th,td {padding:16px;border:1px solid #ddd;}
    th {background:var(--s-color-bg-primary);}
    .area-fixture {padding:6px;border-radius:24px 24px 0 0;background:var(--input-engine-suggestion-area-background,var(--input-guidance-input-container-background,var(--dbx-bg-float,#fff)));}
    [role=option] {padding:12px;color:var(--s-color-text-primary);}
    [role=option]:hover,[role=option][data-active=true] {background:var(--dbx-fill-trans-10-hover);}
    [role=menu] {padding:12px;background:var(--dbx-bg-float);color:var(--dbx-text-primary);}
    #input-engine-container {margin-top:24px;border:1px solid #ccc;border-radius:24px;overflow:hidden;}
    .tiptap {padding:20px;} .bg-g-send-msg-bubble-bg {padding:15px;border-radius:12px;}
    .native-code-header {background:var(--s-color-bg-tertiary);padding:10px;}
    .native-code-body {padding:14px;background:var(--s-color-bg-secondary);}
  </style></head><body><div id="root"><div id="chat-route-layout" style="--s-color-bg-body:var(--dbx-bg-body-web);--input-guidance-input-container-background:var(--s-color-bg-float)">
  <aside id="flow_chat_sidebar">豆包 工作</aside><main>
    <div class="bg-g-send-msg-bubble-bg"><div class="md-box-root">我的消息 / User message</div></div>
    <div class="md-box-root"><h3>回归样例 · 代码与表格</h3><div class="native-code-header">bash</div><div class="native-code-body">python3 sort_numbers.py 5 2 9 1 3</div>
      <div class="table-wrapper-fixture"><div class="table-header-fixture">表格</div><table><thead><tr><th>项目</th><th>状态</th></tr></thead><tbody><tr><td>主题映射</td><td><code>ready</code></td></tr></tbody></table></div>
    </div>
    <div class="message-container-fixture"><div class="message-area-fixture"><div class="skeleton-fixture">Loading</div></div></div>
    <div id="input-engine-container"><div class="guidance-input-surface"><div class="relative"><div class="area-fixture panel-fixture"><div role="listbox"><div role="option" data-active="true">示例项目 · 本地文件夹</div><div role="option">另一个项目</div></div></div></div><div class="tiptap ProseMirror" contenteditable="true">未发送草稿</div></div></div>
    <div role="menu" id="native-more">电脑 · 项目 · 按需确认</div>
    <div id="flow-chat-guidance-page"><div class="greeting-text-fixture">今天有什么工作要处理？</div></div>
  </main></div></div></body></html>`;
  await page.route("**/*", route => route.fulfill({ contentType:"text/html", body:fixture }));
  await page.goto("http://style.test/");
  await page.evaluate(() => {
    localStorage.setItem("doubao-local-appearance-v1", JSON.stringify({defaultThemeRevision:1,themeId:"mira",sendShortcut:"command-enter"}));
    localStorage.setItem("native-send-fixture", "command-enter");
    const legacyHandler = event => { if (event.key === "Enter") event.preventDefault(); };
    window.addEventListener("keydown", legacyHandler, true);
    window.__doubaoThemeComposerShortcutsCleanup = () => {
      window.removeEventListener("keydown", legacyHandler, true);
      window.__legacyShortcutRemoved = true;
    };
    window.__doubaoThemeSetSendShortcut = () => { throw Error("Retired API used"); };
  });
  await page.addInitScript({ content: source });
  await page.evaluate(source);
  const nativeSend = await page.evaluate(() => {
    const editor = document.querySelector(".tiptap");
    const events = [false,true].map(metaKey => {
      const event = new KeyboardEvent("keydown", {key:"Enter",code:"Enter",metaKey,bubbles:true,cancelable:true});
      editor.dispatchEvent(event);
      return {metaKey:event.metaKey,shiftKey:event.shiftKey,prevented:event.defaultPrevented};
    });
    return {
      cleaned:window.__legacyShortcutRemoved,
      api:typeof window.__doubaoThemeSetSendShortcut,
      cleanup:typeof window.__doubaoThemeComposerShortcutsCleanup,
      saved:JSON.parse(localStorage.getItem("doubao-local-appearance-v1")).sendShortcut ?? null,
      native:localStorage.getItem("native-send-fixture"), events
    };
  });
  assert.deepEqual(nativeSend, {cleaned:true,api:"undefined",cleanup:"undefined",saved:null,native:"command-enter",events:[
    {metaKey:false,shiftKey:false,prevented:false},{metaKey:true,shiftKey:false,prevented:false}
  ]});
  const settings = () => page.evaluate(() => window.__doubaoThemeGetSettings());
  const setTheme = async id => {
    assert.equal(await page.evaluate(id => window.__doubaoThemeSetTheme(id), id), true);
    await page.waitForFunction(id => document.documentElement.dataset.doubaoTheme === id, id);
  };
  const css = (selector, prop) => page.locator(selector).first().evaluate((e, p) => getComputedStyle(e)[p], prop);
  const rgb = hex => `rgb(${hex.replace("#", "").match(/../g).map(v => parseInt(v,16)).join(", ")})`;
  const tokens = () => page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return Object.fromEntries(["surface", "surface-tertiary", "surface-elevated", "foreground", "user-message-background", "user-message-text"].map(k => [k, s.getPropertyValue("--db-theme-"+k).trim()]));
  });
  const contrast = (a,b) => {
    const lum = rgb => rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    const [hi,lo]=[lum(a),lum(b)].sort((a,b)=>b-a);return (hi+.05)/(lo+.05);
  };
  const themes = await page.evaluate(() => window.__doubaoThemeGetThemes());
  for (const nativeMode of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme:nativeMode });
    for (const theme of themes) {
      await setTheme(theme.id);
      const t = await tokens();
      assert.equal(await css(".area-fixture", "backgroundColor"),rgb(t.surface), `${nativeMode}/${theme.id} project surface`);
      assert.equal(await css(".table-header-fixture", "backgroundColor"),rgb(t["surface-tertiary"]));
      assert.equal(await css("#native-more", "backgroundColor"),rgb(t["surface-elevated"]));
      assert.equal(await css("[role=option]", "color"),rgb(t.foreground));
      assert.ok(contrast(rgb(t.surface),rgb(t.foreground)) > 4.5,theme.id+" project contrast");
      assert.ok(contrast(rgb(t["surface-tertiary"]),rgb(t.foreground)) > 4.5,theme.id+" table contrast");
      await page.locator('.area-fixture [role=option]').last().hover();
      assert.notEqual(await css('.area-fixture [role=option]:last-child',"backgroundColor"),"rgba(0, 0, 0, 0)");
      assert.equal(await css('.message-container-fixture',"display"),"none");
      assert.equal(await page.locator('.tiptap').innerText(),"未发送草稿");
      if(theme.id==="trae") {
        assert.equal(await css('.bg-g-send-msg-bubble-bg',"backgroundColor"),"rgb(4, 98, 49)");
        assert.equal(await css('.bg-g-send-msg-bubble-bg .md-box-root',"color"),"rgb(255, 255, 255)");
      }
      if(nativeMode==="dark") await page.screenshot({ path:fileURLToPath(new URL(theme.id+".png",output)) });
    }
  }
  console.log("PASS 7 Styles × 2 native modes: project/table/menu tokens, hover, contrast, Trae bubble, skeleton, draft");
  await setTheme("mira");
  await page.evaluate(() => window.__doubaoThemeSetColor("background", "#EEE8DF"));
  assert.equal(await css('.area-fixture',"backgroundColor"),rgb((await tokens()).surface));
  await page.evaluate(source);
  assert.equal(await css('.area-fixture',"backgroundColor"),rgb((await tokens()).surface));
  await page.keyboard.press("Meta+Alt+Comma");
  const panel=page.locator('.doubao-theme-settings-panel');
  assert.equal(await css('.doubao-theme-settings-layer',"backdropFilter"),"none");
  assert.equal(await css('.doubao-theme-settings-layer',"backgroundColor"),"rgba(0, 0, 0, 0)");
  for(const viewport of [{width:1470,height:923},{width:1000,height:700},{width:800,height:620}]) {
    await page.setViewportSize(viewport);
    for(const tab of ["Style 配色","排版布局","欢迎页"]) {
      await page.getByRole('tab',{name:tab,exact:true}).click();
      const r=await panel.boundingBox();
      assert.equal(r.height,Math.min(651,viewport.height-32));
      assert.ok(r.x>=11&&r.y>=11&&r.x+r.width<=viewport.width-11&&r.y+r.height<=viewport.height-11,JSON.stringify({viewport,tab,rect:r}));
      const dimensions=await page.locator('.doubao-theme-settings-content').evaluate(e=>({scroll:e.scrollWidth,width:e.clientWidth,overflow:[...e.querySelectorAll('*')].filter(c=>c.getBoundingClientRect().right>e.getBoundingClientRect().right+1&&c.getBoundingClientRect().width).map(c=>c.className).slice(0,8)}));
      assert.ok(dimensions.scroll<=dimensions.width+1,JSON.stringify({viewport,tab,dimensions}));
    }
  }
  await page.setViewportSize({width:1470,height:923});
  await page.getByRole('tab',{name:'排版布局',exact:true}).click();
  const layoutOrder=await page.locator('#doubao-theme-pane-layout input').evaluateAll(es=>es.map(e=>e.id));
  assert.ok(layoutOrder.indexOf('doubao-theme-toggle-cleanInput')>layoutOrder.indexOf('doubao-theme-toggle-showConversationIcons'));
  for(const key of ["uniformChatTypography","showConversationIcons","cleanInput"]) {
    const control=page.locator('#doubao-theme-toggle-'+key);const before=await control.isChecked();
    await control.setChecked(!before);await control.setChecked(before);
  }
  for(const [key,value] of [["uiFontSize","16"],["chatFontSize","18"],["chatLineHeight","1.8"],["contentGutter","120"]]) {
    await page.locator('#doubao-theme-setting-'+key).fill(value);
    assert.equal((await settings())[key],Number(value));
  }
  assert.equal(await page.locator('.doubao-theme-shortcut-row').count(),0);
  assert.equal((await settings()).sendShortcut,undefined);
  const rect=await panel.boundingBox();
  await page.mouse.move(rect.x+100,rect.y+25);await page.mouse.down();await page.mouse.move(rect.x+190,rect.y+65,{steps:6});await page.mouse.up();
  const moved=await panel.boundingBox();assert.ok(moved.x>rect.x+50,"header dragging moves panel");
  await page.mouse.move(moved.x+100,moved.y+25);await page.mouse.down();await page.mouse.move(5,5,{steps:8});await page.mouse.up();
  const clamped=await panel.boundingBox();assert.ok(clamped.x>=11&&clamped.y>=11,"dragging clamps edges");
  await page.getByRole('tab',{name:'欢迎页',exact:true}).click();
  const order=await page.locator('#doubao-theme-pane-welcome > *').evaluateAll(es=>es.map(e=>e.textContent));
  assert.match(order[0],/实时预览/);assert.match(order[1],/欢迎图/);assert.match(order[2],/欢迎语/);
  await page.locator('#doubao-theme-welcome-image-upload').hover();
  const accent=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--db-theme-accent').trim());
  await page.waitForFunction(color=>getComputedStyle(document.getElementById('doubao-theme-welcome-image-upload')).backgroundColor===color,rgb(accent));
  assert.equal(await css('#doubao-theme-welcome-image-upload','backgroundColor'),rgb(accent),'upload highlights the entire button');
  const input=page.locator('.doubao-theme-welcome-file-input');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
  await input.setInputFiles([{name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')},{name:'oversize.png',mimeType:'image/png',buffer:Buffer.alloc(2097153)}]);
  await page.waitForFunction(()=>document.querySelector('.doubao-theme-welcome-status').textContent.includes('未加入'));
  assert.equal((await settings()).welcomeImageLibrary.length,0);
  await input.setInputFiles(Array.from({length:11},(_,i)=>({name:`fixture-${i}.png`,mimeType:'image/png',buffer:png})));
  await page.waitForFunction(()=>window.__doubaoThemeGetSettings().welcomeImageLibrary.length===10);
  assert.equal(await page.locator('.doubao-theme-welcome-library-item').count(),10);
  assert.equal(await page.locator('#doubao-theme-welcome-image-upload').isDisabled(),true);
  await page.waitForFunction(()=>[...document.querySelectorAll('.doubao-theme-welcome-library-thumbnail img')].length===10&&[...document.querySelectorAll('.doubao-theme-welcome-library-thumbnail img')].every(i=>i.complete&&i.naturalWidth>0));
  await page.locator('#doubao-theme-welcome-text').fill('回归验证欢迎语');
  const selected=(await settings()).welcomeImageByTheme.mira;
  await page.evaluate(()=>window.__doubaoThemeSetWelcomeImageLayout({zoom:150,positionX:60,positionY:45}));
  await page.reload();
  assert.equal((await settings()).sendShortcut,undefined);
  assert.equal((await settings()).chatFontSize,18);
  assert.equal((await settings()).contentGutter,120);
  assert.equal((await settings()).welcomeImageLibrary.length,10);
  assert.equal((await settings()).welcomeImageByTheme.mira,selected);
  assert.deepEqual((await settings()).welcomeImageLayoutByTheme.mira,{zoom:150,positionX:60,positionY:45});
  assert.equal((await settings()).welcomeTextByTheme.mira,'回归验证欢迎语');
  await page.keyboard.press('Meta+Alt+Comma');await page.getByRole('tab',{name:'欢迎页',exact:true}).click();
  await page.locator('.doubao-theme-welcome-library-remove').first().click();
  await page.waitForFunction(()=>window.__doubaoThemeGetSettings().welcomeImageLibrary.length===9);
  await page.waitForFunction(()=>!document.getElementById('doubao-theme-welcome-image-upload').disabled);
  assert.notEqual((await settings()).welcomeImageByTheme.mira,selected);
  assert.equal(await page.locator('#doubao-theme-welcome-image-upload').isEnabled(),true);
  assert.equal(await page.locator('#doubao-theme-welcome-image-mira').count(),0);
  await page.locator('#doubao-theme-welcome-image-none').click();
  assert.equal((await settings()).welcomeImageByTheme.mira,'none');
  await page.getByRole('button',{name:'恢复默认欢迎语',exact:true}).click();
  assert.equal((await settings()).welcomeTextByTheme.mira,undefined);
  await page.screenshot({path:fileURLToPath(new URL('welcome-gallery.png',output))});
  await page.evaluate(()=>window.__doubaoThemeResetSettings());
  assert.equal((await settings()).cleanInput,false);
  assert.equal((await settings()).welcomeImageLibrary.length,9,"reset retains user's image library");
  assert.deepEqual(errors,[]);
  console.log("PASS full settings: tokens after reinjection, 3 tabs × 3 window sizes, transparent layer, drag/clamp, toggles/sliders/native send delegation, welcome upload hover/validation/10 cap/delete/builtins/crop/reload/reset");
} finally {await browser.close();}
