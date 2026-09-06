import assert from "node:assert/strict";
import { test } from "vitest";
import { scopeFileSystem } from "../src/fs/scoped.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { S3FileSystem } from "../src/fs/s3/filesystem.js";
import { MockS3Client } from "../src/fs/s3/mock.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import type { FileSystem } from "../src/contracts/filesystem.js";

test("scoped view retains S3 and Memory authority in both directions and nested views", async () => {
  const memory = new MemoryFileSystem();
  const remote = new S3FileSystem({ transport: new MockS3Client({ buckets: ["bucket"] }), bucket: "bucket" });
  await memory.writeFile("/one", new Uint8Array([1]));
  await remote.writeFile("/two", new Uint8Array([2]));
  let charges = 0;
  const scoped = scopeFileSystem(memory, () => { charges++; }, new AbortController().signal);
  assert.equal(await remote.compareEntry("/two", memory, "/one"), "distinct");
  assert.equal(await scoped.compareEntry!("/one", remote, "/two"), "distinct");
  assert.equal(charges, 1);
  assert.equal(await remote.compareEntry("/two", scoped, "/one"), "distinct");
  assert.equal(await new ReadOnlyFileSystem(scoped).compareEntry("/one", remote, "/two"), "distinct");
  assert.equal(charges, 1);
});

test("entry-view resolution respects falsey scope cancellation", async () => {
  const memory = new MemoryFileSystem();
  const remote = new S3FileSystem({ transport: new MockS3Client({ buckets: ["bucket"] }), bucket: "bucket" });
  await memory.writeFile("/one", new Uint8Array([1]));
  await remote.writeFile("/two", new Uint8Array([2]));
  const controller = new AbortController();
  const scoped = scopeFileSystem(memory, () => {}, controller.signal);
  controller.abort(false);
  await assert.rejects(remote.compareEntry("/two", scoped, "/one"), error => error === false);
});

for (const reason of [null, false, 0, "", NaN]) {
  test(`stream advancement respects ${String(reason)} cancellation while return remains available`, async () => {
    const controller = new AbortController();
    let charges = 0;
    let advances = 0;
    let returned = 0;
    const original = {
      capabilities: {},
      readStream: () => ({ [Symbol.asyncIterator]() {
        return {
          async next() { advances++; return { done: false, value: new Uint8Array([7]) }; },
          async return() { returned++; return { done: true, value: undefined }; },
        };
      } }),
    } as unknown as FileSystem;
    const scoped = scopeFileSystem(original, () => { charges++; }, controller.signal);
    const iterator = scoped.readStream!("/")[Symbol.asyncIterator]();
    assert.deepEqual((await iterator.next()).value, new Uint8Array([7]));
    controller.abort(reason);
    await assert.rejects(iterator.next(), error => Object.is(error, reason));
    await iterator.return!();
    assert.equal(charges, 1);
    assert.equal(advances, 1);
    assert.equal(returned, 1);
  });
}

test("pending stream result cannot publish bytes after cancellation and still permits return", async () => {
  const controller = new AbortController();
  let complete!: (value: IteratorResult<Uint8Array>) => void;
  let returned = 0;
  const original = {
    capabilities: {},
    readStream: () => ({ [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<Uint8Array>>(resolve => { complete = resolve; }),
        async return() { returned++; return { done: true, value: undefined }; },
      };
    } }),
  } as unknown as FileSystem;
  const scoped = scopeFileSystem(original, () => {}, controller.signal);
  const iterator = scoped.readStream!("/")[Symbol.asyncIterator]();
  const pending = iterator.next();
  controller.abort(0);
  complete({ done: false, value: new Uint8Array([7]) });
  await assert.rejects(pending, error => error === 0);
  await iterator.return!();
  assert.equal(returned, 1);
});

for (const position of ["before", "after"] as const) {
  test(`cancelled ${position}-next iteration releases native Memory storage without explicit return`, async () => {
    const memory = new MemoryFileSystem({ maxMetadataUnits: 4 });
    await memory.writeFile("/f", new Uint8Array([1, 2]));
    const controller = new AbortController();
    const original = position === "before" ? memory : {
      capabilities: memory.capabilities,
      readStream: () => ({ [Symbol.asyncIterator]() {
        const iterator = memory.readStream("/f", { chunkSize: 1 })[Symbol.asyncIterator]();
        return {
          async next() {
            const result = await iterator.next();
            controller.abort(false);
            return result;
          },
          return: iterator.return!.bind(iterator),
        };
      } }),
    } as FileSystem;
    const scoped = scopeFileSystem(original, () => {}, controller.signal);
    await assert.rejects(async () => {
      for await (const chunk of scoped.readStream!("/f", { chunkSize: 1 })) {
        assert.equal(chunk.byteLength, 1);
        controller.abort(false);
      }
    }, error => error === false);
    await memory.rm("/f");
    await memory.mkdir("/reclaimed");
    assert.deepEqual((await memory.readdir("/")).map(entry => entry.name), ["reclaimed"]);
  });
}

test("cancelled stream cleanup preserves its primary falsey reason", async () => {
  const controller = new AbortController();
  let returned = 0;
  const original = {
    capabilities: {},
    readStream: () => ({ async *[Symbol.asyncIterator]() {
      try { yield new Uint8Array([1]); }
      finally { returned++; throw 0; }
    } }),
  } as unknown as FileSystem;
  const scoped = scopeFileSystem(original, () => {}, controller.signal);
  await assert.rejects(async () => {
    for await (const chunk of scoped.readStream!("/")) {
      assert.equal(chunk.byteLength, 1);
      controller.abort(false);
    }
  }, error => error === false);
  assert.equal(returned, 1);
});
