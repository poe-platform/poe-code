import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { contractRuntime, execute, operation } from "./helpers.js";

test("command environment is a prototype-free data copy with literal special keys", async () => {
  const env = Object.fromEntries([["__proto__", "literal"], ["constructor", "ctor"], ["prototype", "proto"], ["KEY", "original"]]);
  const before = Object.getOwnPropertyDescriptors(env);
  const runtime = contractRuntime(async (_source, options) => {
    const copied = options.modules.command?.env;
    assert(copied && typeof copied === "object" && !Array.isArray(copied));
    assert.equal(Object.getPrototypeOf(copied), null);
    assert.deepEqual(Object.entries(copied), Object.entries(env));
    assert.equal(Object.hasOwn(copied, "__proto__"), true);
    Reflect.set(copied, "KEY", "guest mutation");
  });
  const result = await execute(["-e", "contract"], { runtime }, "", { env });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(Object.getOwnPropertyDescriptors(env), before);
  assert.equal(Object.getPrototypeOf(env), Object.prototype);
});

test("missing runtime is explicit and never consumes source or stdin", async () => {
  let read = false;
  const actual = await execute([], {}, { async *[Symbol.asyncIterator]() { read = true; throw new Error("unexpected read"); } });
  assert.equal(actual.exitCode, 127);
  assert.match(actual.stderr, /runtime.*not installed/iu);
  assert.equal(read, false);
  assert.equal((await execute(["--help"])).exitCode, 0);
});

test("inline source receives exact args, virtual context and a fresh budget", async () => {
  const budgets: object[] = [];
  const runtime = contractRuntime(async (source, options) => {
    assert.equal(source, "reviewed contract source");
    assert.deepEqual(options.modules.command?.args, ["hello world", "--flag"]);
    assert.equal(options.modules.command?.cwd, "/work");
    assert.deepEqual(options.modules.command?.env, Object.assign(Object.create(null), { KEY: "virtual", LC_ALL: "C" }));
    budgets.push(options.budget);
    return "result";
  });
  for (let invocation = 0; invocation < 2; invocation++) {
    const actual = await execute(["-p", "-e", "reviewed contract source", "--", "hello world", "--flag"], { runtime });
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.equal(actual.stdout.toString(), "result\n");
  }
  assert.notEqual(budgets[0], budgets[1]);
});

test("stdio consumes bytes once and routes awaited output without host IO", async () => {
  const runtime = contractRuntime(async (_source, options) => {
    const first = await operation(options, "stdio", "readBytes")(2);
    assert.deepEqual(first, [0, 255]);
    assert.equal(await operation(options, "stdio", "readText")(), "é😀");
    assert.equal(await operation(options, "stdio", "readBytes")(), null);
    await operation(options, "stdio", "writeBytes")(first);
    await operation(options, "stdio", "write")("é😀");
    await operation(options, "stdio", "error")("diagnostic");
  });
  const input = Buffer.concat([Buffer.from([0, 255]), Buffer.from("é😀")]);
  const actual = await execute(["-e", "contract IO"], { runtime }, input);
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.deepEqual(actual.stdout, input);
  assert.equal(actual.stderr, "diagnostic");
});

test("stdin source is not available again as guest data", async () => {
  const runtime = contractRuntime(async (source, options) => {
    assert.equal(source, "return 1;");
    assert.equal(await operation(options, "stdio", "readText")(), "");
    return 1;
  });
  const actual = await execute(["-p", "-", "argument"], { runtime }, "return 1;");
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(actual.stdout.toString(), "1\n");
});

test("usage failures occur before runner and input effects", async () => {
  const runtime = contractRuntime(async () => { throw new Error("unexpected runner"); });
  for (const args of [["-e"], ["--bogus"], ["--print=yes"], ["--eval"]]) {
    const actual = await execute(args, { runtime });
    assert.equal(actual.exitCode, 2);
    assert.doesNotMatch(actual.stderr, /unexpected runner/u);
  }
});

test("guest UTF-8 text preserves BOM and multibyte input across single-byte chunks", async () => {
  const text = "\uFEFFé😀\0終\n";
  const input = { async *[Symbol.asyncIterator]() { for (const byte of Buffer.from(text)) yield Uint8Array.of(byte); } };
  const runtime = contractRuntime(async (_source, options) => { await operation(options, "stdio", "write")(await operation(options, "stdio", "readText")()); });
  const result = await execute(["-e", "contract"], { runtime }, input);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout, Buffer.from(text));
});

test("one leading source BOM is stripped without replaying source as guest input", async () => {
  const runtime = contractRuntime(async source => { assert.equal(source, "program"); });
  assert.equal((await execute(["-"], { runtime }, Buffer.from("\uFEFFprogram"))).exitCode, 0);
});

test("script loading honors a false streaming capability and requests bounded buffered reads", async () => {
  const memory = new MemoryFileSystem(); await memory.mkdir("/work"); await memory.writeFile("/work/script", Buffer.from("program"));
  let bounded = false;
  const fs = new Proxy(memory, { get(target, key) {
    if (key === "capabilities") return { ...target.capabilities, streamingRead: false };
    if (key === "readStream") return () => { throw new Error("stream capability disabled"); };
    if (key === "readFile") return async (path: string, options: { maxBytes?: number }) => { assert.equal(options.maxBytes, 20); bounded = true; return target.readFile(path, options); };
    const value: unknown = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const runtime = contractRuntime(async source => { assert.equal(source, "program"); });
  const result = await execute(["script"], { runtime, limits: { maxSourceBytes: 20 } }, "", { fs });
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(bounded, true);
});
