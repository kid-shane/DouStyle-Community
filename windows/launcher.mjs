import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const themeDirectory = await fs.access(path.join(root, 'theme', 'injector.mjs')).then(() => path.join(root, 'theme')).catch(() => root);
const { isDoubaoChatURL } = await import(pathToFileURL(path.join(themeDirectory, 'doubao-target.mjs')));
const executableNames = ['DoubaoWork.exe', 'Doubao.exe', 'doubao_work.exe', '豆包工作.exe', '豆包.exe'];

export function parsePort(value = '9237') {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1024 || Number(value) > 65535) throw Error('本机连接端口无效，请重新解压原始测试包后再试。');
  return Number(value);
}

export function isLocalExecutable(value) {
  return typeof value === 'string' && /^[A-Za-z]:[\\/]/.test(value) && /\.exe$/i.test(value) && !/[\r\n\0]/.test(value) && !/(?:^|[\\/])(?:unins[^\\/]*|[^\\/]*setup[^\\/]*)\.exe$/i.test(value);
}

export function normalizeCandidates(values) {
  return [...new Map(values.filter(isLocalExecutable).map(value => [path.win32.normalize(value).toLowerCase(), path.win32.normalize(value)])).values()];
}

export function isDoubaoDebugTarget(target, port) {
  if (target?.type !== 'page' || !isDoubaoChatURL(target.url)) return false;
  try {
    const socket = new URL(target.webSocketDebuggerUrl);
    return socket.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(socket.hostname) && Number(socket.port) === port && !socket.username && !socket.password;
  } catch { return false; }
}

export function defaultCandidates(environment = process.env) {
  const directories = [environment.LOCALAPPDATA, environment.ProgramFiles, environment['ProgramFiles(x86)']].filter(Boolean);
  return normalizeCandidates(directories.flatMap(directory => ['DoubaoWork', 'Doubao', '豆包工作', '豆包'].flatMap(name => [path.win32.join(directory, name), path.win32.join(directory, 'Programs', name)].flatMap(folder => executableNames.flatMap(exe => [path.win32.join(folder, exe), path.win32.join(folder, 'Application', exe), path.win32.join(folder, 'current', exe)])))));
}

export function redactLog(value) {
  return String(value).replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[地址已省略]');
}

// Redact only after assembling a complete UTF-8 line: a URL may span chunks.
export function createRedactedLogger(write) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let discarding = false;
  const consume = text => {
    pending += text;
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline + 1);
      if (!discarding) write(line.length > 16384 ? '[已省略超长日志行]\n' : redactLog(line));
      pending = pending.slice(newline + 1);
      discarding = false;
    }
    if (pending.length > 16384) {
      if (!discarding) write('[已省略超长日志行]\n');
      pending = '';
      discarding = true;
    }
  };
  return {
    write: chunk => consume(decoder.write(chunk)),
    end: () => { consume(decoder.end()); if (!discarding && pending) write(redactLog(pending)); pending = ''; },
  };
}

export async function powershell(script, environment = {}, { timeout = 15000 } = {}) {
  const executable = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const source = '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); $ErrorActionPreference = "Stop";\n' + script;
  const { stdout } = await execute(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { windowsHide: true, timeout, maxBuffer: 1024 * 1024, encoding: 'utf8', env: { ...process.env, ...environment } });
  return stdout.trim().replace(/^\uFEFF/, '');
}

export async function probeDebugPort(port, { request = fetch } = {}) {
  try {
    const response = await request(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500), redirect: 'error' });
    if (response.ok) {
      const targets = await response.json();
      if (Array.isArray(targets) && targets.some(target => isDoubaoDebugTarget(target, port))) return 'ready';
    }
  } catch {}
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve('occupied'));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(() => resolve('free')));
  });
}

