import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./test-helpers.js";

for (const value of [null, true, 42, "", "é\n\u0000\"", [1, "two"], { nested: { values: [true, "é", null] } }]) {
  test(`stderr preserves ${JSON.stringify(value)} and writes raw bytes without a newline`, async () => {
    const json = JSON.stringify(value);
    const result = await run(["-cn", `${json} | stderr`]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, `${json}\n`);
    assert.equal(result.stderr, typeof value === "string" ? value : json);
  });
}

test("stderr runs per input inside functions even when output is discarded", async () => {
  const result = await run(["-cn", "def log: stderr; [1,2][] | log | empty"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "12");
});

test("stderr shares the output byte limit with stdout", async () => {
  const result = await run(["-cn", "stderr"], "", { limits: { maxOutputBytes: 4 } });
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.startsWith("null"));
  assert.ok(result.stderr.includes("maxOutputBytes limit exceeded"));
});

test("stderr counts UTF-8 bytes before writing raw strings", async () => {
  for (const maximum of [1, 2]) {
    const result = await run(["-cn", '"é" | stderr | empty'], "", { limits: { maxOutputBytes: maximum } });
    assert.equal(result.exitCode, maximum === 2 ? 0 : 5);
    assert.equal(result.stdout, "");
    if (maximum === 2) assert.equal(result.stderr, "é");
    else assert.ok(result.stderr.includes("maxOutputBytes limit exceeded"));
  }
});
