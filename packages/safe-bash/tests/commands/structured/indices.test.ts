import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../../src/index.js";
import { run } from "./helpers.js";
import { Budget, JqLimitError, resolveJqLimits } from "../../../src/commands/structured/limits.js";
import { indices } from "../../../src/commands/structured/indices.js";

const cases: [string, string][] = [
  ['"aaaa"\n', 'indices("aa")'],
  ['"😀aa😀aa"\n', 'indices("aa")'],
  ['"ééé"\n', 'indices("éé")'],
  ['"abc"\n', 'indices(""),indices("z"),indices("abc"),indices("abcd")'],
  ['""\n', 'indices("")'],
  ['[1,1,1]\n', 'indices([1,1]),indices(1),indices([])'],
  ['[1,2,1,2]\n', 'indices([1,2]),indices([2,1]),indices([1,2,3])'],
  ['[{"a":1},{"a":1},null,true,"x"]\n', 'indices([{"a":1}]),indices(null),indices(true),indices("x")'],
  ['[]\n', 'indices(1),indices([])'],
  ['"aaaa"\n', 'indices("aa","a"),indices(empty)'],
  ['null\n', 'indices("a")'],
  ['{}\n', 'indices("a")'],
  ['true\n', 'indices("a")'],
  ['12\n', 'indices("a")'],
  ['"abc"\n', 'indices(1)'],
  ['"abc"\n', 'indices(null)'],
  ['"abc"\n', 'indices(["a"])'],
  ['"abc"\n', 'indices({start:0,end:2})'],
  ['"abc"\n', 'indices({})'],
  ['null\n', 'indices({}),indices([])'],
  ['[1.0,1,2]\n', 'indices([1,1])'],
];

for (const [stdin, filter] of cases) test(`indices native parity: ${stdin.trim()} | ${filter}`, async () => {
  const native = spawnSync("jq", ["-c", filter], { input: stdin, encoding: "utf8" });
  assert.ifError(native.error);
  assert.equal(native.signal, null);
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const actual = await shell.exec(`jq -c '${filter}'`, { stdin });
    assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr },
      { exitCode: native.status, stdout: native.stdout, stderr: native.stderr });
  } finally { await shell.dispose(); }
});

test("indices bounds collection and comparison work", async () => {
  const collection = await run(["-c", 'indices("a")'], '"aaaa"', { limits: { maxCollectionSize: 2 } });
  assert.equal(collection.exitCode, 5);
  assert.match(collection.stderr, /maxCollectionSize limit exceeded/);
  const work = await run(["-c", 'indices("aa")'], JSON.stringify("a".repeat(1000)), { limits: { maxSteps: 100 } });
  assert.equal(work.exitCode, 5);
  assert.match(work.stderr, /maxSteps limit exceeded/);
});

test("indices admits output incrementally and limits matching work", async () => {
  await assert.rejects(indices("a".repeat(100), "a",
    new Budget(resolveJqLimits({ maxValueBytes: 10 }), new AbortController().signal)),
    error => error instanceof JqLimitError && error.message === "maxValueBytes limit exceeded");
  await assert.rejects(indices(Array(1000).fill(1), [1, 1],
    new Budget(resolveJqLimits({ maxSteps: 100 }), new AbortController().signal)),
    error => error instanceof JqLimitError && error.message === "maxSteps limit exceeded");
});

test("indices handles long repeated prefixes within linear work", async () => {
  const input = `${"a".repeat(10000)}b`;
  const sought = `${"a".repeat(1000)}b`;
  const budget = new Budget(resolveJqLimits({ maxSteps: 100000 }), new AbortController().signal);
  assert.deepEqual(await indices(input, sought, budget), [9000]);
});

test("jq supports NaN slice bounds, object slice indices, subarray indices, and string * nan", async () => {
  for (const [expr, expected] of [
    ["[1,2,3] | del(.[] | select(. == 2))", "[1,3]\n"],
    ["[{\"a\":1},{\"a\":2}] | (.[] | select(.a == 2) | .a) = 99", "[{\"a\":1},{\"a\":99}]\n"],
    ["[10,20,30,40] | .[1:3] = [99]", "[10,99,40]\n"],
    ["[10,20,30,40][0.5:2.5]", "[10,20,30]\n"],
    ["[10,20,30][nan:2]", "[10,20]\n"],
    ["[10,20,30,40][{\"start\":1,\"end\":3}]", "[20,30]\n"],
    ["[10,20,30,20,30][[20,30]]", "[1,3]\n"],
    ["\"a\" * nan", "null\n"],
    ["\"\" * nan", "null\n"],
  ] as const) {
    const res = await run(["-nc", expr]);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, expected);
  }
});
