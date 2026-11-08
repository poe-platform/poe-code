import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { collectBytes, FsError } from "../../../src/contracts/index.js";
import type { ByteSource, FileSystem } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { RealFileSystem } from "../../../src/fs/real/index.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";

function wrapped(backend: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(backend, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

for (const length of [0, 4099]) {
  test(`readonly real streams preserve ${length} binary bytes and ranges without readFile`, async (context) => {
    const root = await mkdtemp(fileURLToPath(new URL(".real-stream-", import.meta.url)));
    context.after(() => rm(root, { recursive: true, force: true }));
    const real = new RealFileSystem({ root });
    const bytes = Uint8Array.from({ length }, (unused, index) => index % 256);
    await real.writeFile("/file", bytes);
    const readonly = createReadOnlyFileSystem(wrapped(real, {
      async readFile() { assert.fail("stream must not collect through readFile"); },
    }));
    assert.equal(readonly.capabilities.streamingRead, true);
    assert.equal(readonly.capabilities.streamingWrite, false);
    assert.deepEqual(await collectBytes(readonly.readStream("/file", { chunkSize: 17 }), { maxBytes: length }), bytes);
    assert.deepEqual(await collectBytes(readonly.readStream("/file", { start: 1, endExclusive: 33, chunkSize: 7 }), { maxBytes: 32 }), bytes.slice(1, 33));
    let consumed = false;
    const source = (async function* () { consumed = true; yield bytes; })();
    await assert.rejects(readonly.writeStream("/missing", source, { signal: AbortSignal.abort("stop") }), { code: "EROFS" });
    assert.equal(consumed, false);
    assert.deepEqual(await real.readFile("/file"), bytes);
    assert.deepEqual((await real.readdir("/")).map((entry) => entry.name), ["file"]);
  });
}

test("readonly preserves conditional mounted streaming without claiming universal support", async () => {
  const root = createMemoryFileSystem();
  await root.writeFile("/file", new Uint8Array([0, 255]));
  const limited = wrapped(createMemoryFileSystem(), { capabilities: { streamingRead: false } });
  await limited.writeFile("/file", new Uint8Array([1]));
  const readonly = createReadOnlyFileSystem(createMountFileSystem({ root, mounts: { "/limited": limited } }));
  assert.equal(Object.hasOwn(readonly.capabilities, "streamingRead"), false);
  assert.deepEqual(await collectBytes(readonly.readStream("/file"), { maxBytes: 2 }), new Uint8Array([0, 255]));
  await assert.rejects(collectBytes(readonly.readStream("/limited/file"), { maxBytes: 2 }), { code: "ENOTSUP" });
});

test("readonly abort closes a blocked iterator and observes late next and cleanup rejections", { timeout: 2000 }, async () => {
  const started = deferred<void>();
  const pending = deferred<IteratorResult<Uint8Array>>();
  const cleanup = deferred<IteratorResult<Uint8Array>>();
  let returned = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { started.resolve(); return pending.promise; },
    return() { returned++; return cleanup.promise; },
  }; } };
  const readonly = createReadOnlyFileSystem(wrapped(createMemoryFileSystem(), { readStream: () => source }));
  const controller = new AbortController();
  const iterator = readonly.readStream("/file", { signal: controller.signal })[Symbol.asyncIterator]();
  const reading = iterator.next();
  await started.promise;
  const reason = new Error("cancel reader");
  controller.abort(reason);
  await assert.rejects(reading, (error: unknown) => error === reason);
  await Promise.resolve();
  assert.equal(returned, 1);
  pending.reject(new Error("late read failure"));
  cleanup.reject(new Error("late cleanup failure"));
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test("readonly preserves original stream errors even when cleanup also fails", async () => {
  const failure = new FsError("EIO", { syscall: "remoteRead", path: "/provider/file" });
  let returned = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { throw failure; },
    async return() { returned++; throw new Error("cleanup failed"); },
  }; } };
  const readonly = createReadOnlyFileSystem(wrapped(createMemoryFileSystem(), { readStream: () => source }));
  await assert.rejects(collectBytes(readonly.readStream("/file"), { maxBytes: 1 }), (error: unknown) => error === failure);
  assert.equal(returned, 1);
});

test("readonly consumer return reports cleanup failure without reading ahead", async () => {
  const failure = new Error("close failed");
  let reads = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { reads++; return { done: false as const, value: new Uint8Array([255]) }; },
    async return() { throw failure; },
  }; } };
  const readonly = createReadOnlyFileSystem(wrapped(createMemoryFileSystem(), { readStream: () => source }));
  const iterator = readonly.readStream("/file")[Symbol.asyncIterator]();
  assert.deepEqual((await iterator.next()).value, new Uint8Array([255]));
  assert.equal(reads, 1);
  await assert.rejects(iterator.return!(), (error: unknown) => error === failure);
  assert.equal(reads, 1);
});
