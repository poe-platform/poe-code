import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { createMemoryFileSystem, createMountFileSystem, FsError, openFileDescriptor } from "poe-code/safe-fs";
import type { FileDescriptor, FileSystem, OpenFileOptions } from "poe-code/safe-fs";
import { createDeviceFileSystem } from "../../../src/fs/devices/index.js";

const names = ["null", "zero", "random", "urandom"] as const;

async function acquire(context: TestContext, fs: FileSystem, path: string, options: OpenFileOptions): Promise<FileDescriptor> {
  assert.equal(typeof fs.open, "function", "device provider must expose canonical FileSystem.open");
  const descriptor = await fs.open!(path, options);
  context.after(() => descriptor.close());
  return descriptor;
}

test("public safe-fs canonical descriptor builder prerequisite is present", () => {
  assert.equal(typeof openFileDescriptor, "function");
});

test("public builder must not turn a device's zero-length write rejection into success", async context => {
  const failure = new FsError("EPERM", { syscall: "write", path: "/urandom" });
  let writes = 0;
  const fs = createDeviceFileSystem();
  const descriptor = await openFileDescriptor("/urandom", { access: "write" }, {
    position: true, readObservation: true, openTruncate: true,
    delegateZeroLengthWrite: true,
    positionedRead: true, positionedWrite: true, truncate: true, synchronization: "volatile",
  }, async () => ({
    resource: undefined,
    async stat() { return fs.stat("/urandom"); },
    async getPosition() { return 0; },
    async probeRead() { return "ready"; },
    async read() { return 0; },
    async write() { writes++; throw failure; },
    async truncate() {},
    async sync() {},
    async close() {},
  }));
  context.after(() => descriptor.close());
  await assert.rejects(descriptor.write(new Uint8Array(), null), error => error === failure);
  assert.equal(writes, 1);
  assert.equal(await descriptor.getPosition!(), 0);
});