export async function waitForDoubao(port, { probe = probeDebugPort, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 60 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await probe(port) === 'ready') return;
    if (attempt + 1 < attempts) await pause(500);
  }
  throw Error('豆包已启动，但尚未连接成功。请确认已登录并打开工作页面；若仍失败，请把日志文件发回排查。Windows 客户端可能尚不支持当前连接方式。');
}

async function registryCandidates() {
  const output = await powershell(`
    $roots = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')
    $items = @(Get-ItemProperty $roots -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '豆包|Doubao' })
    $result = @()
    foreach ($item in $items) {
      if ($item.DisplayIcon) { $result += ($item.DisplayIcon -replace ',\\s*-?\\d+\\s*$','').Trim('"') }
      if ($item.InstallLocation) {
        foreach ($name in @('DoubaoWork.exe','Doubao.exe','doubao_work.exe','豆包工作.exe','豆包.exe')) {
          $result += Join-Path $item.InstallLocation $name
          $result += Join-Path (Join-Path $item.InstallLocation 'Application') $name
        }
      }
    }
    ConvertTo-Json -InputObject @($result) -Compress
  `);
  try { return normalizeCandidates(JSON.parse(output)); } catch { return []; }
}

async function isDoubaoExecutable(candidate) {
  if (!isLocalExecutable(candidate)) return false;
  try {
    if (!(await fs.stat(candidate)).isFile()) return false;
    const identity = await powershell(`$info = [Diagnostics.FileVersionInfo]::GetVersionInfo($env:DOUSTYLE_CANDIDATE); ConvertTo-Json -InputObject @{product=$info.ProductName;description=$info.FileDescription} -Compress`, { DOUSTYLE_CANDIDATE: candidate });
    const value = JSON.parse(identity);
    return /豆包|Doubao/i.test([value.product, value.description].join(' '));
  } catch { return false; }
}

async function chooseExecutable() {
  const output = await powershell(`
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = '请选择已安装的豆包工作主程序（不是安装包）'
    $dialog.Filter = '豆包工作主程序 (*.exe)|*.exe'
    $dialog.CheckFileExists = $true
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.FileName) }
    $dialog.Dispose()
  `, {}, { timeout: 0 });
  return output || null;
}

async function findExecutable(logDirectory) {
  const cacheFile = path.join(logDirectory, '..', 'client-path.txt');
  if (process.env.DOUBAO_APP_PATH) {
    if (await isDoubaoExecutable(process.env.DOUBAO_APP_PATH)) return process.env.DOUBAO_APP_PATH;
    throw Error('指定的豆包程序无效。请将 DOUBAO_APP_PATH 指向已安装的豆包工作主程序。');
  }
  const cached = await fs.readFile(cacheFile, 'utf8').then(value => value.trim()).catch(() => '');
  let registered = [];
  try { registered = await registryCandidates(); } catch {}
  for (const candidate of normalizeCandidates([cached, ...registered, ...defaultCandidates()])) {
    if (await isDoubaoExecutable(candidate)) return candidate;
  }
  const selected = await chooseExecutable();
  if (!selected) throw Error('没有选择豆包工作程序。请先安装豆包工作，再打开豆Style。');
  if (!await isDoubaoExecutable(selected)) throw Error('所选文件不是可识别的豆包主程序。请选安装目录内的 DoubaoWork.exe 或 Doubao.exe，不要选择下载的安装包。');
  await fs.writeFile(cacheFile, selected + '\n', 'utf8');
  return selected;
}

async function isClientRunning(executable) {
  const output = await powershell(`
    $target = $env:DOUSTYLE_CANDIDATE
    $names = @('DoubaoWork.exe','Doubao.exe','doubao_work.exe','豆包工作.exe','豆包.exe')
    $running = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $target -or $names -contains $_.Name })
    [Console]::Write([bool]($running.Count -gt 0))
  `, { DOUSTYLE_CANDIDATE: executable });
  return output.toLowerCase() === 'true';
}

