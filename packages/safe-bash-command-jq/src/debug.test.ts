import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./test-helpers.js";

for (const value of ["null", "42", '{"nested":{"values":[true,"é",null]}}']) {
  test(`debug preserves ${value} and writes a separate compact diagnostic`, async () => {
    const result = await run(["-cn", `${value} | debug`]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, `${value}\n`);
    assert.equal(result.stderr, `["DEBUG:",${value}]\n`);
  });
}

test("debug runs once per input inside user functions even when output is discarded", async () => {
  const result = await run(["-cn", "def log: debug; [1,2][] | log | empty"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, '["DEBUG:",1]\n["DEBUG:",2]\n');
});

test("debug shares the output byte limit with stdout", async () => {
  const result = await run(["-cn", "debug"], "", { limits: { maxOutputBytes: 16 } });
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.startsWith('["DEBUG:",null]\n'));
  assert.ok(result.stderr.includes("maxOutputBytes limit exceeded"));
});
