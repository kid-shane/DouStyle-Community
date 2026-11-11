import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createWorkshopInstaller,createWorkshopBridge} from '../../skin-workshop.mjs';

const trusted = {origin:'doubaowork://doubaowork-chat',auxData:{isDefault:true}};
test('install finds local workspace, preserves existing work, and reports real file state', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(),'doustyle-workshop-'));
  try {
    const installer = createWorkshopInstaller({home, platform:'darwin', env:{}});
    assert.equal((await installer.status()).status,'missing');
    const root = path.join(home,'Library/Application Support/DoubaoWork/Default/.doubaowork/agent_mode/workspace/.user_skills');
    await fs.mkdir(root,{recursive:true});
    assert.equal((await installer.status()).status,'available');
    const result = await installer.install(); assert.equal(result.status,'installed');
    assert.equal((await installer.status()).status,'installed');
    await fs.writeFile(path.join(result.path,'user-notes.md'),'keep');
    await installer.install(); assert.equal(await fs.readFile(path.join(result.path,'user-notes.md'),'utf8'),'keep');
    await fs.appendFile(path.join(result.path,'SKILL.md'),'\nUser customization\n');
    assert.equal((await installer.install()).status,'conflict');
    assert.match(await fs.readFile(path.join(result.path,'SKILL.md'),'utf8'),/User customization/);
    await fs.rm(result.path,{recursive:true});
    const elsewhere=path.join(home,'elsewhere'); await fs.mkdir(elsewhere); await fs.symlink(elsewhere,result.path);
    assert.equal((await installer.install()).status,'conflict'); assert.deepEqual(await fs.readdir(elsewhere),[]);
  } finally { await fs.rm(home,{recursive:true,force:true}); }
});
test('bridge accepts only fixed commands from native default contexts and serializes writes', async () => {
  let complete; let calls=0;
  const bridge=createWorkshopBridge({status:async()=>({status:'available'}),install:()=>{calls++;return new Promise(r=>{complete=r;});}});
  await bridge.refresh();assert.equal(bridge.state.status,'available');
  for (const command of ['rm','{"command":"install","path":"/tmp"}', 'install /tmp']) assert.equal(bridge.request(command,trusted),false);
  assert.equal(bridge.request('install',{...trusted,origin:'https://example.com'}),false);
  assert.equal(bridge.request('install',{...trusted,auxData:{isDefault:false}}),false);
  assert.equal(bridge.request('install',trusted),true);assert.equal(bridge.state.status,'installing');
  bridge.request('install',trusted);await new Promise(r=>setImmediate(r));assert.equal(calls,1);
  complete({status:'installed',path:'/private/not-exposed'});await new Promise(r=>setImmediate(r));assert.deepEqual(bridge.state,{status:'installed'});
});
test('filesystem failure is recoverable and does not report installation success', async () => {
  let fail=true;
  const bridge=createWorkshopBridge({status:async()=>({status:'available'}),install:async()=>{if(fail)throw Object.assign(Error('private path'),{code:'EACCES'});return {status:'installed'};}});
  bridge.request('install',trusted);await new Promise(r=>setImmediate(r));assert.equal(bridge.state.status,'error');assert.match(bridge.state.message,/访问权限/);assert.ok(!bridge.state.message.includes('private path'));
  fail=false;bridge.request('install',trusted);await new Promise(r=>setImmediate(r));assert.equal(bridge.state.status,'installed');
});

