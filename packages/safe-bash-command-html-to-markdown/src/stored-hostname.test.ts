import assert from "node:assert/strict";
import test from "node:test";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { convert } from "./fixtures.js";
import { normalizeStoredHostname } from "./stored-destination.js";
import { TextStore } from "./stored-text.js";

test("stored host serialization matches native domain, IP and IDNA normalization", async () => {
  const context = (await convert("")).context, storage = new PagedStorage(context, 2), text = new TextStore(storage);
  const budget = { work() {}, checkpoint() {} };
  const hosts = ["Example.COM", "é.example", "0x7f.1", "127.000.1", "4294967295", "4294967296", "1.2.3.4.", "1.2.3.a", "a..b", "", "[2001:0db8::1]", "[::ffff:192.168.1.1]", "[invalid]", "%45XAMPLE.com", "%EF%BB%BFexample.test", "a%25b", "a%gg", "xn--bcher-kva", "xn--", "１２７.０.０.１", "localhost", "x".repeat(8192) + ".test", "é".repeat(512) + ".test", "0".repeat(8192) + "177.1"];
  try {
    for (const host of hosts) {
      let expected: string | undefined;
      try { expected = new URL(`http://${host}/`).hostname; } catch { /* Invalid hosts are rejected. */ }
      const normalized = await normalizeStoredHostname(text, await text.from(host), budget);
      let actual: string | undefined;
      if (normalized !== undefined) { actual = ""; for await (const chunk of text.chunks(normalized)) actual += chunk; }
      assert.equal(actual, expected, host.slice(0, 80));
    }
  } finally { await storage.close(); }
});
