import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createUpdateBridge, isUpdateContext } from "../../update-bridge.mjs";

const trusted = { origin: "doubao://doubao-chat", auxData: { isDefault: true } };
test("only the default Doubao context may request a check", () => {
  assert.equal(isUpdateContext(trusted), true);
  for (const origin of ["chrome://doubaowork-chat", "doubaowork://doubaowork-chat", "chrome://doubao-chat/"]) {
    assert.equal(isUpdateContext({ ...trusted, origin }), true);
    assert.equal(isUpdateContext({ ...trusted, origin, auxData: { isDefault: false } }), false);
  }
  for (const origin of ["https://doubao-chat", "https://doubaowork-chat", "https://example.com", "doubao://doubao-chat.evil", "chrome://doubaowork-chat.evil", "chrome://doubaowork-chat/chat", "null"]) {
    assert.equal(isUpdateContext({ ...trusted, origin }), false);
  }
  assert.equal(isUpdateContext({ ...trusted, auxData: { isDefault: false } }), false);
});
test("strict command allowlist, debounce, busy and disabled gate", () => {
  const sent = [];
  const bridge = createUpdateBridge({ enabled: true, version: "1.0.7", send: x => sent.push(x) });
  assert.equal(bridge.request('{"url":"https://evil"}', trusted, 3000), false);
  assert.equal(bridge.request("check", { origin: "https://evil" }, 3000), false);
  assert.equal(bridge.request("check", trusted, 3000), true);
  assert.equal(bridge.request("check", trusted, 3001), false);
  assert.deepEqual(sent, ["check"]);
  const off = createUpdateBridge({ enabled: false, version: "", send: () => assert.fail() });
  assert.equal(off.request("check", trusted, 9000), false);
});
test("native status, invalid input, broken pipe and recovery", async () => {
  const input = new PassThrough();
  const bridge = createUpdateBridge({ enabled: true, version: "1.0.7", input, send: () => {} });
  bridge.start();
  input.write('garbage\n{"type":"update-state","enabled":true,"busy":true}\n');
  assert.equal(bridge.state.busy, true);
  assert.equal(bridge.request("check", trusted), false);
  input.write('{"type":"update-state","enabled":true,"busy":false,"message":"offline"}\n');
  assert.equal(bridge.state.message, "offline");
  assert.equal(bridge.request("check", trusted), true);
  input.end();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(bridge.state.enabled, false);
  const broken = createUpdateBridge({ enabled: true, version: "1", send: () => { throw Error("EPIPE"); } });
  assert.equal(broken.request("check", trusted), false);
  assert.equal(broken.state.enabled, false);
});
