import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, createMountFileSystem, createReadOnlyFileSystem, FsError } from "poe-code/safe-fs";
import { createDeviceFileSystem } from "../../../src/fs/devices/index.js";

for (const reason of [false, 0, "", null]) {
  for (const position of [null, 3]) {
    test(`independent device cancellation inside second entropy chunk preserves prefix: ${String(reason)}, ${position}`, async context => {
      const controller = new AbortController();
      let calls = 0;
      context.mock.method(globalThis.crypto, "getRandomValues", (bytes: Uint8Array) => {
        assert.ok(bytes.buffer instanceof ArrayBuffer);
        assert.ok(bytes.length <= 65536);
        bytes.fill(++calls);
        if (calls === 2) controller.abort(reason);
        return bytes;
      });
      const descriptor = await createDeviceFileSystem().open("/urandom", { access: "read" });
      context.after(() => descriptor.close());
      const bytes = new Uint8Array(new SharedArrayBuffer(131077)).fill(0xa5);
      await assert.rejects(descriptor.read(bytes.subarray(2, -2), position, { signal: controller.signal }), error => Object.is(error, reason));
      assert.equal(calls, 2);
      assert.deepEqual(bytes.subarray(0, 2), Uint8Array.of(0xa5, 0xa5));
      assert.deepEqual(bytes.subarray(2, 65538), new Uint8Array(65536).fill(1));
      assert.deepEqual(bytes.subarray(65538), new Uint8Array(bytes.length - 65538).fill(0xa5));
      assert.equal(await descriptor.getPosition!(), position === null ? 65536 : 0);
      assert.equal(await descriptor.probeRead!(), "ready");
      assert.equal(calls, 2);
    });
  }

  test(`independent device retains falsey entropy failure cause: ${String(reason)}`, async context => {
    context.mock.method(globalThis.crypto, "getRandomValues", (bytes: Uint8Array) => {
      bytes.fill(8);
      throw reason;
    });
    const descriptor = await createDeviceFileSystem().open("/random", { access: "read" });
    context.after(() => descriptor.close());
    const bytes = new Uint8Array(3).fill(0xa5);
    await assert.rejects(descriptor.read(bytes, null), error => {
      assert.ok(error instanceof FsError);
      assert.equal(error.code, "EIO");
      assert.ok(Object.is(error.cause, reason));
      return true;
    });
    assert.deepEqual(bytes, new Uint8Array(3).fill(0xa5));
    assert.equal(await descriptor.getPosition!(), 0);
  });
}

test("independent device reentrant close drains full read and already admitted probe", async context => {
  const descriptor = await createDeviceFileSystem().open("/random", { access: "read" });
  context.after(() => descriptor.close());
  let closing: Promise<void> | undefined;
  let closed = false;
  let calls = 0;
  context.mock.method(globalThis.crypto, "getRandomValues", (bytes: Uint8Array) => {
    calls++;
    assert.equal(closed, false);
    if (calls === 1) closing = descriptor.close().then(() => { closed = true; });
    bytes.fill(9);
    return bytes;
  });
  const bytes = new Uint8Array(65537);
  const reading = descriptor.read(bytes, null);
  const probing = descriptor.probeRead!();
  assert.equal(await reading, 65537);
  assert.equal(await probing, "ready");
  assert.ok(closing);
  await closing;
  assert.equal(closed, true);
  assert.equal(calls, 2);
  assert.deepEqual(bytes, new Uint8Array(65537).fill(9));
  await assert.rejects(descriptor.read(new Uint8Array(1), null), { code: "EBADF" });
});

test("independent device queued cancellation does not consume entropy or mutate its destination", async context => {
  const controller = new AbortController();
  let calls = 0;
  context.mock.method(globalThis.crypto, "getRandomValues", (bytes: Uint8Array) => {
    calls++;
    if (calls === 1) controller.abort(0);
    bytes.fill(9);
    return bytes;
  });
  const descriptor = await createDeviceFileSystem().open("/random", { access: "read" });
  context.after(() => descriptor.close());
  const first = descriptor.read(new Uint8Array(65537), null);
  const destination = new Uint8Array(7).fill(0xa5);
  const rejected = assert.rejects(descriptor.read(destination, null, { signal: controller.signal }), error => error === 0);
  assert.equal(await first, 65537);
  await rejected;
  assert.equal(calls, 2);
  assert.equal(await descriptor.getPosition!(), 65537);
  assert.deepEqual(destination, new Uint8Array(7).fill(0xa5));
});

