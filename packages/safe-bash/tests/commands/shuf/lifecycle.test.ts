import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import type { ByteSource, CommandContext, InvocationCleanup } from "../../../src/contracts/index.js";
import { RandomIntegers } from "../../../src/commands/shuf/random.js";
import { entropy, run } from "./helpers.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(accept => { resolve = accept; });
  return { promise, resolve };
}

async function fixture() {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/random", entropy);
  const cleanup: InvocationCleanup[] = [];
  const context: CommandContext = {
    command: "shuf", args: [], cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
    registerCleanup(callback) { cleanup.push(callback); },
  };
  return { fs, context, cleanup };
}

test("nonstream entropy readFile has an admission bound before allocation", async () => {
  const { fs } = await fixture();
  Object.defineProperty(fs, "readStream", { value: undefined });
  fs.readFile = async (_path, options) => {
    assert.equal(options?.maxBytes, 64 * 1024 * 1024);
    assert.ok(options?.signal);
    return entropy;
  };
  assert.equal((await run(["-e", "a", "b", "--random-source=/random"], undefined, undefined, { fs })).exitCode, 0);
});

test("nonstream record readFile has an admission bound before allocation", async () => {
  const { fs } = await fixture();
  Object.defineProperty(fs, "readStream", { value: undefined });
  fs.readFile = async (_path, options) => {
    assert.equal(options?.maxBytes, 64 * 1024 * 1024);
    return Buffer.from("x\n");
  };
  assert.equal((await run(["/random"], undefined, undefined, { fs })).exitCode, 0);
});

test("entropy close waits for an admitted open and prohibits later reads", async () => {
  const { fs, context } = await fixture();
  const entered = deferred<void>();
  const release = deferred<void>();
  let reads = 0;
  fs.access = async () => { entered.resolve(); await release.promise; };
  fs.readStream = () => { reads++; return (async function* () {})(); };
  const random = new RandomIntegers(context, "/random");
  const opening = random.open();
  const rejected = assert.rejects(opening);
  await entered.promise;
  let completed = false;
  const closing = random.close().then(() => { completed = true; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(completed, false);
  } finally { release.resolve(); await closing; await rejected; }
  assert.equal(reads, 0);
});

for (const duringOpen of [false, true]) {
  test(`entropy closes an admitted iterator without demanding bytes; reentrant=${duringOpen}`, async () => {
    const { fs, context } = await fixture();
    let returns = 0;
    const random = new RandomIntegers(context, "/random");
    const source: ByteSource = {
      [Symbol.asyncIterator]() {
        return {
          async next() { assert.fail("unused entropy must not be read"); },
          async return() { returns++; return { done: true, value: undefined }; },
        };
      },
    };
    fs.readStream = () => { if (duringOpen) void random.close(); return source; };
    if (duringOpen) await assert.rejects(random.open());
    else await random.open();
    await random.close();
    await random.close();
    assert.equal(returns, 1);
    await assert.rejects(random.open());
    await assert.rejects(random.choose(1n));
  });
}

test("entropy close interrupts pending next and waits for cooperative return", async () => {
  const { fs, context } = await fixture();
  const entered = deferred<void>();
  const pending = deferred<IteratorResult<Uint8Array>>();
  let returns = 0;
  let finished = false;
  fs.readStream = () => ({
    [Symbol.asyncIterator]() {
      return {
        next() { entered.resolve(); return pending.promise; },
        async return() {
          returns++;
          pending.resolve({ done: true, value: undefined });
          await new Promise<void>(resolve => setImmediate(resolve));
          finished = true;
          return { done: true, value: undefined };
        },
      };
    },
  });
  const random = new RandomIntegers(context, "/random");
  await random.open();
  const choosing = assert.rejects(random.choose(2n));
  await entered.promise;
  const closing = random.close();
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(returns, 1);
  } finally { pending.resolve({ done: true, value: undefined }); await closing; await choosing; }
  assert.equal(finished, true);
  assert.equal(context.signal.aborted, false);
});

test("nonstream entropy is not read before repeat output truncates its alias", async () => {
  const { fs } = await fixture();
  Object.defineProperty(fs, "readStream", { value: undefined });
  const result = await run(["-ern1", "a", "b", "--random-source=/random", "-o/random"], undefined, undefined, { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "shuf: '/random': end of file\n");
  assert.equal((await fs.readFile("/random")).length, 0);
});

test("single-choice nonstream entropy is opened but never read", async () => {
  const { fs } = await fixture();
  Object.defineProperty(fs, "readStream", { value: undefined });
  fs.readFile = async () => { assert.fail("unused entropy must not be loaded"); };
  assert.equal((await run(["-e", "x", "--random-source=/random"], undefined, undefined, { fs })).exitCode, 0);
});

for (const streaming of [false, true]) {
  test(`oversized entropy is rejected before copying; streaming=${streaming}`, async () => {
    const { fs, context } = await fixture();
    const bytes = Uint8Array.of(1, 2, 3);
    if (streaming) fs.readStream = () => (async function* () { yield bytes; })();
    else {
      Object.defineProperty(fs, "readStream", { value: undefined });
      fs.readFile = async (_path, options) => { assert.equal(options?.maxBytes, 2); return bytes; };
    }
    const random = new RandomIntegers(context, "/random", 2);
    await random.open();
    try { await assert.rejects(random.choose(2n), { message: "shuf: maxInputBytes limit exceeded\n" }); }
    finally { await random.close(); }
  });
}

test("reentrant input closure retires a late admitted source", async () => {
  const { fs, cleanup } = await fixture();
  let returns = 0;
  fs.readStream = () => {
    void cleanup[0]!();
    return {
      [Symbol.asyncIterator]() {
        return {
          async next() { assert.fail("closed input must not be read"); },
          async return() { returns++; return { done: true, value: undefined }; },
        };
      },
    };
  };
  await assert.rejects(run(["/random"], undefined, undefined, { fs, registerCleanup(callback) { cleanup.push(callback); } }));
  assert.equal(returns, 1);
});
