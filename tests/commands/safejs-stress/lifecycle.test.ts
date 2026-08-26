import assert from "node:assert/strict";
import { setImmediate, setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import type { ByteSource } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { contractRuntime, deferred, execute, operation } from "../safejs/helpers.js";

test("fixture: guest writes await downstream backpressure before consuming more input", { timeout: 2000 }, async () => {
  const entered = deferred();
  const release = deferred();
  let pulls = 0;
  let closed = 0;
  const input: ByteSource = { async *[Symbol.asyncIterator]() { try { for (let index = 0; index < 3; index++) { pulls++; yield Uint8Array.of(index); } } finally { closed++; } } };
  const runtime = contractRuntime(async (_source, options) => {
    const first = await operation(options, "stdio", "readBytes")(1);
    await operation(options, "stdio", "writeBytes")(first);
    assert.deepEqual(await operation(options, "stdio", "readBytes")(1), [1]);
  });
  const task = execute(["-e", "fixture"], { runtime }, input, { stdout: { async write() { entered.resolve(); await release.promise; } } });
  await entered.promise;
  await setImmediate();
  assert.equal(pulls, 1);
  release.resolve();
  assert.equal((await task).exitCode, 0);
  assert.equal(pulls, 2);
  assert.equal(closed, 1);
});

for (const phase of ["source", "guest"] as const) {
  test(`fixture: ${phase} iterator cleanup observes late rejection after cancellation`, { timeout: 2000 }, async () => {
    const cleanup = deferred();
    const blocked = deferred<IteratorResult<Uint8Array>>();
    const controller = new AbortController();
    const reason = new Error("cancel cleanup");
    let reads = 0;
    let closes = 0;
    const input: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { reads++; if (phase === "source") throw new Error("read failed"); return { done: false, value: Buffer.from("ab") }; },
      return() { closes++; cleanup.resolve(); return blocked.promise; },
    }; } };
    const runtime = contractRuntime(async (_source, options) => { await operation(options, "stdio", "readBytes")(1); });
    const task = execute(phase === "source" ? ["-"] : ["-e", "fixture"], { runtime }, input, { signal: controller.signal });
    if (phase === "source") {
      const rejected = assert.rejects(task, error => error === reason);
      await cleanup.promise;
      controller.abort(reason);
      await rejected;
    } else {
      const result = await task;
      assert.equal(result.exitCode, 0);
      await cleanup.promise;
    }
    controller.abort(reason);
    blocked.reject(new Error("late cleanup rejection"));
    await delay(5);
    assert.equal(closes, 1);
    assert.equal(reads, 1);
  });
}

test("fixture: sink early-close aborts queued writes and preserves prior byte effects", async () => {
  const error = Object.assign(new Error("downstream closed"), { code: "EPIPE" });
  let writes = 0;
  const actual: number[] = [];
  const runtime = contractRuntime(async (_source, options) => {
    await operation(options, "stdio", "writeBytes")([1]);
    try { await operation(options, "stdio", "writeBytes")([2]); } catch {}
    try { await operation(options, "stdio", "writeBytes")([3]); } catch {}
  });
  const result = await execute(["-e", "fixture"], { runtime }, "", { stdout: { async write(bytes) {
    writes++;
    if (writes === 2) throw error;
    actual.push(...bytes);
  } } });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /downstream closed/u);
  assert.deepEqual(actual, [1]);
  assert.equal(writes, 2);
});

test("fixture: abandoned pending reads settle on completion without unhandled late failures", { timeout: 2000 }, async () => {
  const entered = deferred();
  const pending = deferred<IteratorResult<Uint8Array>>();
  let closed = 0;
  const input: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { entered.resolve(); return pending.promise; },
    async return() { closed++; return { done: true, value: undefined }; },
  }; } };
  let read: Promise<unknown> | undefined;
  const result = await execute(["-e", "fixture"], { runtime: contractRuntime(async (_source, options) => {
    read = Promise.resolve(operation(options, "stdio", "readText")());
    void read.catch(() => {});
    await entered.promise;
  }) }, input);
  assert.equal(result.exitCode, 0, result.stderr);
  assert(read);
  await assert.rejects(read);
  pending.reject(new Error("late input failure"));
  await delay(5);
  assert.equal(closed, 1);
});

test("fixture: pending buffered source loading propagates cancellation and observes late failure", { timeout: 2000 }, async () => {
  const entered = deferred();
  const blocked = deferred<Uint8Array>();
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  Object.defineProperty(fs, "readStream", { value: undefined });
  let hostSignal: AbortSignal | undefined;
  fs.readFile = async (_path, options) => {
    assert.equal(options?.maxBytes, 16);
    hostSignal = options?.signal;
    entered.resolve();
    return blocked.promise;
  };
  const controller = new AbortController();
  const reason = new Error("cancel buffered source");
  let ran = false;
  const task = execute(["source.ajs"], { runtime: contractRuntime(async () => { ran = true; }), limits: { maxSourceBytes: 16 } }, "", { fs, signal: controller.signal });
  const rejected = assert.rejects(task, error => error === reason);
  await entered.promise;
  assert(hostSignal);
  controller.abort(reason);
  await rejected;
  assert(hostSignal.aborted);
  blocked.reject(new Error("late source read failure"));
  await delay(5);
  assert.equal(ran, false);
});
