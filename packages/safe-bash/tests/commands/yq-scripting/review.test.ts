import assert from "node:assert/strict";
import { test } from "node:test";
import { createCommandArguments, type ByteSource, type FileSystem, type InvocationCleanup } from "../../../src/contracts/index.js";
import { shellValueFromBytes } from "../../../src/contracts/value.js";
import { Budget, JqLimitError } from "../../../src/commands/structured/limits.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { native, nativeOptions, run } from "./helpers.js";

test("independent phase-one flow-comment boundaries against pinned yq", nativeOptions, async context => {
  assert.equal(process.env.SAFE_BASH_TEST_YQ_SHA256, "877de31753a4dd2401aa048937aa9a7fc4d5f6ce858cf31508c5802954297213");
  const inputs = [
    '{a: [1,# } ], ignored\n 2], b: "x#y"}',
    '["a"# ],{ \' " ignored\n,abc#def]',
    '[\'a\'\'#b\', plain#value, "a\\"#b"]',
    '[plain#not-a-comment, # rest ] }\n next]',
    '[one\t# comment\n,two]',
    '[[1]# ]\n,[2]]',
    '[a#literal#still, # } ignored\n b]',
    '[\n  1, # comment\n  2\n]',
    '[\n  1, # [\n  2\n]',
  ];
  for (const input of inputs) await context.test(JSON.stringify(input), async () => {
    const expected = await native(["-o=json", "-I=0", "."], input);
    assert.equal(expected.status, 0, expected.stderr);
    assert.deepEqual(await run(["-o", "json", "-c", "."], input), expected);
  });
});

test("independent characterization: embedded quotes in plain flow scalars remain non-parity", nativeOptions, async () => {
  for (const [input, stdout] of [
    ["[foo'#literal,\nlast]", `["foo'#literal","last"]\n`],
    ['[foo"bar # } comment\n,next]', '["foo\\"bar","next"]\n'],
  ]) {
    assert.deepEqual(await native(["-o=json", "-I=0", "."], input), { status: 0, stdout, stderr: "" });
    assert.deepEqual(await run(["-o", "json", "-c", "."], input), { status: 5, stdout: "", stderr: "yq: input: INPUT_YAML_SYNTAX at <stdin>:1:1\n" });
  }
});

