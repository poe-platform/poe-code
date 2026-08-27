import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { collectBytes, FsError, toByteSource } from "../../../src/contracts/index.js";
import type { ByteSource } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createOverlayFileSystem } from "../../../src/fs/overlay/index.js";
import { RealFileSystem } from "../../../src/fs/real/index.js";
import { deferred, encode, immutable, snapshot, wrapped } from "./helpers.js";

for (const flag of ["w", "a", "wx", "ax"] as const) {
  test(`overlay streamed ${flag} does not collect through either backend readFile`, async () => {
    const upper = createMemoryFileSystem();
    const lower = createMemoryFileSystem();
    const exclusive = flag.endsWith("x");
    if (!exclusive) await lower.writeFile("/file", encode("base"));
    const before = await snapshot(lower);
    const readonly = immutable(lower);
    const overlay = createOverlayFileSystem({
      upper: wrapped(upper, { async readFile() { assert.fail("upper readFile used by streaming write"); } }),
      lower: wrapped(readonly.lower, { async readFile() { assert.fail("lower readFile used by streaming copy-up"); } }),
    });
    const bytes = new Uint8Array([0, 128, 255]);
    await overlay.writeStream("/file", toByteSource(bytes), { flag });
    const expected = flag === "a" ? new Uint8Array([...encode("base"), ...bytes]) : bytes;
    assert.deepEqual(await collectBytes(overlay.readStream("/file", { chunkSize: 1 }), { maxBytes: 16 }), expected);
    assert.deepEqual(await upper.readFile("/file"), expected);
    assert.equal(overlay.capabilities.streamingRead, true);
    assert.equal(overlay.capabilities.streamingWrite, true);
    assert.equal(overlay.capabilities.atomicRename, false);
    assert.deepEqual(readonly.mutations, []);
    assert.deepEqual(await snapshot(lower), before);
    assert.deepEqual((await upper.readdir("/")).map((entry) => entry.name), ["file"]);
  });
}

test("overlay with real upper streams exact empty/binary data and large ranged reads", async (context) => {
  const root = await mkdtemp(fileURLToPath(new URL(".real-stream-", import.meta.url)));
  context.after(() => rm(root, { recursive: true, force: true }));
  const real = new RealFileSystem({ root });
  const lower = createMemoryFileSystem();
  const large = Uint8Array.from({ length: 4099 }, (unused, index) => index % 256);
  await real.writeFile("/large", large);
  const overlay = createOverlayFileSystem({
    upper: wrapped(real, { async readFile() { assert.fail("streamed read must not use readFile"); } }),
    lower,
    maxBufferBytes: 128,
  });
  assert.deepEqual(await collectBytes(overlay.readStream("/large", { start: 1023, endExclusive: 2057, chunkSize: 19 }), { maxBytes: 1034 }), large.slice(1023, 2057));
  await overlay.writeStream("/empty", toByteSource(new Uint8Array()));
  await overlay.writeStream("/binary", toByteSource(large.slice(0, 128)));
  assert.deepEqual(await real.readFile("/empty"), new Uint8Array());
  assert.deepEqual(await real.readFile("/binary"), large.slice(0, 128));
  await assert.rejects(overlay.writeStream("/binary", toByteSource(large)), { code: "EFBIG" });
  assert.deepEqual(await real.readFile("/binary"), large.slice(0, 128));
  assert.deepEqual((await real.readdir("/")).map((entry) => entry.name).sort(), ["binary", "empty", "large"]);
});

test("streamed input awaits upper consumption instead of reading ahead", { timeout: 2000 }, async () => {
  const upper = createMemoryFileSystem();
  const blocked = deferred<void>();
  const released = deferred<void>();
  let pulls = 0;
  let firstWrite = true;
  const overlay = createOverlayFileSystem({ upper: wrapped(upper, {
    async writeStream(path, source, options) {
      if (!firstWrite) return upper.writeStream(path, source, options);
      firstWrite = false;
      const iterator = source[Symbol.asyncIterator]();
      const first = await iterator.next();
      assert.equal(first.done, false);
      blocked.resolve();
      await released.promise;
      await upper.writeStream(path, (async function* () {
        yield first.value;
        while (true) {
          const next = await iterator.next();
          if (next.done) return;
          yield next.value;
        }
      })(), options);
    },
  }), lower: createMemoryFileSystem() });
  const writing = overlay.writeStream("/file", (async function* () {
    for (const value of [0, 128, 255]) { pulls++; yield new Uint8Array([value]); }
  })());
  await blocked.promise;
  assert.equal(pulls, 1);
  assert.deepEqual(await overlay.readdir("/"), []);
  await overlay.cleanup();
  assert.equal(pulls, 1);
  released.resolve();
  await writing;
  assert.deepEqual(await upper.readFile("/file"), new Uint8Array([0, 128, 255]));
  assert.deepEqual((await upper.readdir("/")).map((entry) => entry.name), ["file"]);
});