for (const name of names) {
  test(`Darwin canonical ${name}: retained character identity and explicit capabilities`, async context => {
    const fs = createDeviceFileSystem();
    const descriptor = await acquire(context, fs, `/${name}`, { access: "read" });
    assert.equal(fs.capabilities.open, true);
    assert.equal(descriptor.capabilities.position, true);
    assert.equal(descriptor.capabilities.readObservation, true);
    assert.equal(descriptor.capabilities.openTruncate, true);
    assert.equal(descriptor.capabilities.positionedRead, true);
    assert.equal(descriptor.capabilities.positionedWrite, false);
    assert.equal(descriptor.capabilities.truncate, false);
    assert.equal(descriptor.capabilities.synchronization, "volatile");
    const stat = await descriptor.stat();
    assert.equal(stat.type, "character");
    assert.equal(stat.mode, 0o020666);
    assert.equal(stat.size, 0);
    assert.deepEqual(stat, await fs.stat(`/${name}`));
    const independent = await acquire(context, fs, `/${name}`, { access: "read" });
    assert.deepEqual(await independent.stat(), stat);
    assert.equal(await descriptor.getPosition!(), 0);
    assert.equal(await descriptor.probeRead!(), "ready");
    assert.equal(await independent.getPosition!(), 0);
  });

  test(`Darwin canonical ${name}: sequential reads, positioned reads and truthful EOF`, async context => {
    const fs = createDeviceFileSystem();
    const descriptor = await acquire(context, fs, `/${name}`, { access: "read" });
    const independent = await acquire(context, fs, `/${name}`, { access: "read" });
    const bytes = new Uint8Array(7).fill(0xa5);
    const count = await descriptor.read(bytes.subarray(2, 5), null);
    assert.equal(count, name === "null" ? 0 : 3);
    assert.deepEqual(bytes.subarray(0, 2), Uint8Array.of(0xa5, 0xa5));
    assert.deepEqual(bytes.subarray(5), Uint8Array.of(0xa5, 0xa5));
    if (name === "null") assert.deepEqual(bytes, new Uint8Array(7).fill(0xa5));
    if (name === "zero") assert.deepEqual(bytes.subarray(2, 5), new Uint8Array(3));
    assert.equal(await descriptor.getPosition!(), count);
    for (const position of [0, 7]) {
      const positioned = new Uint8Array(3).fill(0xa5);
      assert.equal(await descriptor.read(positioned, position), name === "null" ? 0 : 3);
      if (name === "zero") assert.deepEqual(positioned, new Uint8Array(3));
      if (name === "null") assert.deepEqual(positioned, new Uint8Array(3).fill(0xa5));
      assert.equal(await descriptor.getPosition!(), count);
    }
    assert.equal(await descriptor.read(new Uint8Array(1), null), name === "null" ? 0 : 1);
    assert.equal(await descriptor.getPosition!(), name === "null" ? 0 : 4);
    assert.equal(await descriptor.probeRead!(), "ready");
    assert.equal(await independent.getPosition!(), 0);
    assert.equal((await descriptor.stat()).size, 0);
  });

  test(`Darwin canonical ${name}: access is enforced while write-only readiness remains observable`, async context => {
    const fs = createDeviceFileSystem();
    const reader = await acquire(context, fs, `/${name}`, { access: "read" });
    const writer = await acquire(context, fs, `/${name}`, { access: "write" });
    await assert.rejects(reader.write(Uint8Array.of(1), null), { code: "EBADF" });
    await assert.rejects(reader.truncate(0), { code: "EBADF" });
    await assert.rejects(writer.read(new Uint8Array(1), null), { code: "EBADF" });
    await assert.rejects(writer.read(new Uint8Array(1), 7), { code: "EBADF" });
    assert.equal(writer.capabilities.positionedRead, false);
    assert.equal(writer.capabilities.positionedWrite, true);
    assert.equal(await writer.probeRead!(), "ready");
    assert.equal(await writer.getPosition!(), 0);
    assert.equal(await reader.getPosition!(), 0);
  });

  test(`Darwin canonical ${name}: zero-length I/O preserves device errors and wrong-access precedence`, async context => {
    const fs = createDeviceFileSystem();
    const reader = await acquire(context, fs, `/${name}`, { access: "read" });
    const writer = await acquire(context, fs, `/${name}`, { access: "write" });
    const empty = new Uint8Array();
    assert.equal(await reader.read(empty, null), 0);
    await assert.rejects(reader.write(empty, null), { code: "EBADF" });
    await assert.rejects(writer.read(empty, null), { code: "EBADF" });
    if (name === "urandom") await assert.rejects(writer.write(empty, null), { code: "EPERM" });
    else assert.equal(await writer.write(empty, null), 0);
    assert.equal(await reader.getPosition!(), 0);
    assert.equal(await writer.getPosition!(), 0);
  });

  for (const append of [false, true]) {
    test(`Darwin canonical ${name}: ${append ? "append" : "plain"} writes preserve native cursor rules`, async context => {
      const fs = createDeviceFileSystem();
      const descriptor = await acquire(context, fs, `/${name}`, { access: "readwrite", append });
      const independent = await acquire(context, fs, `/${name}`, { access: "read" });
      if (name === "null") assert.equal(await descriptor.write(new Uint8Array(7), null), 7);
      else assert.equal(await descriptor.read(new Uint8Array(7), null), 7);
      assert.equal(await descriptor.getPosition!(), 7);
      const payload = Uint8Array.of(0x41);
      if (name === "urandom") await assert.rejects(descriptor.write(payload, null), { code: "EPERM" });
      else assert.equal(await descriptor.write(payload, null), 1);
      const position = name === "urandom" ? 7 : 8;
      assert.equal(await descriptor.getPosition!(), position);
      if (name === "urandom") await assert.rejects(descriptor.write(payload, 3), { code: "EPERM" });
      else assert.equal(await descriptor.write(payload, 3), 1);
      assert.equal(await descriptor.getPosition!(), position);
      assert.deepEqual(payload, Uint8Array.of(0x41));
      assert.equal(await independent.getPosition!(), 0);
      assert.equal((await descriptor.stat()).size, 0);
    });
  }

  test(`Darwin canonical ${name}: open truncation and ftruncate are identity-preserving no-ops`, async context => {
    const fs = createDeviceFileSystem();
    const before = await fs.stat(`/${name}`);
    const descriptor = await acquire(context, fs, `/${name}`, { access: "readwrite", creation: "ifMissing", truncate: true, mode: 0o600 });
    assert.equal(descriptor.capabilities.openTruncate, true);
    assert.equal(descriptor.capabilities.truncate, true);
    if (name === "null") await descriptor.write(new Uint8Array(7), null);
    else await descriptor.read(new Uint8Array(7), null);
    for (const length of [0, 1, 4096]) {
      await descriptor.truncate(length);
      assert.equal(await descriptor.getPosition!(), 7);
      assert.deepEqual(await descriptor.stat(), before);
    }
  });

  for (const synchronization of ["data", "all"] as const) {
    test(`Darwin canonical ${name}: ${synchronization} synchronization opens without storage-durability claims`, async context => {
      const fs = createDeviceFileSystem();
      const descriptor = await acquire(context, fs, `/${name}`, { access: "write", synchronization });
      assert.equal(descriptor.capabilities.synchronization, "volatile");
      await descriptor.sync(false);
      await descriptor.sync(true);
      assert.equal(await descriptor.getPosition!(), 0);
      assert.equal((await descriptor.stat()).size, 0);
    });
  }

  test(`Darwin canonical ${name}: close is idempotent and retires all descriptor operations`, async context => {
    const descriptor = await acquire(context, createDeviceFileSystem(), `/${name}`, { access: "readwrite" });
    await Promise.all([descriptor.close(), descriptor.close()]);
    await assert.rejects(descriptor.stat(), { code: "EBADF" });
    await assert.rejects(descriptor.getPosition!(), { code: "EBADF" });
    await assert.rejects(descriptor.probeRead!(), { code: "EBADF" });
    await assert.rejects(descriptor.read(new Uint8Array(1), null), { code: "EBADF" });
    await assert.rejects(descriptor.write(Uint8Array.of(1), null), { code: "EBADF" });
    await assert.rejects(descriptor.truncate(0), { code: "EBADF" });
    await assert.rejects(descriptor.sync(false), { code: "EBADF" });
  });
}

