import assert from "node:assert/strict";
import { test, vi } from "vitest";
import * as memory from "../src/fs/memory/index.js";
import { FsError } from "../src/contracts/errors.js";
import type { FileSystemFactory } from "../src/contracts/filesystem.js";
import { MountFileSystem } from "../src/fs/mount/index.js";

const bytes = (length: number, value = 1): Uint8Array => new Uint8Array(length).fill(value);
const code = (expected: string) => (error: unknown): boolean => error instanceof FsError && error.code === expected;

function storage(filesystem: memory.MemoryFileSystem, name: string): Uint8Array {
  const root = Reflect.get(filesystem, "root") as { entries: Map<string, { data: Uint8Array }> };
  return root.entries.get(name)!.data;
}

test("Memory defaults are finite, frozen, and shared by constructor and factory", () => {
  assert.deepEqual(memory.defaultMemoryFileSystemLimits, {
    maxFileBytes: 16 * 1024 * 1024, maxRetainedBytes: 64 * 1024 * 1024, maxMetadataUnits: 10_000,
  });
  assert.ok(Object.isFrozen(memory.defaultMemoryFileSystemLimits));
  for (const filesystem of [new memory.MemoryFileSystem(), memory.createMemoryFileSystem()]) {
    const ledger = Reflect.get(filesystem, "ledger") as { limits: memory.MemoryFileSystemLimits };
    assert.deepEqual(ledger.limits, memory.defaultMemoryFileSystemLimits);
    assert.ok(Object.isFrozen(ledger.limits));
  }
});

test("constructor and factory enforce snapshotted options", async () => {
  for (const create of [(options: memory.MemoryFileSystemOptions) => new memory.MemoryFileSystem(options), memory.createMemoryFileSystem]) {
    const options = { maxFileBytes: 2, maxRetainedBytes: 32, maxMetadataUnits: 3 };
    const filesystem = create(options);
    options.maxFileBytes = 20;
    options.maxMetadataUnits = 20;
    await assert.rejects(filesystem.writeFile("/f", bytes(3)), code("EFBIG"));
    assert.deepEqual(await filesystem.readdir("/"), []);
    await filesystem.writeFile("/f", bytes(2));
    await assert.rejects(filesystem.mkdir("/d"), code("ENOSPC"));
  }
});

test("provided invalid options and accessors are rejected without getter invocation", () => {
  for (const key of ["maxFileBytes", "maxRetainedBytes", "maxMetadataUnits"]) {
    for (const value of [undefined, null, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => Reflect.construct(memory.MemoryFileSystem, [{ [key]: value }]), RangeError);
    }
  }
  assert.throws(() => new memory.MemoryFileSystem({ maxMetadataUnits: 0 }), RangeError);
  assert.throws(() => Reflect.construct(memory.MemoryFileSystem, [{ unknown: 1 }]), TypeError);
  let calls = 0;
  assert.throws(() => new memory.MemoryFileSystem(Object.defineProperty({}, "maxFileBytes", {
    get() { calls++; return 1; },
  })), TypeError);
  assert.equal(calls, 0);
});

test("root consumes one metadata unit; zero-byte and root-only stores are valid", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxRetainedBytes: 0, maxMetadataUnits: 1, maxFileBytes: 0 });
  assert.equal((await filesystem.stat("/")).type, "directory");
  for (const operation of [() => filesystem.mkdir("/d"), () => filesystem.writeFile("/f", bytes(0)), () => filesystem.symlink("f", "/s")]) {
    await assert.rejects(operation(), code("ENOSPC"));
  }
  assert.deepEqual(await filesystem.readdir("/"), []);
});

