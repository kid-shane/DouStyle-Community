import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { isDoubaoChatURL, doubaoPageGuard } from "../../doubao-target.mjs";

test("legacy and renamed Work pages are injectable, unrelated pages are rejected", () => {
  const accepted = [
    "doubao://doubao-chat/chat/test", "chrome://doubao-chat/chat",
    "chrome://doubaowork-chat/chat/test", "doubaowork://doubaowork-chat/chat",
    "chrome://doubaowork-chat", "chrome://doubaowork-chat/?x=1",
  ];
  const rejected = [
    "https://doubaowork-chat/chat", "https://example.com/doubao://doubao-chat/chat",
    "chrome://doubaowork-chat.evil/chat", "chrome://doubaowork-chat@evil/chat",
    "chrome://settings/", "doubao://doubao-chat-other/chat", "about:blank",
  ];
  for (const [values, expected] of [[accepted, true], [rejected, false]]) {
    for (const href of values) {
      assert.equal(isDoubaoChatURL(href), expected, href);
      assert.equal(runInNewContext(`(() => { ${doubaoPageGuard} return true; })()`, { location: { href } }), expected, href);
    }
  }
  for (const invalid of [null, undefined, {}, 42]) assert.equal(isDoubaoChatURL(invalid), false);
});