test("independent shared device mounts retain identity without shared cursors or readonly promotion", async context => {
  const devices = createDeviceFileSystem();
  const filesystem = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/one": devices, "/two": devices, "/other": createDeviceFileSystem() } });
  const readonly = createReadOnlyFileSystem(filesystem);
  const first = await filesystem.open!("/one/zero", { access: "readwrite", append: true });
  context.after(() => first.close());
  const second = await readonly.open!("/two/zero", { access: "read" });
  context.after(() => second.close());
  const before = await first.stat();
  assert.deepEqual(await second.stat(), before);
  assert.notEqual((await filesystem.stat("/other/zero")).identityScope, before.identityScope);
  assert.equal(first.capabilities.positionedAppendWrite, true);
  assert.equal(second.capabilities.positionedWrite, false);
  assert.notEqual(second.capabilities.positionedAppendWrite, true);
  assert.notEqual(second.capabilities.delegateZeroLengthWrite, true);
  assert.equal(await first.write(Uint8Array.of(1, 2, 3), null), 3);
  assert.equal(await first.write(Uint8Array.of(4), Number.MAX_SAFE_INTEGER), 1);
  assert.equal(await first.getPosition!(), 3);
  assert.equal(await second.getPosition!(), 0);
  assert.equal(await second.probeRead!(), "ready");
  await assert.rejects(second.write(new Uint8Array(), null), { code: "EBADF" });
  await first.close();
  assert.equal(await second.read(new Uint8Array(2), null), 2);
  assert.equal(await second.getPosition!(), 2);
  assert.deepEqual(await second.stat(), before);
});

test("independent random stream backpressure retains chunks and caps maximum requested size", async context => {
  let calls = 0;
  context.mock.method(globalThis.crypto, "getRandomValues", (bytes: Uint8Array) => {
    assert.ok(bytes.length <= 65536);
    bytes.fill(++calls);
    return bytes;
  });
  const source = createDeviceFileSystem().readStream("/random", { start: Number.MAX_SAFE_INTEGER - 65537, endExclusive: Number.MAX_SAFE_INTEGER, chunkSize: Number.MAX_SAFE_INTEGER });
  const iterator = source[Symbol.asyncIterator]();
  context.after(async () => { await iterator.return?.(); });
  assert.equal(calls, 0);
  const first = await iterator.next();
  assert.equal(first.done, false);
  assert.equal(first.value.length, 65536);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  const second = await iterator.next();
  assert.deepEqual(second.value, Uint8Array.of(2));
  assert.deepEqual(first.value, new Uint8Array(65536).fill(1));
  assert.equal((await iterator.next()).done, true);
  assert.equal(calls, 2);
});

for (const reason of [false, ""]) {
  test(`independent pending device stream cancellation preserves ${String(reason)} and requests cleanup`, async () => {
    const controller = new AbortController();
    let pulls = 0;
    let closes = 0;
    const source: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            pulls++;
            queueMicrotask(() => controller.abort(reason));
            return new Promise<IteratorResult<Uint8Array>>(() => {});
          },
          async return() { closes++; return { done: true as const, value: undefined }; },
        };
      },
    };
    await assert.rejects(createDeviceFileSystem().writeStream("/null", source, { signal: controller.signal }), error => Object.is(error, reason));
    assert.equal(pulls, 1);
    assert.equal(closes, 1);
  });
}

test("independent device invalid positions and stream limits refuse without entropy", async context => {
  let calls = 0;
  context.mock.method(globalThis.crypto, "getRandomValues", (bytes: Uint8Array) => { calls++; return bytes; });
  const filesystem = createDeviceFileSystem();
  const descriptor = await filesystem.open("/random", { access: "readwrite", append: true });
  context.after(() => descriptor.close());
  for (const invalid of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(descriptor.read(new Uint8Array(1), invalid), { code: "EINVAL" });
    await assert.rejects(descriptor.write(new Uint8Array(), invalid), { code: "EINVAL" });
    const iterator = filesystem.readStream("/random", { chunkSize: invalid })[Symbol.asyncIterator]();
    await assert.rejects(iterator.next(), { code: "EINVAL" });
  }
  const empty = filesystem.readStream("/random", { start: Number.MAX_SAFE_INTEGER, endExclusive: Number.MAX_SAFE_INTEGER })[Symbol.asyncIterator]();
  assert.equal((await empty.next()).done, true);
  assert.equal(await descriptor.read(new Uint8Array(), Number.MAX_SAFE_INTEGER), 0);
  assert.equal(await descriptor.getPosition!(), 0);
  assert.equal(calls, 0);
});
