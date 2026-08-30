import assert from "node:assert/strict";
import test from "node:test";
import { chunks, run } from "./helpers.js";

test("printf integer precision overrides zero padding and suppresses zero digits", async () => {
  const result = await run("printf", ["%08.3d|%.0d|%#.3o|%#x\n", "12", "0", "7", "0"]);
  assert.equal(result.stdout, "     012||007|0\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("printf alternate octal keeps one zero without duplicating precision padding", async () => {
  const result = await run("printf", ["%#.0o|%#.4o|%#06x|%08.3d\n", "0", "7", "15", "-12"]);
  assert.equal(result.stdout, "0|0007|0x000f|    -012\n");
  assert.equal(result.exitCode, 0);
});

test("printf signed hexadecimal integers do not produce false diagnostics", async () => {
  const result = await run("printf", ["%+d|%d\n", "+0xff", "-0xff"]);
  assert.equal(result.stdout, "+255|-255\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("xargs preserves backslashes inside either kind of quote", async () => {
  for (const width of [1, 2, 32]) {
    const result = await run("xargs", ["printf", "<%s>\n"], { stdin: chunks('"a\\b" \'c\\d\' escaped\\ space', width) });
    assert.equal(result.stdout, "<a\\b>\n<c\\d>\n<escaped space>\n");
    assert.equal(result.exitCode, 0);
  }
});

test("xargs quoted backslashes do not escape closing quotes", async () => {
  const result = await run("xargs", ["printf", "<%s>\n"], { stdin: '"a\\"b"\n' });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
});

test("xargs rejects a newline inside a quoted word without dispatching", async () => {
  let calls = 0;
  const result = await run("xargs", ["custom"], { stdin: chunks('"first\nsecond"'), execute() { calls++; return { exitCode: 0 }; } });
  assert.equal(result.exitCode, 2);
  assert.equal(calls, 0);
});

test("test disambiguates short expressions before treating operands as operators", async () => {
  for (const [args, expected] of [
    [["!", "=", "!"], 0], [["(", "=", "("], 0], [["!", "!"], 1],
    [["!", ""], 0], [["!", "(", "=", "("], 1], [["-n", "=", "-n"], 0],
  ] as const) {
    assert.equal((await run("test", args)).exitCode, expected, JSON.stringify(args));
    assert.equal((await run("[", [...args, "]"])).exitCode, expected, JSON.stringify(args));
  }
});
