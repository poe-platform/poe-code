import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/shell.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { compilePattern } from "../../src/shell/pattern.js";
import { scanString, nextCodePointOffset, previousCodePointOffset } from "../../src/shell/string-operations.js";
import { ValueScope } from "../../src/shell/value-state.js";
import { ShellLimitError } from "../../src/shell/types.js";
import { registerYieldCheckpoint } from "../../src/contracts/yield.js";

const operations = [
  { name: "length", expression: "${#VALUE}", expected: "3" },
  { name: "substring", expression: "${VALUE:1:1}", expected: "🙂" },
  { name: "replacement", expression: "${VALUE//x/y}", expected: "é🙂Z" },
  { name: "removal", expression: "${VALUE#?}", expected: "🙂Z" },
] as const;

for (const indexed of [false, true]) for (const operation of operations) {
  const expression = indexed ? operation.expression.replace("VALUE", "items") : operation.expression;
  const setup = indexed ? 'items=("$VALUE"); ' : "";
  test(`${indexed ? "indexed" : "scalar"} ${operation.name} does not materialize source code points`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem(), env: { VALUE: "é🙂Z", LC_ALL: "en_US.UTF-8" } });
    let armed = false;
    let observed: readonly string[] | undefined;
    shell.register({ name: "arm", execute() { armed = true; return { exitCode: 0 }; } });
    shell.register({ name: "observe", execute(command) { observed = command.args; return { exitCode: 0 }; } });
    const original = Array.from;
    context.mock.method(Array, "from", function(input: Iterable<unknown>, ...rest: unknown[]) {
      if (armed && typeof input === "string") assert.notEqual(input, "é🙂Z", "whole source code-point allocation");
      return Reflect.apply(original, Array, [input, ...rest]);
    });
    try {
      const result = await shell.exec(`${setup}arm; observe "${expression}"`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(observed, [operation.expected]);
    } finally { await shell.dispose(); }
  });

  test(`${indexed ? "indexed" : "scalar"} ${operation.name} observes cancellation during a tiny scan`, async context => {
    const controller = new AbortController();
    const reason = new Error("stop string scan");
    const shell = new Shell({ fs: new MemoryFileSystem(), env: { VALUE: "é🙂Z", LC_ALL: "en_US.UTF-8" } });
    let armed = false;
    let visits = 0;
    let calls = 0;
    shell.register({ name: "arm", execute() { armed = true; return { exitCode: 0 }; } });
    shell.register({ name: "observe", execute() { calls++; return { exitCode: 0 }; } });
    const original = String.prototype.codePointAt;
    context.mock.method(String.prototype, "codePointAt", function(this: string, offset: number) {
      const value = original.call(this, offset);
      if (armed && String(this) === "é🙂Z" && ++visits === 2) controller.abort(reason);
      return value;
    });
    try {
      await assert.rejects(shell.exec(`${setup}arm; observe "${expression}"`, { signal: controller.signal }), error => error === reason);
      assert.equal(calls, 0);
      assert.equal(visits, 2);
    } finally { await shell.dispose(); }
  });
}

test("compiled matching consumes a UTF-16 source range, not the surrounding text", async () => {
  const work = { remaining: 100, signal: new AbortController().signal, exhausted(): never { throw new Error("work exhausted"); } };
  const matches = await compilePattern("?Z", work);
  assert.equal(await matches("é🙂Z!", 1, 4), true);
  assert.equal(await matches("é🙂Z!", 1, 3), false);
});

test("compiled matching does not create a candidate code-point array", async context => {
  const work = { remaining: 100, signal: new AbortController().signal, exhausted(): never { throw new Error("work exhausted"); } };
  const matches = await compilePattern("*Z", work);
  const original = Array.from;
  context.mock.method(Array, "from", function(input: Iterable<unknown>, ...rest: unknown[]) {
    assert.notEqual(input, "é🙂Z");
    return Reflect.apply(original, Array, [input, ...rest]);
  });
  assert.equal(await matches("é🙂Z"), true);
});

for (const indexed of [false, true]) for (const expression of ["${VALUE:1:1}", "${VALUE//x/y}", "${VALUE#?}"]) {
  test(`${indexed ? "indexed" : "scalar"} scratch admission precedes ${expression} materialization`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem(), env: { VALUE: "é🙂Z", LC_ALL: "en_US.UTF-8" } });
    const reason = new ShellLimitError("maxExpansionBytes");
    let armed = false;
    let admissions = 0;
    let calls = 0;
    let slices = 0;
    shell.register({ name: "arm", execute() { armed = true; return { exitCode: 0 }; } });
    shell.register({ name: "observe", execute() { calls++; return { exitCode: 0 }; } });
    const reserve = ValueScope.prototype.reserve;
    context.mock.method(ValueScope.prototype, "reserve", function(this: ValueScope, bytes: number, slots: number) {
      if (armed) { admissions++; throw reason; }
      return reserve.call(this, bytes, slots);
    });
    const slice = String.prototype.slice;
    context.mock.method(String.prototype, "slice", function(this: string, start: number, end?: number) {
      if (armed && String(this) === "é🙂Z") slices++;
      return slice.call(this, start, end);
    });
    try {
      const source = indexed ? `items=("$VALUE"); arm; observe "${expression.replace("VALUE", "items")}"` : `arm; observe "${expression}"`;
      await assert.rejects(shell.exec(source), error => error === reason);
      assert.equal(admissions, 1);
      assert.equal(slices, 0);
      assert.equal(calls, 0);
    } finally { await shell.dispose(); }
  });
}

