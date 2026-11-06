import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./test-helpers.js";

test("debug evaluates its diagnostic filter on the input and preserves it for the next filter", async () => {
  const result = await run(["-c", "debug({scripts:(.scripts|length)}) | .name"],
    '{"name":"example","scripts":{"build":"tsc","test":"node --test"}}');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '"example"\n');
  assert.equal(result.stderr, '["DEBUG:",{"scripts":2}]\n');
});

for (const [filter, diagnostic] of [
  ["empty", ""],
  [". + 1, . + 2", '["DEBUG:",43]\n["DEBUG:",44]\n'],
] as const) {
  test(`debug(${filter}) preserves the input exactly once`, async () => {
    const result = await run(["-cn", `42 | debug(${filter})`]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "42\n");
    assert.equal(result.stderr, diagnostic);
  });
}

test("debug diagnostic filter errors propagate before the original input is emitted", async () => {
  const result = await run(["-cn", '42 | debug(1, error("failed"))']);
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.startsWith('["DEBUG:",1]\n'));
  assert.ok(result.stderr.includes("failed"));
});

test("debug diagnostic values share the output byte limit", async () => {
  const result = await run(["-cn", "42 | debug(1, 2)"], "", { limits: { maxOutputBytes: 13 } });
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.startsWith('["DEBUG:",1]\n'));
  assert.ok(result.stderr.includes("maxOutputBytes limit exceeded"));
});

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
