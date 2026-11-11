#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkshopInstaller } from './skin-workshop.mjs';
import { createSkinModel } from './skin-model.mjs';
import { isDoubaoChatURL } from './doubao-target.mjs';
const model = createSkinModel();
const [command, ...args] = process.argv.slice(2);
const help = '豆Style 皮肤工坊\n  list | status | open | restore\n  schema | install-skill [目标目录]\n  validate <file.style.json>\n  import <file.style.json>\n  apply <skin-id>\n  export <skin-id> <output.style.json>\n  remove <skin-id>\n  capture <output.png>\n导入后不会自动应用。同 ID 不覆盖，修改后使用新 ID。';
async function readSkin(file) {
  if (!file) throw new Error('请指定 .style.json 文件');
  const stat = await fs.stat(file); if (stat.size > model.maxBytes) throw new Error('皮肤文件不能超过 1 MB');
  return model.normalize(JSON.parse(await fs.readFile(file,'utf8')));
}
async function connect() {
  const port = process.env.DOUBAO_THEME_PORT || '9237';
  if (!/^\d{1,5}$/.test(port) || Number(port) > 65535) throw new Error('本地端口无效');
  let targets;
  try { targets = await (await fetch('http://127.0.0.1:' + port + '/json/list',{signal:AbortSignal.timeout(3000)})).json(); }
  catch { throw new Error('未连接到豆包工作，请先启动支持完整皮肤的豆Style。'); }
  const candidates = targets.filter(t => t.type === 'page' && isDoubaoChatURL(t.url) && !t.url.includes('/cross-site-support'));
  if (!candidates.length) throw new Error('未找到豆包工作页面');
  // Pick the visible work page; never read or evaluate content in other origins.
  for (const target of candidates) {
    const endpoint = new URL(target.webSocketDebuggerUrl);
    if (endpoint.protocol !== 'ws:' || !['127.0.0.1','localhost'].includes(endpoint.hostname) || endpoint.port !== port) continue;
    const ws = new WebSocket(endpoint);
    await new Promise((resolve,reject) => { const timer=setTimeout(()=>{ws.close();reject(new Error('连接超时'));},3000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true}); ws.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('连接失败'));},{once:true}); });
    let id=0; const pending=new Map();
    ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}});
    const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(new Error('豆Style 响应超时'));},5000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));});
    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description || '皮肤操作失败');return r.result.value;};
    const status=await evaluate('({ready:!!window.__doubaoStyleSkins,visible:document.visibilityState==="visible"})');
    if (status.ready && (status.visible || candidates.length === 1)) return {call,evaluate,close:()=>ws.close()};
    ws.close();
  }
  throw new Error('当前豆Style 尚未启用完整皮肤，请启动新版预览。');
}
try {
  if (!command || ['help','--help','-h'].includes(command)) console.log(help);
  else if (command === 'install-skill') {
    const result = await createWorkshopInstaller().install(args[0]);
    if (result.status !== 'installed') throw new Error(result.message || '技能未安装');
    console.log(JSON.stringify({installed:true,...result}));
  }
  else if (command === 'schema') console.log(JSON.stringify({format:model.format,schemaVersion:1,components:Object.keys(model.selectors),properties:model.properties,states:['hover','active','focus-visible','disabled'],maxBytes:model.maxBytes,example:path.join(path.dirname(fileURLToPath(import.meta.url)),'skins/windows-xp.style.json')},null,2));
  else if (command === 'validate') {const skin=await readSkin(args[0]);console.log(JSON.stringify({valid:true,id:skin.id,name:skin.name}));}
  else {
    const methods={list:'list',status:'active',open:'open',restore:'restore',import:'install',apply:'apply',export:'export',remove:'remove'};
    if (!methods[command] && command !== 'capture') throw new Error(help);
    if (['apply','export','remove'].includes(command) && !args[0]) throw new Error('请指定皮肤 ID');
    if (['export','capture'].includes(command) && !(command === 'export' ? args[1] : args[0])) throw new Error('请指定输出路径');
    const payload=command==='import'?await readSkin(args[0]):args[0];
    const client=await connect();
    try {
      if(command==='capture'){const result=await client.call('Page.captureScreenshot',{format:'png'});await fs.writeFile(args[0],Buffer.from(result.data,'base64'),{flag:'wx'});console.log(path.resolve(args[0]));}
      else {
        const value=await client.evaluate('window.__doubaoStyleSkins.'+methods[command]+'('+(payload===undefined?'':JSON.stringify(payload))+')');
        if(command==='export'){await fs.writeFile(args[1],JSON.stringify(value,null,2)+'\n',{flag:'wx'});console.log(path.resolve(args[1]));}
        else console.log(JSON.stringify(value,null,2));
      }
    } finally {client.close();}
  }
} catch(error) {console.error(error.message);process.exitCode=1;}