test("hardlinks charge names, not duplicate inodes or data", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxRetainedBytes: 8, maxMetadataUnits: 4 });
  await filesystem.writeFile("/f", bytes(4));
  await filesystem.link("/f", "/g");
  assert.equal((await filesystem.stat("/f")).ino, (await filesystem.stat("/g")).ino);
  await assert.rejects(filesystem.link("/f", "/h"), code("ENOSPC"));
  await filesystem.rm("/f");
  await filesystem.link("/g", "/h");
  await filesystem.rm("/g");
  await filesystem.rm("/h");
  await filesystem.writeFile("/f", bytes(6));
  await assert.rejects(filesystem.writeFile("/g", bytes(0)), code("ENOSPC"));
});

test("names and symlink targets use two bytes per UTF-16 code unit", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxRetainedBytes: 8, maxMetadataUnits: 4 });
  await filesystem.symlink("🙂", "/é");
  await filesystem.link("/é", "/x");
  assert.equal(await filesystem.readlink("/x"), "🙂");
  await assert.rejects(filesystem.mkdir("/d"), code("ENOSPC"));
  await filesystem.rm("/é");
  await filesystem.rm("/x");
  await filesystem.mkdir("/four");
  await assert.rejects(filesystem.writeFile("/f", bytes(0)), code("ENOSPC"));
});

test("per-file refusal precedes write, append and truncate effects", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxFileBytes: 2 });
  await assert.rejects(filesystem.writeFile("/absent", bytes(3)), code("EFBIG"));
  assert.deepEqual(await filesystem.readdir("/"), []);
  await filesystem.writeFile("/f", bytes(2, 7));
  await assert.rejects(filesystem.appendFile("/f", bytes(1)), code("EFBIG"));
  await assert.rejects(filesystem.writeFile("/f", bytes(1), { flag: "a" }), code("EFBIG"));
  await assert.rejects(filesystem.truncate("/f", 3), code("EFBIG"));
  assert.deepEqual(await filesystem.readFile("/f"), bytes(2, 7));
});

test("replacement and copy reserve before allocation and preserve old destinations on refusal", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxRetainedBytes: 8 });
  await filesystem.writeFile("/f", bytes(4, 7));
  await assert.rejects(filesystem.writeFile("/f", bytes(4, 8)), code("ENOSPC"));
  await assert.rejects(filesystem.copyFile("/f", "/g"), code("ENOSPC"));
  assert.deepEqual((await filesystem.readdir("/")).map(entry => entry.name), ["f"]);
  assert.deepEqual(await filesystem.readFile("/f"), bytes(4, 7));
  await filesystem.truncate("/f", 0);
  await filesystem.writeFile("/f", bytes(6));
});

test("backing capacity is charged instead of logical file length", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxRetainedBytes: 100, maxFileBytes: 128 });
  await filesystem.appendFile("/f", bytes(1));
  assert.equal(storage(filesystem, "f").buffer.byteLength, 64);
  await filesystem.mkdir("/abcdefghijklmnopq");
  await assert.rejects(filesystem.writeFile("/g", bytes(0)), code("ENOSPC"));
  await filesystem.rm("/f");
  await filesystem.writeFile("/g", bytes(4));
});

test("geometric growth is clamped to file and retained limits without repeated copying", async () => {
  const small = new memory.MemoryFileSystem({ maxFileBytes: 4, maxRetainedBytes: 10 });
  await small.appendFile("/f", bytes(1));
  await small.appendFile("/f", bytes(2));
  await small.appendFile("/f", bytes(1));
  assert.equal((await small.stat("/f")).size, 4);
  assert.ok(storage(small, "f").buffer.byteLength <= 4);
  const filesystem = new memory.MemoryFileSystem({ maxFileBytes: 128, maxRetainedBytes: 1024 });
  const allocations = new Set<ArrayBufferLike>();
  for (let index = 0; index < 96; index++) {
    await filesystem.appendFile("/f", bytes(1));
    allocations.add(storage(filesystem, "f").buffer);
  }
  assert.equal((await filesystem.stat("/f")).size, 96);
  assert.ok(allocations.size <= 3);
});