test("canonical device open walks paths and preserves fixed-namespace acquisition errors", async context => {
  const fs: FileSystem = createDeviceFileSystem();
  assert.equal(typeof fs.open, "function", "device provider must expose canonical FileSystem.open");
  for (const path of ["/missing", "/missing/../null", "/dev/null"]) {
    await assert.rejects(fs.open!(path, { access: "read" }), { code: "ENOENT", path });
  }
  for (const path of ["/null/", "/null/.", "/zero/../null"]) {
    await assert.rejects(fs.open!(path, { access: "read" }), { code: "ENOTDIR", path });
  }
  await assert.rejects(fs.open!("/", { access: "read" }), { code: "EISDIR" });
  await assert.rejects(fs.open!("/null\0", { access: "read" }), { code: "EINVAL" });
  await assert.rejects(fs.open!("/null", { access: "write", creation: "exclusive" }), { code: "EEXIST" });
  const alias = await acquire(context, fs, "/./null", { access: "read" });
  assert.deepEqual(await alias.stat(), await fs.stat("/null"));
});

test("canonical devices compose through the public mount without changing the memory root", async context => {
  const root = createMemoryFileSystem();
  const fs = createMountFileSystem({ root, mounts: { "/dev": createDeviceFileSystem() } });
  const descriptor = await acquire(context, fs, "/dev/zero", { access: "read" });
  assert.equal((await fs.capabilitiesFor!("/dev/zero")).open, true);
  assert.equal(descriptor.capabilities.readObservation, true);
  assert.equal(await descriptor.probeRead!(), "ready");
  assert.equal(await descriptor.read(new Uint8Array(3), 7), 3);
  assert.equal(await descriptor.getPosition!(), 0);
  assert.equal((await descriptor.stat()).type, "character");
  await assert.rejects(root.stat("/dev/zero"), { code: "ENOENT" });
});

for (const name of ["random", "urandom"]) {
  test(`canonical ${name} fills only caller-owned returned bytes using bounded Web Crypto calls`, async context => {
    const lengths: number[] = [];
    context.mock.method(globalThis.crypto, "getRandomValues", (bytes: Uint8Array) => {
      lengths.push(bytes.byteLength);
      bytes.fill(0x5a);
      return bytes;
    });
    const descriptor = await acquire(context, createDeviceFileSystem(), `/${name}`, { access: "read" });
    await descriptor.probeRead!();
    assert.deepEqual(lengths, []);
    const bytes = new Uint8Array(65545).fill(0xa5);
    const count = await descriptor.read(bytes.subarray(2, -2), null);
    assert.ok(count > 0 && count <= bytes.length - 4);
    assert.ok(lengths.length > 0 && lengths.every(length => length > 0 && length <= 65536));
    assert.deepEqual(bytes.subarray(2, 2 + count), new Uint8Array(count).fill(0x5a));
    assert.deepEqual(bytes.subarray(0, 2), Uint8Array.of(0xa5, 0xa5));
    assert.deepEqual(bytes.subarray(2 + count), new Uint8Array(bytes.length - 2 - count).fill(0xa5));
    assert.equal(await descriptor.getPosition!(), count);
  });
}

test("canonical random failures retain provider cause without advancing the retained cursor", async context => {
  const failure = new Error("controlled crypto failure");
  context.mock.method(globalThis.crypto, "getRandomValues", () => { throw failure; });
  const descriptor = await acquire(context, createDeviceFileSystem(), "/random", { access: "read" });
  await assert.rejects(descriptor.read(new Uint8Array(1), null), error => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, "EIO");
    assert.equal(error.cause, failure);
    return true;
  });
  assert.equal(await descriptor.getPosition!(), 0);
});

for (const reason of [false, 0]) {
  test(`canonical device acquisition and operations preserve falsey cancellation ${String(reason)}`, async context => {
    const fs: FileSystem = createDeviceFileSystem();
    const descriptor = await acquire(context, fs, "/zero", { access: "readwrite" });
    const controller = new AbortController();
    controller.abort(reason);
    const rejected = (error: unknown): boolean => { assert.equal(error, reason); return true; };
    await assert.rejects(fs.open!("/zero", { access: "read", signal: controller.signal }), rejected);
    await assert.rejects(descriptor.read(new Uint8Array(1), null, { signal: controller.signal }), rejected);
    await assert.rejects(descriptor.write(Uint8Array.of(1), null, { signal: controller.signal }), rejected);
    await assert.rejects(descriptor.probeRead!({ signal: controller.signal }), rejected);
    await assert.rejects(descriptor.getPosition!({ signal: controller.signal }), rejected);
    assert.equal(await descriptor.getPosition!(), 0);
  });
}
