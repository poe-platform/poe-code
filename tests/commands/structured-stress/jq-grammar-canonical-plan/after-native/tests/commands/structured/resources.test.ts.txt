import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Budget, resolveJqLimits } from "../../../src/commands/structured/limits.js";
import { type JqLimits } from "../../../src/commands/structured/index.js";
import { runWithBytes, chunks, run } from "./helpers.js";
import { assertNative } from "../structured-stress/jq-grammar-native-v3.js";

test("compact JSON byte accounting is exact at container boundaries", async () => {
  for (const input of ["[0]", '{"a":0}', '"😀"', '["😀"]', "[]", "{}", '{"é":[0]}']) {
    const bytes = Buffer.byteLength(input);
    const result = await run(["-c", "."], chunks(input), { limits: { maxValueBytes: bytes } });
    assert.equal(result.stdout, `${input}\n`, result.stderr);
    assert.equal(result.exitCode, 0, input);
    assert.equal((await run(["-c", "."], input, { limits: { maxValueBytes: bytes - 1 } })).exitCode, 5);
    const budget = new Budget(resolveJqLimits({ maxValueBytes: bytes }), new AbortController().signal);
    assert.equal(budget.value(JSON.parse(input)), bytes);
  }
});

test("native JSON grammar, large decimals and division diagnostics", async () => {
  for (const input of ["NaN", "Infinity", "-Infinity", '"\\uD800"', '"\\uDC00"', '[}', '{"a":}', "01", "1.", "1e", "truefalse", '"bad\nstring"', "[1,]", '{"a":0,}', "\uFEFF0"]) {
    const result = await runWithBytes(["-c", "."], input);
    assertNative(result, ["-c", "."], input);
  }
  for (const bytes of [[255], [0xc3], [0xc3, 0x28], [0xed, 0xa0, 0x80]]) {
    const result = await runWithBytes(["-c", "."], Uint8Array.from(bytes));
    assertNative(result, ["-c", "."], Uint8Array.from(bytes));
  }
  for (const filter of ["1/0", "0/0", "1%0"]) {
    const result = await runWithBytes(["-nc", filter]);
    assertNative(result, ["-nc", filter], "null");
  }
  for (const input of ['1e9999', '[1e9999]', '{"a":1e9999}']) {
    const result = await runWithBytes(["-c", "."], input);
    assertNative(result, ["-c", "."], input);
  }
  for (const [filter, expected] of [["1e308*1e308", "1.7976931348623157e+308"], ['"1e9999"|tonumber', '1E+9999'], ['"[1e9999]"|fromjson', '[1E+9999]']]) {
    const result = await runWithBytes(["-nc", filter!]);
    assertNative(result, ["-nc", filter!], "null");
    assert.equal(result.stdout, `${expected}\n`);
  }
  const surrogate = await runWithBytes(["-c", "."], '"\\uD83D\\uDE00"');
  assertNative(surrogate, ["-c", "."], '"\\uD83D\\uDE00"');
});

test("depth limits cover inputs, constructed outputs, and source AST", async () => {
  for (const depth of [7, 8, 9]) {
    const source = "[".repeat(depth) + "0" + "]".repeat(depth);
    const result = await run(["-c", "."], source, { limits: { maxDepth: 8 } });
    assert.equal(result.exitCode, depth <= 8 ? 0 : 5, result.stderr);
  }
  const source = "[".repeat(9) + "0" + "]".repeat(9);
  assert.match((await run(["-nc", source], "", { limits: { maxDepth: 8 } })).stderr, /maxDepth/);
  for (const filter of ["(".repeat(1000) + "0" + ")".repeat(1000), Array(1000).fill(".").join("|"), "." + ".a".repeat(1000)]) {
    const result = await run(["-nc", filter]); assert.match(result.stderr, /maxAstDepth|expected property/); assert.doesNotMatch(result.stderr, /RangeError|call stack/);
  }
});

test("limits protect hidden Cartesian expansion, collections, and emitted results", async () => {
  const product = Array(12).fill("(0,1)").join("|");
  assert.equal((await run(["-nc", `[${product}]|length`])).stdout, "4096\n");
  const probes: [string, Partial<JqLimits>, string][] = [
    [`${product}|select(false)`, { maxSteps: 100 }, "maxSteps"],
    [`[${product}]`, { maxCollectionSize: 32 }, "maxCollectionSize"],
    [product, { maxResults: 8 }, "maxResults"],
    [".[1000]=0", { maxCollectionSize: 32 }, "maxCollectionSize"],
    ['("x"*1000000)?', { maxValueBytes: 64 }, "maxValueBytes"],
    ['[range(1000)|"x"*32]', { maxValueBytes: 128 }, "maxValueBytes"],
    ['[range(100)]|map("x"*32)', { maxValueBytes: 512 }, "maxValueBytes"],
    ['[range(100)]|sort_by("x"*32)', { maxValueBytes: 512 }, "maxValueBytes"],
  ];
  for (const [filter, limits, error] of probes) {
    const result = await run(["-nc", filter], "", { limits });
    assert.equal(result.exitCode, 5, filter); assert.match(result.stderr, new RegExp(error));
  }
});

test("input, source, output, slurp and result budgets enforce boundary values", async () => {
  assert.equal((await run(["."], "0 ", { limits: { maxInputBytes: 2 } })).stdout, "0\n");
  assert.match((await run(["."], "0  ", { limits: { maxInputBytes: 2 } })).stderr, /maxInputBytes/);
  assert.equal((await run(["-nc", "1+1"], "", { limits: { maxSourceBytes: 3 } })).stdout, "2\n");
  assert.match((await run(["-nc", "1+1"], "", { limits: { maxSourceBytes: 2 } })).stderr, /maxSourceBytes/);
  assert.equal((await run(["-nc", "0"], "", { limits: { maxOutputBytes: 2 } })).stdout, "0\n");
  assert.match((await run(["-nc", "0"], "", { limits: { maxOutputBytes: 1 } })).stderr, /maxOutputBytes/);
  const limited = await run(["-nc", "0,1"], "", { limits: { maxOutputBytes: 2 } });
  assert.equal(limited.stdout, "0\n"); assert.match(limited.stderr, /maxOutputBytes/);
  assert.equal((await run(["-sc", "."], "0 1", { limits: { maxValueBytes: 5 } })).stdout, "[0,1]\n");
  assert.match((await run(["-sc", "."], "0 1", { limits: { maxValueBytes: 4 } })).stderr, /maxValueBytes/);
  assert.match((await run(["-nc", "0,1"], "", { limits: { maxResults: 1 } })).stderr, /maxResults/);
});

test("hazardous expansion cases have a one-second killable outer deadline", () => {
  for (const scenario of ["source", "json", "expansion", "allocation", "cancel"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", new URL("./hazard-worker.ts", import.meta.url).pathname, scenario], { encoding: "utf8", timeout: 1000, maxBuffer: 4096 });
    assert.ifError(result.error); assert.equal(result.status, 0, `${scenario}: ${result.stderr}`); assert.equal(result.stdout.trim(), "ok");
  }
});