test("recursive mkdir admits a bounded prefix and recursive removal refunds names and inodes", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxMetadataUnits: 5 });
  await assert.rejects(filesystem.mkdir("/a/b/c", { recursive: true }), code("ENOSPC"));
  assert.equal((await filesystem.stat("/a/b")).type, "directory");
  await assert.rejects(filesystem.stat("/a/b/c"), code("ENOENT"));
  await filesystem.rm("/a", { recursive: true });
  await filesystem.writeFile("/f", bytes(0));
  await filesystem.writeFile("/g", bytes(0));
  await assert.rejects(filesystem.mkdir("/d"), code("ENOSPC"));
});

test("rename reserves only positive name growth and refunds replaced entries", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxRetainedBytes: 6, maxMetadataUnits: 3 });
  await filesystem.writeFile("/ab", bytes(2));
  await filesystem.rename("/ab", "/cd");
  await assert.rejects(filesystem.rename("/cd", "/long"), code("ENOSPC"));
  await filesystem.rename("/cd", "/f");
  assert.deepEqual(await filesystem.readFile("/f"), bytes(2));
  const replacement = new memory.MemoryFileSystem({ maxMetadataUnits: 5 });
  await replacement.writeFile("/f", bytes(1, 7));
  await replacement.writeFile("/g", bytes(1, 8));
  await replacement.rename("/f", "/g");
  await replacement.mkdir("/d");
  assert.deepEqual(await replacement.readFile("/g"), bytes(1, 7));
});

test("unlinked read handles retain inode, buffer and path charges until idempotent close", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxRetainedBytes: 12, maxMetadataUnits: 6 });
  await filesystem.writeFile("/f", bytes(2, 7));
  const handle = await filesystem.openReadFile("/f");
  await filesystem.rm("/f");
  assert.equal((await handle.stat()).nlink, 0);
  assert.deepEqual(await handle.read(0, 2), bytes(2, 7));
  await assert.rejects(filesystem.writeFile("/g", bytes(5)), code("ENOSPC"));
  await handle.close();
  await handle.close();
  await filesystem.writeFile("/g", bytes(5));
  await assert.rejects(filesystem.writeFile("/h", bytes(5)), code("ENOSPC"));
});

test("active read streams retain old generations through overwrite", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxRetainedBytes: 20 });
  await filesystem.writeFile("/f", bytes(4, 7));
  const reader = filesystem.readStream("/f", { chunkSize: 1 })[Symbol.asyncIterator]();
  assert.deepEqual((await reader.next()).value, bytes(1, 7));
  await filesystem.writeFile("/f", bytes(4, 8));
  assert.deepEqual((await reader.next()).value, bytes(1, 7));
  await assert.rejects(filesystem.writeFile("/g", bytes(5)), code("ENOSPC"));
  assert.ok(reader.return);
  await reader.return();
  await filesystem.writeFile("/g", bytes(5));
  assert.deepEqual(await filesystem.readFile("/f"), bytes(4, 8));
});

test("read handles observe replacement data without retaining obsolete generations", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxRetainedBytes: 14 });
  await filesystem.writeFile("/f", bytes(4, 7));
  const handle = await filesystem.openReadFile("/f");
  await filesystem.writeFile("/f", bytes(4, 8));
  assert.deepEqual(await handle.read(0, 4), bytes(4, 8));
  await filesystem.writeFile("/g", bytes(2));
  await handle.close();
});

test("stream quota failure preserves accepted chunks and releases its reservation", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxFileBytes: 4, maxRetainedBytes: 10, maxMetadataUnits: 4 });
  let closed = false;
  await assert.rejects(filesystem.writeStream("/f", (async function* () {
    try { yield bytes(2, 7); yield bytes(3, 8); } finally { closed = true; }
  })()), code("EFBIG"));
  assert.ok(closed);
  assert.deepEqual(await filesystem.readFile("/f"), bytes(2, 7));
  await filesystem.link("/f", "/g");
});

