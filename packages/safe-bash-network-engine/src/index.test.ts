import assert from "node:assert/strict";
import test from "node:test";
import { limitsFor } from "./shared.js";
import { parseArguments } from "./args.js";
import { decodeContent } from "./decode.js";
import { collectBytes, toByteSource } from "safe-bash-contracts";
import { createOriginAuthorizer } from "./authorizer.js";

test("origin authorization rejects a virtual-host override outside the URL authority", () => {
  const authorize = createOriginAuthorizer(["https://example.test"]);
  const request = { url: "https://example.test/data", method: "GET", attempt: 0, signal: new AbortController().signal };
  assert.equal(authorize({ ...request, headers: [["Host", "example.test"]] }), true);
  assert.equal(authorize({ ...request, headers: [["Host", "other.test"]] }), false);
});

test("content encoding depth is unlimited unless explicitly configured", async () => {
  const signal = new AbortController().signal;
  const encoding = Array(6).fill("identity").join(",");
  assert.deepEqual(await collectBytes(decodeContent(toByteSource("ok"), encoding, signal, Infinity), { maxBytes: 10 }), new TextEncoder().encode("ok"));
  await assert.rejects(collectBytes(decodeContent(toByteSource("ok"), encoding, signal, Infinity, 4), { maxBytes: 10 }), /Too many content encoding layers/);
});

test("the last user-agent option replaces previous values, including an empty value", () => {
  for (const agent of ["Agent2", ""]) {
    const parsed = parseArguments(["-A", "Agent1", "-A", agent, "https://example.test"], limitsFor());
    assert.equal(parsed.agent, agent);
    assert.deepEqual(parsed.headers, []);
  }
});

test("curl accepts Host, Connection, and empty Expect header overrides", () => {
  const parsed = parseArguments(["-H", "Host: example.test", "-H", "Connection: close", "-H", "Expect:", "https://example.test"], limitsFor());
  assert.deepEqual(parsed.headers, [["Host", "example.test"], ["Connection", "close"], ["Expect", null]]);
});
test("network quotas are optional and explicit invalid limits are rejected", () => {
 assert.equal(limitsFor().maxDownloadBytes, Infinity);
 assert.equal(limitsFor({ maxDownloadBytes: 17 }).maxDownloadBytes, 17);
 assert.throws(() => limitsFor({ maxDownloadBytes: -1 }), RangeError);
});