for (const streaming of [true, false]) test(`independent symlink parent traversal preserves the original VFS path: stream=${streaming}`, async () => {
  const memory = createMemoryFileSystem();
  await memory.mkdir("/base");
  await memory.mkdir("/real/inner", { recursive: true });
  await memory.symlink!("../real/inner", "/base/link");
  await memory.writeFile("/base/data.yaml", Buffer.from("selected: lexical-alias\n"));
  await memory.writeFile("/real/data.yaml", Buffer.from("selected: actual-target\n"));
  const accessed: string[] = [];
  const fs: FileSystem = new Proxy(memory, { get(target, property) {
    if (property === "readStream" && !streaming) return undefined;
    const value: unknown = Reflect.get(target, property);
    if (property === "readStream" || property === "readFile") return (pathname: string, ...args: unknown[]) => {
      accessed.push(pathname);
      return Reflect.apply(value as (...args: unknown[]) => unknown, target, [pathname, ...args]);
    };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  for (const [operand, pathname] of [["./link/../data.yaml", "/base/./link/../data.yaml"], ["/base/link/../data.yaml", "/base/link/../data.yaml"], ["//base/link/../data.yaml", "//base/link/../data.yaml"]]) {
    assert.deepEqual(await run(["-o", "json", ".selected", operand!], "", { cwd: "/base/", fs }), { status: 0, stdout: '"actual-target"\n', stderr: "" });
    assert.equal(accessed.at(-1), pathname);
  }
});

test("independent raw invalid filenames never access their replacement-character aliases", async () => {
  const memory = createMemoryFileSystem();
  let accessed = 0;
  const fs: FileSystem = new Proxy(memory, { get(target, property) {
    if (property === "readFile" || property === "readStream") return () => { accessed++; throw new Error("Invalid filename reached VFS"); };
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  for (const bytes of [[255], [254], [192, 175], [226, 130], [237, 160, 128]]) {
    const argumentValues = createCommandArguments(["-o", "json", ".", shellValueFromBytes(Uint8Array.from(bytes))]);
    assert.deepEqual(await run(argumentValues.args, "", { argumentValues, fs }), { status: 2, stdout: "", stderr: "yq: cli: CLI_INVALID_UNICODE\n" });
  }
  assert.equal(accessed, 0);
  for (const filename of ["\ufffd", "\ufeffdata", "caf\u00e9", "cafe\u0301"]) {
    await memory.writeFile(`/${filename}`, Buffer.from(`selected: ${JSON.stringify(filename)}\n`));
    const argumentValues = createCommandArguments(["-o", "json", ".selected", shellValueFromBytes(Buffer.from(filename))]);
    assert.deepEqual(await run(argumentValues.args, "", { argumentValues, fs: memory }), { status: 0, stdout: JSON.stringify(filename) + "\n", stderr: "" });
  }
});

test("independent empty-fragment input yields to a scheduled host turn", { timeout: 2000 }, async () => {
  let hostTurn = false;
  const turn = setImmediate(() => { hostTurn = true; });
  const stdin = (async function* () {
    for (let count = 0; count < 4096; count++) yield new Uint8Array();
    yield Buffer.from("[1, # comment\n2]");
  })();
  try {
    assert.deepEqual(await run(["-o", "json", "-c", "."], "", { stdin }), { status: 0, stdout: "[1,2]\n", stderr: "" });
    assert.equal(hostTurn, true);
  } finally { clearImmediate(turn); }
});

test("independent empty-fragment work exhaustion closes the producer once", async context => {
  let produced = 0, returned = 0;
  const original = Budget.prototype.step;
  context.mock.method(Budget.prototype, "step", function (this: Budget, count = 1) {
    if (produced === 6) throw new JqLimitError("maxSteps");
    return original.call(this, count);
  });
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { produced++; return { done: false, value: new Uint8Array() }; },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } };
  assert.deepEqual(await run(["."], "", { stdin }), { status: 5, stdout: "", stderr: "yq: limit: LIMIT_MAX_STEPS\n" });
  assert.equal(produced, 6);
  assert.equal(returned, 1);
});

for (const primary of [false, 0, "", null]) test(`independent producer primary failure survives cleanup failure: ${String(primary)}`, async () => {
  let returned = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { throw primary; },
    async return() { returned++; throw new Error("secondary producer cleanup"); },
  }; } };
  await assert.rejects(run(["."], "", { stdin }), error => error === primary);
  assert.equal(returned, 1);
});

for (const reason of [false, 0, "", null]) test(`independent cancellation dominates producer cleanup failure: ${String(reason)}`, async () => {
  const controller = new AbortController();
  let returned = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { controller.abort(reason); return { done: false, value: new Uint8Array() }; },
    async return() { returned++; throw new Error("secondary producer cleanup"); },
  }; } };
  await assert.rejects(run(["."], "", { stdin, signal: controller.signal }), error => error === reason);
  assert.equal(returned, 1);
});

test("independent cancellation awaits registered cooperative producer teardown", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("review cancellation");
  let startClosing!: () => void, release!: () => void;
  const closing = new Promise<void>(resolve => { startClosing = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const cleanups: InvocationCleanup[] = [];
  let returned = 0, settled = false;
  const stdin: ByteSource = { [Symbol.asyncIterator]() {
    assert.equal(cleanups.length, 1, "cleanup registration must precede producer acquisition");
    return {
      async next() { controller.abort(reason); return { done: false, value: new Uint8Array() }; },
      async return() { returned++; startClosing(); await gate; return { done: true, value: undefined }; },
    };
  } };
  const operation = run(["."], "", { stdin, signal: controller.signal, registerCleanup(cleanup) { cleanups.push(cleanup); } });
  void operation.then(() => { settled = true; }, () => { settled = true; });
  try {
    await closing;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false, "registered cooperative teardown must finish before command rejection");
  } finally {
    release();
    await assert.rejects(operation, error => error === reason);
    await Promise.all(cleanups.map(cleanup => cleanup()));
  }
  assert.equal(returned, 1);
});
