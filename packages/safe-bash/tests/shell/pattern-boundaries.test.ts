import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/shell.js";
import { Runtime } from "../../src/shell/runtime.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { compilePattern, compilePatternBoundaries } from "../../src/shell/pattern.js";
import { nextCodePointOffset, type StringWork } from "../../src/shell/string-operations.js";
import { ValueArena } from "../../src/shell/value-state.js";
import { registerYieldCheckpoint } from "../../src/contracts/yield.js";

for (const operator of ["#*1", "##*1", "%*1", "%%*1", "/#*1/X", "/%*1/X", "/*1/X", "//*1/X", "%1*"]) {
  test(`parameter boundary work stays linear for fixed pattern: ${operator}`, async context => {
    let subject = "";
    let active = false;
    let visits = 0;
    const search = Runtime.prototype.parameterPattern;
    context.mock.method(Runtime.prototype, "parameterPattern", async function(this: Runtime, ...args: Parameters<typeof search>) {
      active = true;
      try { return await search.apply(this, args); }
      finally { active = false; }
    });
    const codePoint = String.prototype.codePointAt;
    context.mock.method(String.prototype, "codePointAt", function(this: string, offset: number) {
      if (active && String(this) === subject) visits++;
      return codePoint.call(this, offset);
    });
    const counters: number[] = [];
    for (const length of [8, 16, 32]) {
      subject = "0".repeat(length);
      visits = 0;
      const shell = new Shell({ fs: new MemoryFileSystem(), env: { VALUE: subject } });
      let observed: readonly string[] | undefined;
      shell.register({ name: "observe", execute(command) { observed = command.args; return { exitCode: 0 }; } });
      try {
        const result = await shell.exec(`observe "\${VALUE${operator}}"`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.deepEqual(observed, [subject]);
        counters.push(visits);
      } finally { await shell.dispose(); }
    }
    context.diagnostic(`${operator}: input code-point reads for 8/16/32 = ${counters.join("/")}`);
    assert.ok(counters[2]! <= 8 * 32 + 32, `fixed two-token pattern rescans input: ${counters.join("/")}`);
  });
}

for (const [value, operation, expected] of [
  ["ababa", "#*b", "aba"], ["ababa", "##*b", "a"],
  ["ababa", "%b*", "aba"], ["ababa", "%%b*", "a"],
  ["ababa", "/b*/X", "aX"], ["ababa", "//a/X", "XbXbX"],
  ["ababa", "/#b/X", "ababa"], ["ababa", "/%b/X", "ababa"],
  ["ababa", "/#a/X", "Xbaba"], ["ababa", "/%a/X", "ababX"],
  ["ababa", "//a/&X", "aXbaXbaX"], ["a1b2", "//[[:digit:]]/X", "aXbX"],
  ["🙂a🙂", "#?", "a🙂"], ["🙂a🙂", "%?", "🙂a"],
  ["🙂a🙂", "//?a/X", "X🙂"], ["🙂a🙂", "//*a*/X", "X"],
  ["🙂a🙂", "/#/X", "X🙂a🙂"], ["🙂a🙂", "/%/X", "🙂a🙂X"],
  ["🙂a🙂", "///X", "🙂a🙂"], ["", "//*/X", "X"],
] as const) test(`boundary semantics control: ${JSON.stringify(value)} ${operation}`, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { VALUE: value, LC_ALL: "C.UTF-8" } });
  let observed: readonly string[] | undefined;
  shell.register({ name: "observe", execute(command) { observed = command.args; return { exitCode: 0 }; } });
  try {
    const result = await shell.exec(`observe "\${VALUE${operation}}"`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(observed, [expected]);
  } finally { await shell.dispose(); }
});

function makeWork(signal = new AbortController().signal): StringWork {
  return { remaining: 100000, signal, exhausted(): never { throw new Error("boundary work exhausted"); } };
}

