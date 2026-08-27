import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../../../src/commands/tree/arguments.js";
import { WalkBudget } from "../../../src/commands/tree/io.js";
import { settings } from "../../../src/commands/tree/options.js";
import { matches } from "../../../src/commands/tree/pattern.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { shellRun } from "./helpers.js";

class CountedBudget extends WalkBudget {
  requested = 0;
  override step(count = 1): void { this.requested += count; super.step(count); }
}

function budget(maxSteps = 100000): CountedBudget {
  return new CountedBudget({ command: "tree", args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(),
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write() {} }, stderr: { async write() {} } }, settings({ limits: { maxSteps } }));
}

function measureRows(operation: () => void): { rows: number; bytes: number } {
  const original = globalThis.Uint8Array;
  const measured = { rows: 0, bytes: 0 };
  globalThis.Uint8Array = new Proxy(original, { construct(target, args) {
    const result = Reflect.construct(target, args);
    if (typeof args[0] === "number") { measured.rows++; measured.bytes += args[0]; }
    return result;
  } });
  try { operation(); return measured; }
  finally { globalThis.Uint8Array = original; }
}

const emptyAlternatives = "|".repeat(15);
const names = Array.from({ length: 32 }, (_unused, index) => String(index).padStart(32, "x"));

test("TREE-WORK-001: empty alternatives charge cumulatively without per-name DP rows", context => {
  const compilation = budget();
  const pattern = parse(["-P", emptyAlternatives], compilation).include[0]!;
  const matching = budget();
  const encodedNames = names.map(name => new TextEncoder().encode(name));
  const allocated = measureRows(() => {
    for (const name of encodedNames) assert.equal(matches(pattern, name, matching), false);
  });
  context.diagnostic(JSON.stringify({ entries: names.length, alternatives: pattern.length, nameBytes: 32,
    compilationSteps: compilation.requested, matchingSteps: matching.requested,
    measuredRowAllocations: allocated.rows, measuredRowBytes: allocated.bytes,
    originalInitializationFormulaBytes: 32 * 16 * 33 }));
  assert.equal(matching.requested, 32 * 16);
  assert.deepEqual(allocated, { rows: 0, bytes: 0 });
});

test("TREE-WORK-001: actual Shell many-entry matching exhausts one invocation budget", async () => {
  const fs = createMemoryFileSystem();
  for (const name of names) await fs.writeFile(`/${name}`, new Uint8Array());
  const result = await shellRun(fs, ["-P", emptyAlternatives, "--noreport"], { limits: { maxSteps: 256 } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /tree work limit exceeded \(256\)/u);
});

test("one name fits but many names share cumulative work for both include and exclude", async () => {
  const single = createMemoryFileSystem(), many = createMemoryFileSystem();
  await single.writeFile(`/${names[0]!}`, new Uint8Array());
  for (const name of names) await many.writeFile(`/${name}`, new Uint8Array());
  for (const flag of ["-P", "-I"]) {
    assert.equal((await shellRun(single, [flag, emptyAlternatives, "--noreport"], { limits: { maxSteps: 256 } })).exitCode, 0);
    const result = await shellRun(many, [flag, emptyAlternatives, "--noreport"], { limits: { maxSteps: 256 } });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /tree work limit exceeded \(256\)/u);
  }
});

test("empty alternatives preserve empty-name, union, wildcard and literal matching semantics", () => {
  for (const [source, name, expected] of [
    ["", "", true], ["", "a", false], ["||", "", true], ["||", "a", false],
    ["|a||b|", "", true], ["|a||b|", "a", true], ["|a||b|", "b", true], ["|a||b|", "c", false],
    ["a|", "", true], ["a|", "ab", false], ["|*", "ab", true], ["*|", "", true],
    ["?||", "é", false], ["?||", "a", true], ["\\||", "|", true], ["\\||", "a", false],
    ["[a-c]|", "b", true], ["[^a]|", "a", false], ["[|]|", "|", true],
  ] as const) {
    const shared = budget();
    const pattern = parse(["-P", source], shared).include[0]!;
    assert.equal(matches(pattern, new TextEncoder().encode(name), shared), expected, JSON.stringify({ source, name }));
  }
});

test("initial and transition rows charge before allocation, with separate transition work", context => {
  const pattern = parse(["-P", "a"], budget()).include[0]!;
  const name = new TextEncoder().encode(names[0]!);
  const full = budget();
  const allocated = measureRows(() => assert.equal(matches(pattern, name, full), false));
  assert.equal(full.requested, 1 + 33 + 2 * 33);
  assert.deepEqual(allocated, { rows: 2, bytes: 66 });
  for (const [maximum, expectedRows, expectedBytes, requested] of [[1, 0, 0, 34], [99, 1, 33, 100]] as const) {
    const limited = budget(maximum);
    const admitted = measureRows(() => assert.throws(() => matches(pattern, name, limited), /work limit exceeded/u));
    assert.equal(limited.requested, requested);
    assert.deepEqual(admitted, { rows: expectedRows, bytes: expectedBytes });
  }
  context.diagnostic(JSON.stringify({ nameBytes: name.length, admittedSteps: full.requested,
    measuredRowAllocations: allocated.rows, measuredRowBytes: allocated.bytes }));
});

test("compilation source/encoding/parser work and repeated flags use the same budget", () => {
  const compiled = budget();
  parse(["-P", emptyAlternatives], compiled);
  assert.equal(compiled.requested, 16 + 16 + 15);
  assert.throws(() => parse(["-P", emptyAlternatives], budget(15)), /work limit exceeded/u);
  assert.throws(() => parse(["-P", emptyAlternatives, "-I", emptyAlternatives], budget(60)), /work limit exceeded/u);
  const ranged = budget();
  parse(["-P", "[a-z0-9]"], ranged);
  assert.equal(ranged.requested, 9 + 9 + 1 + 2);
  assert.throws(() => parse(["-P", "[a-z0-9]"], budget(20)), /work limit exceeded/u);
});

test("no per-name reset after an empty-alternative match attempt", () => {
  const pattern = parse(["-P", emptyAlternatives], budget()).include[0]!;
  const shared = budget(20);
  const name = new TextEncoder().encode("a");
  assert.equal(matches(pattern, name, shared), false);
  assert.equal(shared.requested, 16);
  assert.throws(() => matches(pattern, name, shared), /work limit exceeded/u);
  assert.equal(shared.requested, 21);
});
