import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { parsePort, isLocalExecutable, normalizeCandidates, isDoubaoDebugTarget, defaultCandidates, probeDebugPort, waitForDoubao, redactLog, createRedactedLogger } from '../../windows/launcher.mjs';

test('connection port must be a nonprivileged numeric TCP port', () => {
  assert.equal(parsePort(), 9237);
  assert.equal(parsePort('65535'), 65535);
  for (const value of ['0', '80', '65536', '9237x', '9237/other', '-1', '127.0.0.1:9237']) assert.throws(() => parsePort(value));
});

test('only local absolute executable paths are launch candidates', () => {
  assert.equal(isLocalExecutable('C:\\Users\\测试 用户\\DoubaoWork\\DoubaoWork.exe'), true);
  assert.equal(isLocalExecutable('D:/Apps/Doubao/Doubao.exe'), true);
  for (const value of ['Doubao.exe', '\\\\server\\apps\\Doubao.exe', 'https://example.test/Doubao.exe', 'C:\\Downloads\\DoubaoSetup.exe', 'C:\\Doubao\\unins000.exe', 'C:\\Apps\\Doubao.exe\n']) assert.equal(isLocalExecutable(value), false, value);
  assert.deepEqual(normalizeCandidates(['C:\\Apps\\Doubao.exe', 'c:/apps/Doubao.exe', 'invalid']), ['c:\\apps\\Doubao.exe']);
});

test('registry fallback never uses a relative Program Files path', () => {
  assert.deepEqual(defaultCandidates({}), []);
  const values = defaultCandidates({ LOCALAPPDATA: 'C:\\Users\\测试\\AppData\\Local' });
  assert(values.includes('C:\\Users\\测试\\AppData\\Local\\Programs\\DoubaoWork\\DoubaoWork.exe'));
  assert(values.every(isLocalExecutable));
});

test('a valid app URL also requires a local debugger websocket on the same port', () => {
  const target = { type: 'page', url: 'doubaowork://doubaowork-chat/new', webSocketDebuggerUrl: 'ws://127.0.0.1:9237/devtools/page/test' };
  assert.equal(isDoubaoDebugTarget(target, 9237), true);
  for (const changes of [
    { type: 'service_worker' },
    { url: 'https://example.test/' },
    { url: 'doubaowork://doubaowork-chat-evil/new' },
    { webSocketDebuggerUrl: 'ws://example.test:9237/devtools/page/test' },
    { webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/test' },
    { webSocketDebuggerUrl: 'ws://user:password@127.0.0.1:9237/devtools/page/test' },
    { webSocketDebuggerUrl: 'not a URL' },
  ]) assert.equal(isDoubaoDebugTarget({ ...target, ...changes }, 9237), false);
});

test('probe distinguishes a valid Doubao endpoint, an unrelated service and a free port', async () => {
  let targets = [];
  const server = http.createServer((request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(targets)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    assert.equal(await probeDebugPort(port), 'occupied');
    targets = [{ type: 'page', url: 'chrome://doubao-chat/test', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/test` }];
    assert.equal(await probeDebugPort(port), 'ready');
  } finally { await new Promise(resolve => server.close(resolve)); }
  assert.equal(await probeDebugPort(port), 'free');
});

test('startup wait is bounded and tolerates a client warming up', async () => {
  const states = ['free', 'occupied', 'ready'];
  let checks = 0;
  let pauses = 0;
  await waitForDoubao(9237, { probe: async () => { checks++; return states.shift(); }, pause: async () => { pauses++; }, attempts: 3 });
  assert.equal(checks, 3);
  assert.equal(pauses, 2);
  checks = 0;
  await assert.rejects(waitForDoubao(9237, { probe: async () => { checks++; return 'occupied'; }, pause: async () => {}, attempts: 3 }), /尚未连接成功/);
  assert.equal(checks, 3);
});

test('logs omit conversation URLs even when protocol and IDs span chunks', () => {
  assert.equal(redactLog('DouStyle applied to doubaowork://doubaowork-chat/private-id?user=123'), 'DouStyle applied to [地址已省略]');
  const output = [];
  const logger = createRedactedLogger(value => output.push(value));
  const source = Buffer.from('豆Style applied to doubaowork://doubaowork-chat/private-id?user=123\nnext ws://127.0.0.1:9237/devtools/page/private-id');
  for (let index = 0; index < source.length; index += 2) logger.write(source.subarray(index, index + 2));
  logger.end();
  assert.equal(output.join(''), '豆Style applied to [地址已省略]\nnext [地址已省略]');
  assert(!output.join('').includes('private-id'));
});

test('logs drop oversized lines without leaking a partial conversation URL', () => {
  const output = [];
  const logger = createRedactedLogger(value => output.push(value));
  logger.write(Buffer.from('x'.repeat(17000) + 'doubaowork://doubaowork-chat/'));
  logger.write(Buffer.from('private-id\nnormal message\n'));
  logger.end();
  assert.equal(output.join(''), '[已省略超长日志行]\nnormal message\n');
});