test('Windows only installs into existing skills roots and writes native commands', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(),'doustyle-workshop-win-'));
  const appdata = path.join(home,'Roaming');
  try {
    const installer = createWorkshopInstaller({home, platform:'win32', env:{APPDATA:appdata, LOCALAPPDATA:path.join(home,'Local')}});
    assert.equal((await installer.install()).status,'missing');
    assert.deepEqual(await fs.readdir(home),[], 'missing clients must not create guessed folders');
    const root = path.join(appdata,'DoubaoWork/Default/.doubaowork/agent_mode/workspace/.user_skills');
    await fs.mkdir(root,{recursive:true});
    const result = await installer.install();
    assert.equal(result.status,'installed');
    assert.equal((await installer.status()).status,'installed');
    const skill = await fs.readFile(path.join(result.path,'SKILL.md'),'utf8');
    assert.match(skill, /"<SKILL_DIR>\\scripts\\doustyle\.cmd" status/);
    assert.ok(!skill.includes('bash <SKILL_DIR>'));
    assert.ok((await fs.stat(path.join(result.path,'scripts/doustyle.cmd'))).isFile());
    await assert.rejects(fs.access(path.join(result.path,'scripts/doustyle.sh')),{code:'ENOENT'});
    await fs.appendFile(path.join(result.path,'scripts/doustyle.cmd'),'rem user customization\r\n');
    assert.equal((await installer.install()).status,'conflict');
    assert.match(await fs.readFile(path.join(result.path,'scripts/doustyle.cmd'),'utf8'),/user customization/);
  } finally { await fs.rm(home,{recursive:true,force:true}); }
});

test('Windows detects node.exe in a portable package and can locate a direct profile', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(),'doustyle-workshop-package-'));
  try {
    const resources = path.join(home,'豆Style 测试包');
    const directory = path.join(resources,'theme');
    await fs.mkdir(path.join(resources,'runtime'),{recursive:true});
    await fs.writeFile(path.join(resources,'runtime/node.exe'),'test runtime marker');
    await fs.mkdir(path.join(directory,'skills'),{recursive:true});
    await fs.cp(new URL('../../skills/doustyle-skin-workshop/',import.meta.url),path.join(directory,'skills/doustyle-skin-workshop'),{recursive:true});
    const local = path.join(home,'Local');
    const root = path.join(local,'Doubao/.doubaowork/agent_mode/workspace/.user_skills');
    await fs.mkdir(root,{recursive:true});
    const installer = createWorkshopInstaller({directory,home,platform:'win32',env:{APPDATA:path.join(home,'Roaming'),LOCALAPPDATA:local}});
    const result = await installer.install();
    assert.equal(result.status,'installed');
    assert.equal(await fs.readFile(path.join(result.path,'local-resources.txt'),'utf8'),resources+'\n');
    await assert.rejects(fs.access(path.join(result.path,'local-source.txt')),{code:'ENOENT'});
  } finally { await fs.rm(home,{recursive:true,force:true}); }
});

test('explicit existing skills root is supported but links remain protected', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(),'doustyle-workshop-root-'));
  try {
    const root=path.join(home,'explicit');
    const installer=createWorkshopInstaller({home,platform:'win32',env:{DOUSTYLE_SKILL_ROOT:root}});
    assert.equal((await installer.install()).status,'missing');
    await fs.mkdir(root);
    assert.equal((await installer.install()).status,'installed');
    await fs.rm(root,{recursive:true});
    const target=path.join(home,'elsewhere');await fs.mkdir(target);await fs.symlink(target,root);
    assert.equal((await installer.install()).status,'missing');
    assert.deepEqual(await fs.readdir(target),[]);
  } finally { await fs.rm(home,{recursive:true,force:true}); }
});

test('macOS keeps the shipped skill unchanged and does not require the Windows helper', async () => {
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'doustyle-workshop-mac-'));
  try {
    const root=path.join(home,'Library/Application Support/DoubaoWork/Default/.doubaowork/agent_mode/workspace/.user_skills');
    await fs.mkdir(root,{recursive:true});
    const installer=createWorkshopInstaller({home,platform:'darwin',env:{}});
    const result=await installer.install();
    assert.equal(result.status,'installed');
    assert.deepEqual(await fs.readFile(path.join(result.path,'SKILL.md')),await fs.readFile(new URL('../../skills/doustyle-skin-workshop/SKILL.md',import.meta.url)));
    await assert.rejects(fs.access(path.join(result.path,'scripts/doustyle.cmd')),{code:'ENOENT'});
    assert.equal((await installer.status()).status,'installed');
  } finally { await fs.rm(home,{recursive:true,force:true}); }
});
