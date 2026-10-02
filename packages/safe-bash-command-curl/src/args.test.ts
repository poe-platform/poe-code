import assert from "node:assert/strict";
import test from "node:test";
import { limitsFor } from "safe-bash-network-engine/shared";
import { parseArguments } from "./args.js";

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
