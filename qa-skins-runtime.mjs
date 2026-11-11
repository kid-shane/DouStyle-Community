// Isolated workbench fixture. Never sends a message or opens a real conversation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {injectionSource} from './injector.mjs';
import {doubaoPageGuard} from './doubao-target.mjs';
const {chromium}=await import(process.env.DOUBAO_QA_PLAYWRIGHT || 'playwright');
const source=injectionSource.replace(doubaoPageGuard,'if (location.hostname !== "style.test") return false;');
const fixture=`<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0}#chat-route-layout{height:100vh}#chat-route-main{display:flex;height:100%}#flow_chat_sidebar{width:250px;flex-shrink:0;padding:52px 12px 12px}main{flex:1;min-width:0;position:relative}main>div{height:100%;display:flex;flex-direction:column}.h-header-height{height:48px;display:flex;gap:14px;align-items:center;padding:12px}.h-header-height>div:nth-child(2){flex:1}.nav{padding:12px;border-bottom:1px solid #eee}#flow-chat-guidance-page{flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center}.guidance-input-wrapper{width:calc(100% - 100px);margin:20px auto}.guidance-input-content{display:flex;flex-direction:column-reverse;padding:12px;gap:14px}.guidance-input-editor-wrapper{padding:12px}.tiptap{outline:none;min-height:40px}.toolbar{display:flex;gap:8px;align-items:center}.toolbar button{height:30px}.toolbar button:last-child{margin-left:auto}.greeting-text-fixture{font-size:28px}.chat-fixture{max-width:760px;margin:25px auto;line-height:1.6}.html-previewer{background:pink;color:black}</style></head><body><div id="chat-route-layout"><div id="chat-route-main"><div id="flow_chat_sidebar"><button data-testid="workspace-switch-chip">豆包工作</button><a class="group/sidebar_nav_item nav">新工作任务</a><a class="group/sidebar_nav_item nav">连接器 · 技能 · 伙伴</a><section data-testid="pinned-section"><div class="nav">置顶</div><div class="nav" data-testid="conversation-list-v2-item">产品需求讨论</div><div class="nav" data-testid="conversation-list-v2-item">本周工作安排</div></section><div data-testid="conversation-list-v2-project"><div class="nav">项目</div><div class="group/project-row nav">我的项目</div></div></div><main data-container-name="main"><div><div class="h-header-height"><button aria-label="收起侧栏">☰</button><div></div><button>工作台</button></div><div id="flow-chat-guidance-page"><div><div class="greeting-text-fixture">今天有什么工作要处理？</div></div></div><div class="guidance-input-wrapper"><div class="guidance-input-content"><div class="toolbar"><button>＋</button><button>本地电脑</button><button aria-label="模型选择">豆包 2.1 Pro</button><button disabled>发送</button></div><div class="guidance-input-editor-wrapper"><div data-testid="chat_input_input"><div class="tiptap ProseMirror" contenteditable="true" role="textbox" aria-label="消息输入"></div></div></div></div></div></div></main></div></div></body></html>`;
const browser=await chromium.launch({headless:true,channel:'chrome'});
await fs.mkdir('qa/xp',{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:1470,height:923},colorScheme:'dark'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:fixture}));await page.goto('http://style.test/');
 await page.evaluate(()=>localStorage.setItem('doubao-local-appearance-v1',JSON.stringify({defaultThemeRevision:1,themeId:'linear',themeMode:'system',themePair:{light:'claude',dark:'linear'},customColors:{accent:'#AB5678'},contentGutter:164,uiFontSize:16,chatFontSize:17,welcomeTextByTheme:{linear:'原来的欢迎语'},showConversationIcons:false})));
 await page.addInitScript({content:source});await page.evaluate(source);
 const baseline=await page.evaluate(()=>window.__doubaoThemeGetSettings());
 await page.evaluate(()=>window.__doubaoThemeOpenSettings());await page.getByRole('button',{name:'完整皮肤',exact:true}).click();
 await page.screenshot({path:'qa/xp/gallery-before.png'});
 await page.getByRole('button',{name:'应用皮肤：Windows XP',exact:true}).click();
 await page.waitForFunction(()=>document.documentElement.dataset.doubaoSkin==='windows-xp');
 assert.equal(await page.locator('.doubao-theme-settings-tabs').isVisible(),false);assert.equal(await page.locator('#doubao-theme-color-accent').isVisible(),false);
 assert.equal(await page.evaluate(()=>window.__doubaoThemeSetColor('accent','#FFFFFF')),false);
 assert.equal(await page.evaluate(()=>window.__doubaoThemeSetLayout('uiFontSize',18)),false);
 assert.deepEqual(await page.evaluate(()=>window.__doubaoThemeGetSettings()),baseline);
 await page.screenshot({path:'qa/xp/settings-fixture.png'});
 await page.getByRole('button',{name:'关闭 Style 设置',exact:true}).click();
 await page.getByRole('textbox',{name:'消息输入'}).fill('这是一条未发送的测试草稿');
 await page.screenshot({path:'qa/xp/welcome-fixture.png'});
 assert.equal(await page.locator('.doustyle-skin-mark').count(),1);
 await page.evaluate(() => {
   const welcome=document.getElementById('flow-chat-guidance-page');
   const chat=document.createElement('section');chat.className='chat-fixture';
   chat.innerHTML='<div class="bg-g-send-msg-bubble-bg" style="padding:12px">请帮我梳理这周的工作安排。</div><article data-testid="union_message"><h3>本周工作安排</h3><p>先整理需求和现有资料，再完成原型与评审。</p><table><tr><th>任务</th><th>进度</th></tr><tr><td>整理需求</td><td>已完成</td></tr><tr><td>原型评审</td><td>进行中</td></tr></table><p><a href="#notes">查看记录</a></p><div class="html-previewer" style="padding:12px"><div role="dialog" style="background:rgb(215, 177, 233);border-radius:12px">独立内容画布</div></div></article>';
   welcome.replaceWith(chat);
 });
 assert.equal(await page.locator('.html-previewer [role="dialog"]').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(215, 177, 233)');
 assert.equal(await page.locator('.bg-g-send-msg-bubble-bg').evaluate(e=>getComputedStyle(e).borderRadius),'3px');
 await page.screenshot({path:'qa/xp/conversation-fixture.png'});
 await page.emulateMedia({colorScheme:'light'});assert.equal(await page.evaluate(()=>document.documentElement.dataset.doubaoTheme),'windows-xp');
 await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.doubaoSkin==='windows-xp');
 assert.equal(await page.evaluate(()=>window.__doubaoThemeGetSettings().contentGutter),164);
 await page.evaluate(()=>window.__doubaoStyleSkins.open());
 // Export includes the complete skin; importing a remix leaves the original intact.
 await page.locator('[data-skin-id="windows-xp"] summary').click();
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出',exact:true}).click();const download=await downloadPromise;await download.saveAs('qa/xp/exported.style.json');
 const exported=JSON.parse(await fs.readFile('qa/xp/exported.style.json','utf8'));assert.equal(exported.id,'windows-xp');
 const receiver=await browser.newPage({viewport:{width:1000,height:760}});
 await receiver.route('**/*',r=>r.fulfill({contentType:'text/html',body:fixture}));await receiver.goto('http://style.test/');await receiver.evaluate(source);
 assert.equal(await receiver.evaluate(skin=>window.__doubaoStyleSkins.install(skin),exported),'windows-xp');
 assert.equal(await receiver.evaluate(()=>window.__doubaoStyleSkins.list().length),1);
 await receiver.evaluate(()=>window.__doubaoStyleSkins.apply('windows-xp'));
 assert.deepEqual(await receiver.evaluate(()=>window.__doubaoStyleSkins.export('windows-xp')),exported);await receiver.close();
 const remix={...exported,id:'silver-xp',name:'Silver XP',basedOn:{id:exported.id,version:exported.version}};
 await page.locator('.doustyle-skin-intro input').setInputFiles({name:'silver.style.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(remix))});
 await page.waitForFunction(()=>window.__doubaoStyleSkins.list().length===2);assert.equal(await page.evaluate(()=>window.__doubaoStyleSkins.active()),'windows-xp');
 await page.locator('[data-skin-id="silver-xp"]').getByRole('button',{name:'应用皮肤：Silver XP',exact:true}).click();assert.equal(await page.evaluate(()=>window.__doubaoStyleSkins.active()),'silver-xp');
 // Compact collection: direct apply, secondary menu, detail return, and partial batch imports.
 const xpCard=page.locator('[data-skin-id="windows-xp"]');const remixCard=page.locator('[data-skin-id="silver-xp"]');
 const xpRect=await xpCard.boundingBox();const remixRect=await remixCard.boundingBox();
 assert.equal(xpRect.y,remixRect.y);assert.ok(xpRect.height<215);assert.ok(remixRect.x>xpRect.x);
 assert.equal(await page.getByRole('button',{name:'导入新皮肤',exact:true}).count(),1);
 await remixCard.locator('summary').click();
 await page.keyboard.press('Escape');assert.equal(await remixCard.locator('details').getAttribute('open'),null);
 assert.equal(await page.locator('.doubao-theme-settings-panel').isVisible(),true);
 await remixCard.locator('summary').click();await remixCard.getByRole('button',{name:'查看大图'}).click();
 assert.equal(await page.locator('.doustyle-skin-grid').isVisible(),false);
 assert.equal(await page.locator('.doustyle-skin-detail h3').textContent(),'Silver XP');
 await page.screenshot({path:'qa/xp/cards-detail.png'});
 await page.keyboard.press('Escape');assert.equal(await page.locator('.doustyle-skin-grid').isVisible(),true);
 const violet={...exported,id:'violet-test',name:'紫罗兰 · 测试皮肤',tokens:{...exported.tokens,accent:'#7450A8'}};
 const green={...exported,id:'green-test',name:'森林 · 测试皮肤',tokens:{...exported.tokens,accent:'#267651'}};
 await page.locator('.doustyle-skin-intro input').setInputFiles([
   {name:'violet.style.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(violet))},
   {name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{')},
   {name:'green.style.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(green))}
 ]);
 await page.waitForFunction(()=>document.querySelector('.doustyle-skin-status').textContent.includes('broken.json'));
 assert.equal(await page.evaluate(()=>window.__doubaoStyleSkins.list().length),4);
 assert.equal(await page.evaluate(()=>window.__doubaoStyleSkins.active()),'silver-xp');
 assert.match(await page.locator('.doustyle-skin-status').textContent(),/已导入 2 套/);
 await page.screenshot({path:'qa/xp/cards-multiple.png'});
 await page.locator('[data-skin-id="green-test"] summary').click();await page.locator('[data-skin-id="green-test"]').getByRole('button',{name:'移除',exact:true}).click();
 assert.equal(await page.locator('[data-skin-id="green-test"]').count(),0);
 await page.locator('[data-skin-id="violet-test"] summary').click();await page.locator('[data-skin-id="violet-test"]').getByRole('button',{name:'移除',exact:true}).click();
 await page.getByRole('button',{name:'可调 Style',exact:true}).click();
 assert.equal(await page.locator('#doubao-theme-color-accent').isVisible(),true);assert.equal(await page.evaluate(()=>document.documentElement.hasAttribute('data-doubao-skin')),false);
 assert.equal(await page.evaluate(()=>window.__doubaoThemeGetSettings().themeId),'claude');assert.equal(await page.evaluate(()=>window.__doubaoThemeGetSettings().contentGutter),164);
 await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>window.__doubaoThemeGetSettings().themeId==='linear');assert.deepEqual(await page.evaluate(()=>window.__doubaoThemeGetSettings().customColors),{accent:'#AB5678'});
 assert.equal(await page.locator('.doustyle-skin-caption,.doustyle-skin-mark,#doustyle-skin-css').count(),0);
 await page.evaluate(()=>window.__doubaoStyleSkins.apply('windows-xp'));
 await page.setViewportSize({width:560,height:700});await page.evaluate(()=>window.__doubaoStyleSkins.open());await page.screenshot({path:'qa/xp/settings-narrow.png'});
 assert.ok(await page.locator('.doustyle-skin-pane').evaluate(e=>e.scrollWidth<=e.clientWidth));
 const rect=await page.locator('.doubao-theme-settings-panel').boundingBox();assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=560&&rect.y+rect.height<=700);
 // Invalid imports preserve the active skin and report the reason.
 await page.locator('.doustyle-skin-intro input').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"format":"wrong"}')});await page.waitForFunction(()=>document.querySelector('.doustyle-skin-status').dataset.error==='true');assert.equal(await page.evaluate(()=>window.__doubaoStyleSkins.active()),'windows-xp');
 await page.setViewportSize({width:390,height:700});assert.ok(await page.locator('.doustyle-skin-pane').evaluate(e=>e.scrollWidth<=e.clientWidth));
 await page.screenshot({path:'qa/xp/cards-phone.png'});
 assert.deepEqual(errors,[]);console.log('PASS: skin selection, locked controls, preference isolation, restart, export/import remix, invalid file recovery, system restoration, narrow panel.');
} finally {await browser.close();}