test("active unlinked writes retain ownership until completion", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxMetadataUnits: 4 });
  let resume!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const writing = filesystem.writeStream("/f", (async function* () {
    yield bytes(1);
    entered();
    await gate;
    yield bytes(1);
  })());
  await ready;
  try {
    await filesystem.rm("/f");
    await assert.rejects(filesystem.writeFile("/g", bytes(0)), code("ENOSPC"));
  } finally { resume(); await writing; }
  await filesystem.writeFile("/g", bytes(0));
});

test("aborted readers and failed writers release active reservations and preserve reasons", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxMetadataUnits: 4 });
  await filesystem.writeFile("/f", bytes(2));
  const controller = new AbortController();
  const reader = filesystem.readStream("/f", { chunkSize: 1, signal: controller.signal })[Symbol.asyncIterator]();
  await reader.next();
  controller.abort(null);
  await assert.rejects(reader.next(), reason => reason === null);
  await assert.rejects(filesystem.writeStream("/f", (async function* () {
    yield bytes(1);
    throw false;
  })()), reason => reason === false);
  await filesystem.link("/f", "/g");
});

test("caller-owned reads and stat observations do not delay known ownership release", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxRetainedBytes: 6, maxMetadataUnits: 3 });
  await filesystem.writeFile("/f", bytes(4, 7));
  const observation = await filesystem.stat("/f");
  const output = await filesystem.readFile("/f");
  await filesystem.rm("/f");
  await filesystem.writeFile("/g", bytes(4, 8));
  assert.equal(observation.size, 4);
  assert.deepEqual(output, bytes(4, 7));
});

test("factory remains a validated generic filesystem factory without dropping options", async () => {
  const create: FileSystemFactory = memory.createMemoryFileSystem;
  const filesystem = await create({ maxFileBytes: 2 });
  await assert.rejects(filesystem.writeFile("/f", bytes(3)), code("EFBIG"));
  assert.throws(() => create({ maxFileBytes: undefined }), RangeError);
});

test("failed native growth refunds reservations without publishing a file or changing its parent", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(100);
  const filesystem = new memory.MemoryFileSystem({ maxRetainedBytes: 8, maxMetadataUnits: 3 });
  const internal = filesystem as unknown as { allocate(length: number, syscall: string, path: string): unknown };
  const allocate = internal.allocate.bind(filesystem);
  const allocations = vi.spyOn(internal, "allocate")
    .mockImplementationOnce(allocate)
    .mockImplementationOnce(() => { throw new FsError("EFBIG"); });
  try {
    clock.mockReturnValue(200);
    await assert.rejects(filesystem.appendFile("/f", bytes(1)), code("EFBIG"));
    assert.deepEqual(await filesystem.readdir("/"), []);
    assert.equal((await filesystem.stat("/")).mtimeMs, 100);
  } finally { allocations.mockRestore(); clock.mockRestore(); }
  await filesystem.writeFile("/f", bytes(6));
});

test("multiple handles consume distinct units and close refunds only once", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxMetadataUnits: 5 });
  await filesystem.writeFile("/f", bytes(1));
  const first = await filesystem.openReadFile("/f");
  const second = await filesystem.openReadFile("/f");
  await assert.rejects(filesystem.openReadFile("/f"), code("ENOSPC"));
  await first.close();
  await first.close();
  const third = await filesystem.openReadFile("/f");
  await assert.rejects(filesystem.openReadFile("/f"), code("ENOSPC"));
  await filesystem.rm("/f");
  await second.close();
  await third.close();
  await filesystem.writeFile("/g", bytes(0));
  await filesystem.mkdir("/d");
});

test("reader exhaustion releases its unit while a failed handle read does not close the handle", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxMetadataUnits: 4 });
  await filesystem.writeFile("/f", bytes(2));
  for await (const chunk of filesystem.readStream("/f", { chunkSize: 1 })) assert.equal(chunk.byteLength, 1);
  const handle = await filesystem.openReadFile("/f");
  await assert.rejects(handle.read(-1, 1), code("EINVAL"));
  await assert.rejects(filesystem.link("/f", "/g"), code("ENOSPC"));
  await handle.close();
  await filesystem.link("/f", "/g");
});

