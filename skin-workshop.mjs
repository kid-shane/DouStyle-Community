import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { isDoubaoChatOrigin } from './doubao-target.mjs';

export function createWorkshopInstaller({ directory = path.dirname(fileURLToPath(import.meta.url)), home = os.homedir(), platform = process.platform, env = process.env } = {}) {
  const source = path.join(directory, 'skills', 'doustyle-skin-workshop');
  const windows = platform === 'win32';
  // Keep the macOS installation byte-for-byte compatible with existing installs.
  const required = ['SKILL.md', windows ? 'scripts/doustyle.cmd' : 'scripts/doustyle.sh', 'references/skin-format.md'];
  const readSource = async name => {
    const data = await fs.readFile(path.join(source, name));
    if (!windows || name !== 'SKILL.md') return data;
    return Buffer.from(data.toString('utf8')
      .replace(/```bash/g, '```bat')
      .replace(/bash <SKILL_DIR>\/scripts\/doustyle\.sh/g, '"<SKILL_DIR>\\scripts\\doustyle.cmd"'));
  };
  const locate = async () => {
    const roots = [];
    if (env.DOUSTYLE_SKILL_ROOT) roots.push(env.DOUSTYLE_SKILL_ROOT);
    const bases = windows
      ? [env.APPDATA || path.join(home, 'AppData', 'Roaming'), env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')]
      : [path.join(home, 'Library', 'Application Support')];
    for (const base of new Set(bases)) for (const app of ['DoubaoWork', 'Doubao']) {
      for (const profile of windows ? ['Default', ''] : ['Default']) {
        roots.push(path.join(base, app, profile, '.doubaowork', 'agent_mode', 'workspace', '.user_skills'));
      }
    }
    // Only use an existing skills root; never create guessed client directories.
    for (const root of roots) {
      try { if ((await fs.lstat(root)).isDirectory()) return path.join(root, 'doustyle-skin-workshop'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return null;
  };
  const status = async destination => {
    destination ||= await locate();
    if (!destination) return { status: 'missing', message: '暂时没找到安装位置，请先打开豆包的本地电脑工作区，再试一次。' };
    try {
      if (!(await fs.lstat(destination)).isDirectory()) return { status: 'conflict', message: '发现同名文件或链接，已保留原有内容，请先检查豆包中的皮肤工坊。' };
    } catch (error) { if (error.code === 'ENOENT') return { status: 'available' }; throw error; }
    for (const name of required) {
      try {
        const installed = path.join(destination, name);
        // Do not follow a user-replaced scripts/reference directory or file.
        const parent = path.dirname(installed);
        if ((parent !== destination && !(await fs.lstat(parent)).isDirectory()) || !(await fs.lstat(installed)).isFile()) throw Error('conflict');
        if (!(await fs.readFile(installed)).equals(await readSource(name))) throw Error('conflict');
      } catch { return { status: 'conflict', message: '已有同名技能，但内容与本版不同或不完整。已保留原内容，未覆盖安装。' }; }
    }
    return { status: 'installed' };
  };
  const install = async explicitDestination => {
    const destination = explicitDestination || await locate();
    if (!destination) return status();
    const current = await status(destination);
    if (current.status !== 'available') return current;
    // Read bundled files before reserving a destination; mkdir is exclusive across competing installs.
    const files = await Promise.all(required.map(async name => [name, await readSource(name)]));
    try { await fs.mkdir(destination); }
    catch (error) { if (error.code === 'EEXIST') return status(destination); throw error; }
    try {
      for (const [name, data] of files) {
        await fs.mkdir(path.dirname(path.join(destination, name)), {recursive:true});
        await fs.writeFile(path.join(destination, name), data, {flag:'wx',mode:name.endsWith('.sh') ? 0o755 : 0o644});
      }
      const resources = path.dirname(directory);
      let bundled = false;
      try { await fs.access(path.join(resources,'runtime',windows ? 'node.exe' : 'node')); bundled = true; } catch {}
      await fs.writeFile(path.join(destination, bundled ? 'local-resources.txt' : 'local-source.txt'), (bundled ? resources : directory) + '\n', {flag:'wx'});
      return { status:'installed', path:destination };
    } catch (error) {
      await fs.rm(destination, {recursive:true,force:true});
      throw error;
    }
  };
  return { status, install };
}

// A closed command set: the page never supplies filesystem paths, code, or download URLs.
export function createWorkshopBridge(installer = createWorkshopInstaller()) {
  let state = {status:'checking'};
  let pending;
  const listeners = new Set();
  const publish = next => { state = next; for (const listener of listeners) listener(state); };
  const run = command => {
    if (pending) return pending;
    publish({status:command === 'install' ? 'installing' : 'checking'});
    pending = Promise.resolve().then(() => installer[command === 'install' ? 'install' : 'status']())
      .then(result => publish({status:result.status, ...(result.message ? {message:result.message} : {})}))
      .catch(error => publish({status:'error',message:['EACCES','EPERM'].includes(error.code)
        ? '暂时无法写入豆包的技能目录，请检查本机访问权限后重试。'
        : '安装服务暂时未完成操作，请重试；仍有问题时重新打开豆Style。'}))
      .finally(() => { pending = null; });
    return pending;
  };
  return {
    get state() { return state; },
    refresh: () => run('status'),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    request(command, context) {
      if (!['status','install'].includes(command) || context?.auxData?.isDefault !== true || !isDoubaoChatOrigin(context.origin)) return false;
      void run(command); return true;
    }
  };
}
