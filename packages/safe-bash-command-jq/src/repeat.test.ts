import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { run } from "./test-helpers.js";

for (const [filter, input, output] of [
  ["limit(3; repeat(1))", "null", "1\n1\n1\n"],
  ["limit(3; repeat(. + 1))", "4\n9", "5\n5\n5\n10\n10\n10\n"],
  ["limit(5; repeat(.[], 9))", "[1,2]", "1\n2\n9\n1\n2\n"],
  ['first(repeat(1, error("unused")))', "null", "1\n"],
  ['limit(0; repeat(error("unused")))', "null", ""],
  ['try repeat(error("bad")) catch .', "null", '"bad"\n'],
  ["limit(3; repeat(inputs))", "0\n1\n2\n3", "1\n2\n3\n"],
] as const) {
  test(`repeat public command: ${filter}`, async () => {
    const result = await run(["-c", filter], input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, output);
    const native = spawnSync("/usr/bin/jq", ["-c", filter], { input, encoding: "utf8", timeout: 1000 });
    assert.ifError(native.error);
    assert.equal(native.status, result.exitCode);
    assert.equal(native.stdout, result.stdout);
    assert.equal(native.stderr, result.stderr);
  });
}

for (const [filter, limits, diagnostic] of [
  ["try repeat(empty) catch 99", { maxSteps: 100 }, "maxSteps"],
  ["try repeat(1) catch 99", { maxResults: 3 }, "maxResults"],
  ["try repeat(1) catch 99", { maxOutputBytes: 4 }, "maxOutputBytes"],
  ["[repeat(1)]?", { maxCollectionSize: 10 }, "maxCollectionSize"],
] as const) {
  test(`repeat preserves ${diagnostic}`, async () => {
    const result = await run(["-cn", filter], "", { limits });
    assert.equal(result.exitCode, 5, result.stderr);
    assert.ok(result.stderr.includes(`${diagnostic} limit exceeded`), result.stderr);
    assert.ok(!result.stdout.includes("99"));
  });
}

test("repeat streams without retaining previous iterations", async () => {
  const result = await run(["-cn", "limit(100; repeat(1))"], "", { limits: { maxCollectionSize: 10 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "1\n".repeat(100));
});