export async function acquireInstance(identity = process.env.LOCALAPPDATA || os.homedir()) {
  const id = createHash('sha256').update(identity.toLowerCase()).digest('hex').slice(0, 20);
  const server = net.createServer(socket => socket.destroy());
  return new Promise((resolve, reject) => {
    server.once('error', error => error.code === 'EADDRINUSE' ? resolve(null) : reject(error));
    server.listen(`\\\\.\\pipe\\doustyle-windows-${id}`, () => resolve(server));
  });
}

async function runInjector(logFile, port, version) {
  const output = createWriteStream(logFile, { flags: 'a' });
  const stdoutLog = createRedactedLogger(value => output.write(value));
  const stderrLog = createRedactedLogger(value => output.write(value));
  const child = spawn(process.execPath, [path.join(themeDirectory, 'injector.mjs')], { cwd: themeDirectory, windowsHide: true, env: { ...process.env, DOUBAO_THEME_PORT: String(port), DOUBAO_UPDATE_ENABLED: '0', DOUBAO_APP_VERSION: version }, stdio: ['ignore', 'pipe', 'pipe'] });
  let ready = false;
  let tail = '';
  let startupTimedOut = false;
  const startupTimer = setTimeout(() => {
    if (!ready && child.exitCode === null) { startupTimedOut = true; child.kill(); }
  }, 30000);
  child.stdout.on('data', chunk => {
    stdoutLog.write(chunk);
    tail = (tail + chunk.toString('utf8')).slice(-8192);
    if (!ready && tail.includes('DouStyle applied to ')) { ready = true; clearTimeout(startupTimer); process.stdout.write('DOUSTYLE_READY\n'); }
  });
  child.stderr.on('data', chunk => stderrLog.write(chunk));
  const stop = () => { if (child.exitCode === null) child.kill(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    if (startupTimedOut || !ready || code !== 0) throw Error('豆Style 未能完成连接。请查看日志文件并反馈；该测试包尚未通过 Windows 实机验证。');
  } finally {
    clearTimeout(startupTimer);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    stdoutLog.end();
    stderrLog.end();
    output.end();
  }
}

export async function main() {
  if (process.platform !== 'win32') throw Error('这是 Windows 测试启动器，请在 Windows 电脑上使用。');
  const port = parsePort(process.env.DOUBAO_THEME_PORT || '9237');
  const logDirectory = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'DouStyle', 'logs');
  await fs.mkdir(logDirectory, { recursive: true });
  const logFile = path.join(logDirectory, 'windows-test.log');
  const instance = await acquireInstance();
  if (!instance) return;
  try {
    await fs.appendFile(logFile, `\n[${new Date().toISOString()}] Windows test launcher started\n`);
    await fs.access(path.join(themeDirectory, 'injector.mjs'));
    let state = await probeDebugPort(port);
    if (state === 'occupied') throw Error(`本机连接端口 ${port} 已被其他程序占用，豆Style 未启动。请关闭占用程序，或重启电脑后再试。`);
    if (state !== 'ready') {
      const executable = await findExecutable(logDirectory);
      if (await isClientRunning(executable)) throw Error('请先保存当前任务，并从系统托盘正常退出豆包工作，再重新打开豆Style。豆Style 会启动豆包并应用外观，不会强制结束现有任务。');
      const app = spawn(executable, ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`], { detached: true, stdio: 'ignore', windowsHide: false });
      await new Promise((resolve, reject) => { app.once('spawn', resolve); app.once('error', reject); });
      app.unref();
      await waitForDoubao(port);
    }
    const version = await fs.readFile(path.join(root, 'VERSION'), 'utf8').then(value => value.trim()).catch(() => '1.1.0-windows-test');
    await runInjector(logFile, port, version);
  } catch (error) {
    await fs.appendFile(logFile, `ERROR: ${redactLog(error.message)}\n`).catch(() => {});
    throw Error(`${error.message}\n\n日志位置：${logFile}`);
  } finally { instance.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