test("boundary table agrees with bounded candidate matching for both preferences and anchoring", async () => {
  for (const pattern of ["", "*", "?", "a", "a*", "*a", "?*a", "*a*", "\\*", "[!a]", "[[:digit:]]", "[a]"]) {
    for (const value of ["", "a", "b", "aa", "aba", "🙂a🙂", "*", "\ud800a", "\udc00"]) {
      const reference = await compilePattern(pattern, makeWork());
      const search = await compilePatternBoundaries(pattern, makeWork());
      const offsets = [0];
      while (offsets.at(-1)! < value.length) offsets.push(nextCodePointOffset(value, offsets.at(-1)!));
      for (const shortest of [false, true]) for (const suffix of [false, true]) {
        const ends = await search(value, shortest, suffix);
        for (const start of offsets) {
          const matches: number[] = [];
          for (const end of offsets) {
            if (end < start || suffix && end !== value.length) continue;
            if (await reference(value, start, end)) matches.push(end);
          }
          const expected = (shortest ? matches[0] : matches.at(-1)) ?? -1;
          assert.equal(ends[start], expected, JSON.stringify({ pattern, value, start, shortest, suffix }));
        }
        for (let offset = 0; offset < value.length; offset++) if (!offsets.includes(offset)) assert.equal(ends[offset], -1);
      }
    }
  }
});

test("boundary numeric storage is jointly admitted before materialization and released by scope", async () => {
  const nativeArray = Float64Array;
  let arrays = 0;
  globalThis.Float64Array = new Proxy(nativeArray, { construct(target, args) { arrays++; return Reflect.construct(target, args); } });
  try {
    for (const maximum of [511, 512]) {
      const arena = new ValueArena(maximum, 8, () => {});
      const scope = arena.scope();
      const work = { ...makeWork(), allocation: scope };
      try {
        const search = await compilePatternBoundaries("*1", work);
        assert.equal(arena.usage.bytes, 320);
        arrays = 0;
        if (maximum === 511) {
          await assert.rejects(search("0000"), error => error instanceof Error && "limit" in error && error.limit === "maxExpansionBytes");
          assert.equal(arrays, 0);
          assert.equal(arena.usage.bytes, 320);
        } else {
          assert.deepEqual(Array.from(await search("0000")), [-1, -1, -1, -1, -1]);
          assert.equal(arrays, 2);
          assert.equal(arena.usage.bytes, 424);
        }
      } finally { scope.close(); }
      assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
      arena.close();
    }
  } finally { globalThis.Float64Array = nativeArray; }
});

test("boundary work charges initialization and each transition at the exact lowered limit", async () => {
  const work = makeWork();
  const search = await compilePatternBoundaries("*1", work);
  const exact = 3 + 5 + 5 * 3;
  work.remaining = exact;
  work.steps = 0;
  assert.deepEqual(Array.from(await search("0000")), [-1, -1, -1, -1, -1]);
  assert.equal(work.remaining, 0);
  work.remaining = exact - 1;
  work.steps = 0;
  await assert.rejects(search("0000"), { message: "boundary work exhausted" });
});

for (const reason of [false, Object.freeze({ cancelled: "boundary table" })]) test(`boundary cancellation cleans both numeric buffers: ${JSON.stringify(reason)}`, async () => {
  const controller = new AbortController();
  const arena = new ValueArena(512, 8, () => controller.signal.throwIfAborted());
  const scope = arena.scope();
  const work: StringWork = { ...makeWork(controller.signal), allocation: scope };
  try {
    const search = await compilePatternBoundaries("*1", work);
    work.steps = 119;
    registerYieldCheckpoint(controller.signal, () => {
      assert.equal(arena.usage.bytes, 512);
      controller.abort(reason);
    });
    await assert.rejects(search("0000"), error => error === reason);
    assert.equal(arena.usage.bytes, 320);
  } finally { scope.close(); }
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
  arena.close();
});

test("global replacement computes one endpoint table for multiple matches", async () => {
  const nativeArray = Float64Array;
  let tables = 0;
  globalThis.Float64Array = new Proxy(nativeArray, { construct(target, args) {
    if (args[0] === 6) tables++;
    return Reflect.construct(target, args);
  } });
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { VALUE: "ababa" } });
  let observed: readonly string[] | undefined;
  shell.register({ name: "observe", execute(command) { observed = command.args; return { exitCode: 0 }; } });
  try {
    const result = await shell.exec('observe "${VALUE//a/X}"');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(observed, ["XbXbX"]);
    assert.equal(tables, 1);
  } finally { await shell.dispose(); globalThis.Float64Array = nativeArray; }
});