test("failed streamed publication preserves lower, whiteouts, and existing upper contents", async () => {
  const upper = createMemoryFileSystem();
  const lower = createMemoryFileSystem();
  await lower.writeFile("/file", encode("lower"));
  await lower.writeFile("/removed", encode("hidden"));
  await upper.writeFile("/file", encode("upper"));
  const before = await snapshot(lower);
  const failure = new FsError("ENOSPC");
  const overlay = createOverlayFileSystem({ upper: wrapped(upper, {
    async rename(source, destination, options) {
      if (destination === "/file") throw failure;
      await upper.rename(source, destination, options);
    },
  }), lower: immutable(lower).lower });
  await overlay.rm("/removed");
  await assert.rejects(overlay.writeStream("/file", toByteSource("replacement")), (error: unknown) => error === failure);
  assert.deepEqual(await upper.readFile("/file"), encode("upper"));
  assert.deepEqual(await snapshot(lower), before);
  await assert.rejects(overlay.stat("/removed"), { code: "ENOENT" });
  assert.deepEqual((await upper.readdir("/")).map((entry) => entry.name), ["file"]);
});

test("conditional lower streaming keeps upper usable and retains bounded lower fallback", async () => {
  const upper = createMemoryFileSystem();
  const lower = createMemoryFileSystem();
  await lower.writeFile("/file", encode("base"));
  let fallbackReads = 0;
  const overlay = createOverlayFileSystem({ upper, lower: wrapped(lower, {
    capabilities: { ...lower.capabilities, streamingRead: false },
    readStream() { assert.fail("explicitly unsupported lower stream invoked"); },
    async readFile(path, options) { fallbackReads++; assert.equal(options?.maxBytes, 8); return lower.readFile(path, options); },
  }), maxBufferBytes: 8 });
  assert.equal(Object.hasOwn(overlay.capabilities, "streamingRead"), false);
  assert.equal(Object.hasOwn(overlay.capabilities, "streamingWrite"), false);
  assert.deepEqual(await collectBytes(overlay.readStream("/file"), { maxBytes: 8 }), encode("base"));
  await overlay.writeStream("/file", toByteSource("!"), { flag: "a" });
  assert.deepEqual(await collectBytes(overlay.readStream("/file"), { maxBytes: 8 }), encode("base!"));
  assert.equal(fallbackReads, 2);
  assert.deepEqual(await lower.readFile("/file"), encode("base"));
});

test("a non-atomic upper never consumes a mutation stream or gains atomic capability", async () => {
  const upper = createMemoryFileSystem();
  const overlay = createOverlayFileSystem({ upper: wrapped(upper, {
    capabilities: { ...upper.capabilities, atomicRename: false },
  }), lower: createMemoryFileSystem() });
  let acquired = false;
  const source: ByteSource = { [Symbol.asyncIterator]() { acquired = true; throw new Error("consumed"); } };
  assert.equal(overlay.capabilities.atomicRename, false);
  assert.equal(overlay.capabilities.streamingWrite, false);
  await assert.rejects(overlay.writeStream("/file", source), { code: "ENOTSUP" });
  assert.equal(acquired, false);
  assert.deepEqual(await upper.readdir("/"), []);
});

test("overlay streamed read aborts blocked delegate and observes late failure", { timeout: 2000 }, async () => {
  const lower = createMemoryFileSystem();
  await lower.writeFile("/file", encode("data"));
  const started = deferred<void>();
  let rejectPending!: (reason: unknown) => void;
  const pending = new Promise<IteratorResult<Uint8Array>>((resolve, reject) => { rejectPending = reject; });
  let closed = 0;
  const overlay = createOverlayFileSystem({ upper: createMemoryFileSystem(), lower: wrapped(lower, {
    readStream: () => ({ [Symbol.asyncIterator]() { return {
      next() { started.resolve(); return pending; },
      async return() { closed++; return { done: true as const, value: undefined }; },
    }; } }),
  }) });
  const controller = new AbortController();
  const reading = overlay.readStream("/file", { signal: controller.signal })[Symbol.asyncIterator]().next();
  await started.promise;
  const reason = new Error("stop overlay reader");
  controller.abort(reason);
  await assert.rejects(reading, (error: unknown) => error === reason);
  await Promise.resolve();
  assert.equal(closed, 1);
  rejectPending(new Error("late lower failure"));
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test("overlay read errors retain identity and close the selected iterator", async () => {
  const lower = createMemoryFileSystem();
  await lower.writeFile("/file", encode("data"));
  const failure = new FsError("EIO", { path: "/provider/file" });
  let closed = 0;
  const overlay = createOverlayFileSystem({ upper: createMemoryFileSystem(), lower: wrapped(lower, {
    readStream: () => ({ [Symbol.asyncIterator]() { return {
      async next() { throw failure; },
      async return() { closed++; throw new Error("cleanup failure"); },
    }; } }),
  }) });
  await assert.rejects(collectBytes(overlay.readStream("/file"), { maxBytes: 4 }), (error: unknown) => error === failure);
  assert.equal(closed, 1);
});

test("overlay writer failure wins over failing input cleanup and never publishes", async () => {
  const upper = createMemoryFileSystem();
  const lower = createMemoryFileSystem();
  await lower.writeFile("/file", encode("original"));
  const failure = new FsError("ENOSPC");
  let returned = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false as const, value: encode("partial") }; },
    async return() { returned++; throw new Error("input cleanup failure"); },
  }; } };
  const overlay = createOverlayFileSystem({ upper: wrapped(upper, {
    async writeStream(path, input) {
      const first = await input[Symbol.asyncIterator]().next();
      assert.equal(first.done, false);
      await upper.writeFile(path, first.value);
      throw failure;
    },
  }), lower });
  await assert.rejects(overlay.writeStream("/file", source), (error: unknown) => error === failure);
  assert.equal(returned, 1);
  assert.deepEqual(await lower.readFile("/file"), encode("original"));
  assert.deepEqual(await upper.readdir("/"), []);
});