test("copy refusal preserves an existing destination and deletion frees its charge", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxRetainedBytes: 14 });
  await filesystem.writeFile("/f", bytes(4, 7));
  await filesystem.writeFile("/g", bytes(4, 8));
  await assert.rejects(filesystem.copyFile("/f", "/g"), code("ENOSPC"));
  assert.deepEqual(await filesystem.readFile("/g"), bytes(4, 8));
  await filesystem.rm("/f");
  await filesystem.copyFile("/g", "/f");
  assert.deepEqual(await filesystem.readFile("/f"), bytes(4, 8));
});

test("failed unlinked streams release both their hidden inode and active storage", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxRetainedBytes: 8, maxMetadataUnits: 4 });
  await assert.rejects(filesystem.writeStream("/f", (async function* () {
    yield bytes(1);
    await filesystem.rm("/f");
    throw null;
  })()), reason => reason === null);
  await filesystem.writeFile("/g", bytes(6));
});

test("growth preserves and charges the allocation held by an existing read stream", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxFileBytes: 8, maxRetainedBytes: 20 });
  await filesystem.writeFile("/f", bytes(4, 7));
  const reader = filesystem.readStream("/f", { chunkSize: 1 })[Symbol.asyncIterator]();
  await reader.next();
  await filesystem.appendFile("/f", bytes(1, 8));
  assert.deepEqual((await reader.next()).value, bytes(1, 7));
  await assert.rejects(filesystem.writeFile("/g", bytes(1)), code("ENOSPC"));
  assert.ok(reader.return);
  await reader.return();
  await filesystem.writeFile("/g", bytes(1));
});

test("mount aliases share the native ledger instead of resetting capacity", async () => {
  const backing = new memory.MemoryFileSystem({ maxRetainedBytes: 8, maxMetadataUnits: 4 });
  const mounted = new MountFileSystem({
    root: new memory.MemoryFileSystem(), mounts: { "/left": backing, "/right": backing },
  });
  await mounted.writeFile("/left/f", bytes(4, 7));
  await mounted.link("/left/f", "/left/g");
  await assert.rejects(mounted.writeFile("/right/h", bytes(0)), code("ENOSPC"));
  assert.deepEqual(await mounted.readFile("/right/g"), bytes(4, 7));
  await mounted.rm("/left/f");
  await mounted.rm("/right/g");
  await mounted.writeFile("/right/h", bytes(6));
});

test("rename replacement retains an open destination until its final close", async () => {
  const filesystem = new memory.MemoryFileSystem({ maxRetainedBytes: 12, maxMetadataUnits: 6 });
  await filesystem.writeFile("/f", bytes(2, 7));
  await filesystem.writeFile("/g", bytes(2, 8));
  const previous = await filesystem.openReadFile("/g");
  await filesystem.rename("/f", "/g");
  assert.deepEqual(await previous.read(0, 2), bytes(2, 8));
  assert.deepEqual(await filesystem.readFile("/g"), bytes(2, 7));
  await assert.rejects(filesystem.writeFile("/h", bytes(1)), code("ENOSPC"));
  await previous.close();
  await filesystem.writeFile("/h", bytes(6));
});

for (const reason of [null, false, 0, ""]) {
  test(`pre-abort ${JSON.stringify(reason)} precedes quota admission and source acquisition`, async () => {
    const filesystem = new memory.MemoryFileSystem({ maxMetadataUnits: 3 });
    const controller = new AbortController();
    controller.abort(reason);
    let pulled = false;
    await assert.rejects(filesystem.writeStream("/f", (async function* () {
      pulled = true;
      yield bytes(1);
    })(), { signal: controller.signal }), error => error === reason);
    assert.equal(pulled, false);
    assert.deepEqual(await filesystem.readdir("/"), []);
    await filesystem.writeFile("/f", bytes(0));
    await assert.rejects(filesystem.openReadFile("/f", { signal: controller.signal }), error => error === reason);
  });
}