test("replacement tilde expansion is admitted before constructing its suffix", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { VALUE: "a", HOME: "/home" } });
  let admitted = false;
  let observed: readonly string[] | undefined;
  shell.register({ name: "observe", execute(command) { observed = command.args; return { exitCode: 0 }; } });
  const reserve = ValueScope.prototype.reserve;
  context.mock.method(ValueScope.prototype, "reserve", function(this: ValueScope, bytes: number, slots: number) {
    if (bytes === 12) admitted = true;
    return reserve.call(this, bytes, slots);
  });
  const slice = String.prototype.slice;
  context.mock.method(String.prototype, "slice", function(this: string, start: number, end?: number) {
    if (String(this) === "~/" && start === 1) assert.equal(admitted, true, "tilde allocation preceded admission");
    return slice.call(this, start, end);
  });
  try {
    const result = await shell.exec('observe "${VALUE//a/~/}"');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(observed, ["/home/"]);
  } finally { await shell.dispose(); }
});

test("pattern compilation admits scratch before tokenization", async context => {
  const reason = new Error("no pattern scratch");
  let materialized = false;
  const original = Array.from;
  context.mock.method(Array, "from", function(input: Iterable<unknown>, ...rest: unknown[]) {
    if (input === "?Z") materialized = true;
    return Reflect.apply(original, Array, [input, ...rest]);
  });
  await assert.rejects(compilePattern("?Z", {
    remaining: 100,
    signal: new AbortController().signal,
    exhausted(): never { throw new Error("work exhausted"); },
    allocation: { assertOpen() {}, reserve(): never { throw reason; } },
  }), error => error === reason);
  assert.equal(materialized, false);
});

test("tiny scans debit work before visiting the next code point", async context => {
  const reason = new Error("work exhausted");
  const work = { remaining: 1, signal: new AbortController().signal, exhausted(): never { throw reason; } };
  let visits = 0;
  const original = String.prototype.codePointAt;
  context.mock.method(String.prototype, "codePointAt", function(this: string, offset: number) {
    if (String(this) === "abc") visits++;
    return original.call(this, offset);
  });
  await assert.rejects(scanString("abc", work), error => error === reason);
  assert.equal(visits, 1);
});

test("tiny scans yield at the work boundary and preserve cancellation identity", async () => {
  const controller = new AbortController();
  const reason = new Error("checkpoint cancelled");
  const work = { remaining: 100, steps: 127, signal: controller.signal, exhausted(): never { throw new Error("work exhausted"); } };
  registerYieldCheckpoint(controller.signal, () => controller.abort(reason));
  await assert.rejects(scanString("abc", work), error => error === reason);
});

test("Unicode scans preserve combining marks and isolated surrogates", async () => {
  const work = { remaining: 100, signal: new AbortController().signal, exhausted(): never { throw new Error("work exhausted"); } };
  const value = "é🙂e\u0301\ud800Z\udc00";
  assert.deepEqual(await scanString(value, work), { end: 8, count: 7, bytes: Buffer.byteLength(value) });
  assert.deepEqual(await scanString(value, work, 1, value.length, 1), { end: 3, count: 1, bytes: 4 });
  assert.equal(nextCodePointOffset(value, 1), 3);
  assert.equal(previousCodePointOffset(value, 3), 1);
  assert.equal(previousCodePointOffset(value, 6), 5);
});

test("no-match replacement never slices the source into candidate or output copies", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { VALUE: "aaaaaa" } });
  let observed: readonly string[] | undefined;
  shell.register({ name: "observe", execute(command) { observed = command.args; return { exitCode: 0 }; } });
  const original = String.prototype.slice;
  context.mock.method(String.prototype, "slice", function(this: string, start: number, end?: number) {
    assert.notEqual(String(this), "aaaaaa", "unnecessary source slice");
    return original.call(this, start, end);
  });
  try {
    const result = await shell.exec('observe "${VALUE//b/x}"');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(observed, ["aaaaaa"]);
  } finally { await shell.dispose(); }
});

for (const fixture of [
  { value: "🙂a🙂", expression: "${VALUE//?a/X}", expected: "X🙂" },
  { value: "🙂a🙂", expression: "${VALUE//*a*/X}", expected: "X" },
  { value: "🙂a🙂", expression: "${VALUE/#/X}", expected: "X🙂a🙂" },
  { value: "🙂a🙂", expression: "${VALUE/%/X}", expected: "🙂a🙂X" },
  { value: "🙂a🙂", expression: "${VALUE///X}", expected: "🙂a🙂" },
  { value: "", expression: "${VALUE//*/X}", expected: "X" },
  { value: "🙂a🙂", expression: "${VALUE//🙂/&X}", expected: "🙂Xa🙂X" },
]) test(`Unicode replacement compatibility: ${fixture.expression}`, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { VALUE: fixture.value } });
  let observed: readonly string[] | undefined;
  shell.register({ name: "observe", execute(command) { observed = command.args; return { exitCode: 0 }; } });
  try {
    const result = await shell.exec(`observe "${fixture.expression}"`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(observed, [fixture.expected]);
  } finally { await shell.dispose(); }
});

test("selected array element length counts code points without source materialization", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { VALUE: "é🙂Z" } });
  let observed: readonly string[] | undefined;
  let armed = false;
  shell.register({ name: "arm", execute() { armed = true; return { exitCode: 0 }; } });
  shell.register({ name: "observe", execute(command) { observed = command.args; return { exitCode: 0 }; } });
  const original = Array.from;
  context.mock.method(Array, "from", function(input: Iterable<unknown>, ...rest: unknown[]) {
    if (armed) assert.notEqual(input, "é🙂Z");
    return Reflect.apply(original, Array, [input, ...rest]);
  });
  try {
    const result = await shell.exec('items=("$VALUE"); arm; observe "${#items[0]}" "${#items[@]}"');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(observed, ["3", "1"]);
  } finally { await shell.dispose(); }
});
