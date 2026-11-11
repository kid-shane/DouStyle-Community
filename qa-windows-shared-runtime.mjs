// Isolated profiles only: this test never connects to the user's Doubao client.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { injectionSource } from './injector.mjs';
import { doubaoPageGuard } from './doubao-target.mjs';
const { chromium } = await import(process.env.DOUBAO_QA_PLAYWRIGHT || 'playwright');
const source = injectionSource.replace(doubaoPageGuard, 'if (location.hostname !== "style.test") return false;');
const browser = await chromium.launch({headless:true,channel:'chrome'});
try {
  for (const platform of ['Win32','MacIntel']) {
    const context=await browser.newContext({viewport:{width:1100,height:820}});
    await context.addInitScript(platform => {
      Object.defineProperty(navigator,'platform',{get:()=>platform});
      Object.defineProperty(navigator,'userAgentData',{get:()=>({platform:platform === 'Win32' ? 'Windows' : 'macOS'})});
    },platform);
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset=utf-8>
      <style>*,::before,::after{box-sizing:border-box}body{margin:0}#flow_chat_sidebar{width:280px;height:100vh}.sidebar-title{position:relative;height:40px}
      [data-testid=workspace-switch-chip]{width:100px;height:36px}[data-testid=global-search-icon-entry]{position:absolute;right:4px;top:5px;width:26px;height:26px}
      main{position:absolute;left:300px;top:90px}svg{width:18px;height:18px}</style>
      <aside id=flow_chat_sidebar><div class=sidebar-title><button data-testid=workspace-switch-chip aria-disabled=true>豆包 工作</button><button data-testid=global-search-icon-entry aria-label=搜索>⌕</button></div><button class="group/sidebar_nav_item">新工作任务</button></aside>
      <main><div class=md-box-root>Windows 测试 / DouStyle</div><div id=input-engine-container data-testid=chat_input><textarea aria-label=草稿></textarea></div></main>`}));
    await page.goto('http://style.test/');
    await page.evaluate(source);
    await page.locator('#doubao-theme-settings-trigger').waitFor({state:'visible'});
    const panel=page.locator('.doubao-theme-settings-panel');
    await page.keyboard.press(platform === 'Win32' ? 'Meta+Alt+Comma' : 'Control+Alt+Comma');
    assert.equal(await panel.isVisible(),false,'the other platform shortcut must remain untouched');
    await page.keyboard.press(platform === 'Win32' ? 'Control+Alt+Shift+Comma' : 'Meta+Alt+Shift+Comma');
    assert.equal(await panel.isVisible(),false,'the native Shift combination must remain untouched');
    await page.keyboard.press(platform === 'Win32' ? 'Control+Alt+Comma' : 'Meta+Alt+Comma');
    await panel.waitFor({state:'visible'});
    await page.keyboard.press('Escape');
    await panel.waitFor({state:'hidden'});
    await page.locator('#doubao-theme-settings-trigger').click();
    await panel.waitFor({state:'visible'});
    if (platform === 'Win32') {
      const output=new URL('./qa/windows-shared/',import.meta.url);await mkdir(output,{recursive:true});
      await page.screenshot({path:fileURLToPath(new URL('windows-settings.png',output))});
    }
    assert.deepEqual(errors,[]);
    await context.close();
    console.log(`${platform}: platform shortcut, native modifier preservation, Escape, sidebar entry passed`);
  }
} finally { await browser.close(); }
