import assert from "node:assert/strict";
import test from "node:test";
import { ACCESS_MODES, collectBytes, FsError } from "../../../src/contracts/index.js";
import type {
  ByteSource, DirectoryEntry, FileStat, FileSystem, FsOptions, WriteFileOptions,
} from "../../../src/contracts/index.js";
import { createReadOnlyFileSystem, ReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { createFixture } from "./fixture.js";

function fsError(code: "EROFS" | "ENOTSUP" | "EINVAL", syscall: string, path: string, dest?: string) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof FsError);
    assert.equal(error.name, "FsError");
    assert.equal(error.code, code);
    assert.equal(error.syscall, syscall);
    assert.equal(error.path, path);
    assert.equal(error.dest, dest);
    assert.ok(Number.isInteger(error.errno) && error.errno < 0);
    assert.ok(error.message.startsWith(`${code}:`));
    return true;
  };
}

const path = "relative/../file";
const destination = "other/../destination";
const bytes = new Uint8Array([0, 255, 42]);
const neverRead: ByteSource = {
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    assert.fail("writeStream must not acquire the iterator");
  },
};
const mutations: {
  name: string;
  destination?: string;
  invoke: (filesystem: ReadOnlyFileSystem, options: FsOptions) => Promise<void>;
}[] = [
  { name: "writeFile", invoke: (filesystem, options) => filesystem.writeFile(path, bytes, options) },
  { name: "appendFile", invoke: (filesystem, options) => filesystem.appendFile(path, bytes, options) },
  { name: "writeStream", invoke: (filesystem, options) => filesystem.writeStream(path, neverRead, options) },
  { name: "mkdir", invoke: (filesystem, options) => filesystem.mkdir(path, { ...options, recursive: true }) },
  { name: "rm", invoke: (filesystem, options) => filesystem.rm(path, { ...options, recursive: true, force: true }) },
  { name: "unlink", invoke: (filesystem, options) => filesystem.unlink(path, options) },
  { name: "rmdir", invoke: (filesystem, options) => filesystem.rmdir(path, options) },
  { name: "rename", destination, invoke: (filesystem, options) => filesystem.rename(path, destination, options) },
  { name: "copyFile", destination, invoke: (filesystem, options) => filesystem.copyFile(path, destination, { ...options, exclusive: true }) },
  { name: "symlink", destination, invoke: (filesystem, options) => filesystem.symlink(path, destination, options) },
  { name: "link", destination, invoke: (filesystem, options) => filesystem.link(path, destination, options) },
  { name: "chmod", invoke: (filesystem, options) => filesystem.chmod(path, 0o777, options) },
  { name: "utimes", invoke: (filesystem, options) => filesystem.utimes(path, 1, 2, options) },
  { name: "truncate", invoke: (filesystem, options) => filesystem.truncate(path, 0, options) },
];

test("class and synchronous factory satisfy FileSystem and compose", async () => {
  const fixture = createFixture();
  const inner = createReadOnlyFileSystem(fixture.filesystem);
  const outer = new ReadOnlyFileSystem(inner);
  const contract: FileSystem = outer;
  assert.ok(inner instanceof ReadOnlyFileSystem);
  assert.deepEqual(await contract.readFile(path), new Uint8Array(fixture.state.bytes));
  assert.deepEqual(outer.capabilities, inner.capabilities);
  await assert.rejects(contract.writeFile(path, bytes), fsError("EROFS", "writeFile", path));
  assert.deepEqual(fixture.calls.map((call) => call.method), ["readFile"]);
});

for (const optional of [false, true]) {
  for (const mutation of mutations) {
    test(`${mutation.name} rejects without delegation; optional methods ${optional ? "present" : "absent"}`, async () => {
      const fixture = createFixture(optional);
      const filesystem = createReadOnlyFileSystem(fixture.filesystem);
      for (const options of [{}, { signal: AbortSignal.abort(new Error("already canceled")) }]) {
        let result: Promise<void> | undefined;
        assert.doesNotThrow(() => { result = mutation.invoke(filesystem, options); });
        assert.ok(result instanceof Promise);
        await assert.rejects(result, fsError("EROFS", mutation.name, path, mutation.destination));
      }
      assert.deepEqual(fixture.calls, []);
      assert.deepEqual(fixture.state.bytes, Buffer.from([0, 255, 42, 128]));
    });
  }
}

for (const flag of [undefined, "w", "wx", "a", "ax", "r", "r+", "w+", "a+", "as", "", "invalid", 0, 1, 2, 64, null]) {
  test(`all write APIs deny adversarial flag ${JSON.stringify(flag)}`, async () => {
    const fixture = createFixture();
    const filesystem = createReadOnlyFileSystem(fixture.filesystem);
    const options = { flag } as unknown as WriteFileOptions;
    await assert.rejects(filesystem.writeFile(path, bytes, options), fsError("EROFS", "writeFile", path));
    await assert.rejects(filesystem.writeStream(path, neverRead, options), fsError("EROFS", "writeStream", path));
    assert.deepEqual(fixture.calls, []);
  });
}

test("mutation policy ignores poisoned options, source getters, and optional delegate getters", async () => {
  const fixture = createFixture(false);
  const filesystem = createReadOnlyFileSystem(fixture.filesystem);
  const options = new Proxy({}, { get() { assert.fail("mutation options must not be inspected"); } });
  for (const mutation of mutations) {
    if (["mkdir", "rm", "rmdir", "copyFile"].includes(mutation.name)) continue;
    await assert.rejects(mutation.invoke(filesystem, options), fsError("EROFS", mutation.name, path, mutation.destination));
  }
  const source = new Proxy({} as ByteSource, { get() { assert.fail("source must not be inspected"); } });
  Object.defineProperty(fixture.filesystem, "writeStream", { get() { assert.fail("delegate writer must not be inspected"); } });
  await assert.rejects(filesystem.writeStream(path, source, options), fsError("EROFS", "writeStream", path));
  assert.deepEqual(fixture.calls, []);
});

test("writeStream never starts or closes an async generator", async () => {
  const filesystem = createReadOnlyFileSystem(createFixture().filesystem);
  let started = 0;
  let closed = 0;
  async function* source(): ByteSource {
    started++;
    try { yield bytes; } finally { closed++; }
  }
  const iterable = source();
  await assert.rejects(filesystem.writeStream(path, iterable), fsError("EROFS", "writeStream", path));
  assert.equal(started, 0);
  assert.equal(closed, 0);
  assert.deepEqual(await collectBytes(iterable, { maxBytes: 3 }), bytes);
  assert.equal(started, 1);
  assert.equal(closed, 1);
});

test("empty writes, missing and invalid paths, and self-copies remain denied", async () => {
  const fixture = createFixture();
  const filesystem = createReadOnlyFileSystem(fixture.filesystem);
  for (const invalidPath of ["", "/missing", "\0", "/", "../../escape"]) {
    await assert.rejects(filesystem.writeFile(invalidPath, new Uint8Array()), fsError("EROFS", "writeFile", invalidPath));
    await assert.rejects(filesystem.appendFile(invalidPath, new Uint8Array()), fsError("EROFS", "appendFile", invalidPath));
    await assert.rejects(filesystem.copyFile(invalidPath, invalidPath), fsError("EROFS", "copyFile", invalidPath, invalidPath));
    await assert.rejects(filesystem.rename(invalidPath, invalidPath), fsError("EROFS", "rename", invalidPath, invalidPath));
    await assert.rejects(filesystem.truncate(invalidPath), fsError("EROFS", "truncate", invalidPath));
  }
  assert.deepEqual(fixture.calls, []);
});

test("reads preserve exact paths, option identity, limits, receiver, and results", async () => {
  const fixture = createFixture();
  const filesystem = createReadOnlyFileSystem(fixture.filesystem);
  const options = { signal: new AbortController().signal, maxBytes: 19 };
  assert.deepEqual(await filesystem.readFile(path, options), new Uint8Array(fixture.state.bytes));
  assert.deepEqual(await filesystem.stat(path, options), fixture.state.stat);
  assert.deepEqual(await filesystem.lstat(path, options), fixture.state.lstat);
  assert.deepEqual(await filesystem.readdir(path, options), fixture.state.entries);
  assert.equal(await filesystem.realpath(path, options), "/resolved/file");
  assert.equal(await filesystem.readlink(path, options), "../file");
  for (const call of fixture.calls) {
    assert.equal(call.args[0], path);
    assert.equal(call.args[1], options);
  }
  assert.deepEqual(fixture.calls.map((call) => call.method), ["readFile", "stat", "lstat", "readdir", "realpath", "readlink"]);
});

test("readFile returns owned Uint8Array storage even for Buffer subviews", async () => {
  const fixture = createFixture();
  fixture.state.bytes = Buffer.from([1, 2, 3, 4]).subarray(1, 3);
  const filesystem = createReadOnlyFileSystem(fixture.filesystem);
  const first = await filesystem.readFile(path);
  const second = await filesystem.readFile(path);
  assert.equal(Buffer.isBuffer(first), false);
  assert.deepEqual(first, new Uint8Array([2, 3]));
  first.fill(99);
  assert.deepEqual(second, new Uint8Array([2, 3]));
  assert.deepEqual(fixture.state.bytes, Buffer.from([2, 3]));
  fixture.state.bytes.fill(11);
  assert.deepEqual(second, new Uint8Array([2, 3]));
  assert.deepEqual(await filesystem.readFile(path), new Uint8Array([11, 11]));
});

test("stat, lstat, and directory entries cannot mutate delegate metadata", async () => {
  const fixture = createFixture();
  const filesystem = createReadOnlyFileSystem(fixture.filesystem);
  const stat = await filesystem.stat(path) as { -readonly [Key in keyof FileStat]: FileStat[Key] };
  const lstat = await filesystem.lstat(path) as { -readonly [Key in keyof FileStat]: FileStat[Key] };
  const entries = await filesystem.readdir(path);
  stat.mode = 0;
  lstat.type = "directory";
  (entries[0] as { -readonly [Key in keyof DirectoryEntry]: DirectoryEntry[Key] }).name = "changed";
  entries.pop();
  assert.equal(fixture.state.stat.mode, 0o100777);
  assert.equal(fixture.state.lstat.type, "symlink");
  assert.equal(fixture.state.entries[0]?.name, "file");
  assert.equal(fixture.state.entries.length, 2);
});

for (const mode of [0, 1, 4, 5]) {
  test(`access mode ${mode} delegates unchanged`, async () => {
    const fixture = createFixture();
    const filesystem = createReadOnlyFileSystem(fixture.filesystem);
    const options = { signal: new AbortController().signal };
    await filesystem.access(path, mode, options);
    assert.deepEqual(fixture.calls, [{ method: "access", args: [path, mode, options] }]);
    assert.equal(fixture.calls[0]?.args[2], options);
  });
}

test("access defaults to F_OK and denies every W_OK combination before delegation", async () => {
  const fixture = createFixture();
  const filesystem = createReadOnlyFileSystem(fixture.filesystem);
  await filesystem.access(path);
  assert.deepEqual(fixture.calls, [{ method: "access", args: [path, ACCESS_MODES.F_OK, undefined] }]);
  fixture.calls.length = 0;
  for (const mode of [2, 3, 6, 7]) {
    for (const options of [{}, { signal: AbortSignal.abort("canceled") }]) {
      await assert.rejects(filesystem.access(path, mode, options), fsError("EROFS", "access", path));
    }
  }
  for (const mode of [-1, 8, 0.5, NaN, Infinity, 2 ** 32]) {
    await assert.rejects(filesystem.access(path, mode), fsError("EINVAL", "access", path));
  }
  assert.deepEqual(fixture.calls, []);
});

test("underlying read errors including arbitrary abort reasons retain their identity", async () => {
  const fixture = createFixture();
  const filesystem = createReadOnlyFileSystem(fixture.filesystem);
  const readers = [
    () => filesystem.readFile(path), () => filesystem.stat(path), () => filesystem.lstat(path),
    () => filesystem.readdir(path), () => filesystem.realpath(path), () => filesystem.readlink(path),
    () => filesystem.access(path), () => collectBytes(filesystem.readStream(path), { maxBytes: 16 }),
  ];
  for (const error of [new FsError("ENOENT", { syscall: "delegate", path: "/other" }), new Error("transport"), "canceled"]) {
    fixture.state.failure = error;
    for (const read of readers) await assert.rejects(read(), (actual: unknown) => actual === error);
  }
});

test("supported reads preserve cancellation identity without starting pre-aborted streams", async () => {
  const fixture = createFixture();
  const filesystem = createReadOnlyFileSystem(fixture.filesystem);
  const reason = new Error("delegate cancellation");
  const options = { signal: AbortSignal.abort(reason) };
  const readers = [
    () => filesystem.readFile(path, options), () => filesystem.stat(path, options),
    () => filesystem.lstat(path, options), () => filesystem.readdir(path, options),
    () => filesystem.realpath(path, options), () => filesystem.readlink(path, options),
    () => filesystem.access(path, ACCESS_MODES.R_OK, options),
    () => collectBytes(filesystem.readStream(path, options), { maxBytes: 16 }),
  ];
  for (const read of readers) await assert.rejects(read(), (error: unknown) => error === reason);
  assert.equal(fixture.calls.length, readers.length - 1);
});

test("missing optional reads reject with ENOTSUP, including pre-aborted requests", async () => {
  const fixture = createFixture(false);
  const filesystem = createReadOnlyFileSystem(fixture.filesystem);
  for (const options of [{}, { signal: AbortSignal.abort("canceled") }]) {
    await assert.rejects(filesystem.readlink(path, options), fsError("ENOTSUP", "readlink", path));
    let stream: ByteSource | undefined;
    assert.doesNotThrow(() => { stream = filesystem.readStream(path, options); });
    assert.ok(stream);
    const iterator = stream[Symbol.asyncIterator]();
    await assert.rejects(iterator.next(), fsError("ENOTSUP", "readStream", path));
    assert.deepEqual(await iterator.next(), { done: true, value: undefined });
  }
  assert.deepEqual(fixture.calls, []);
});

test("readStream is lazy, preserves options, copies reused chunks, and closes on return", async () => {
  const fixture = createFixture();
  const filesystem = createReadOnlyFileSystem(fixture.filesystem);
  const options = { signal: new AbortController().signal, start: 1, endExclusive: 4, chunkSize: 2 };
  const stream = filesystem.readStream(path, options);
  assert.equal(fixture.calls.length, 0);
  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.equal(first.done, false);
  assert.equal(Buffer.isBuffer(first.value), false);
  first.value.fill(17);
  assert.deepEqual(fixture.state.bytes, Buffer.from([0, 255, 42, 128]));
  fixture.state.bytes.fill(3);
  const second = await iterator.next();
  assert.deepEqual(first.value, new Uint8Array([17, 17, 17, 17]));
  assert.deepEqual(second.value, new Uint8Array([3, 3, 3, 3]));
  assert.equal(fixture.calls[0]?.args[1], options);
  await iterator.return?.();
  assert.equal(fixture.state.streamClosed, 1);
});

test("readStream closes the delegate when the consumer stops or cancellation arrives", async () => {
  const fixture = createFixture();
  const filesystem = createReadOnlyFileSystem(fixture.filesystem);
  for await (const chunk of filesystem.readStream(path)) {
    assert.deepEqual(chunk, new Uint8Array(fixture.state.bytes));
    break;
  }
  assert.equal(fixture.state.streamClosed, 1);
  const controller = new AbortController();
  const reason = new Error("mid-stream cancellation");
  const iterator = filesystem.readStream(path, { signal: controller.signal })[Symbol.asyncIterator]();
  await iterator.next();
  controller.abort(reason);
  await assert.rejects(iterator.next(), (error: unknown) => error === reason);
  assert.equal(fixture.state.streamClosed, 2);
});

test("readStream transfers synchronous method throws into next() rejection", async () => {
  const fixture = createFixture();
  const failure = new FsError("ENOTSUP", { syscall: "adapterStream", path });
  fixture.filesystem.readStream = () => { throw failure; };
  const filesystem = createReadOnlyFileSystem(fixture.filesystem);
  const iterator = filesystem.readStream(path)[Symbol.asyncIterator]();
  await assert.rejects(iterator.next(), (error: unknown) => error === failure);
});

for (const readlink of [false, true]) {
  for (const readStream of [false, true]) {
    for (const advertised of [undefined, false, true]) {
      test(`optional read capability permutation: link=${readlink}, stream=${readStream}, advertised=${advertised}`, async () => {
        const fixture = createFixture(true, advertised === undefined ? {} : { symlinks: advertised, streamingRead: advertised });
        if (!readlink) delete fixture.filesystem.readlink;
        if (!readStream) delete fixture.filesystem.readStream;
        const filesystem = createReadOnlyFileSystem(fixture.filesystem);
        assert.equal(filesystem.capabilities.symlinks, readlink && advertised === true);
        assert.equal(filesystem.capabilities.streamingRead, readStream ? advertised : false);
        if (readlink) assert.equal(await filesystem.readlink(path), "../file");
        else await assert.rejects(filesystem.readlink(path), fsError("ENOTSUP", "readlink", path));
        if (readStream) assert.equal((await collectBytes(filesystem.readStream(path), { maxBytes: 8 })).length, 8);
        else await assert.rejects(collectBytes(filesystem.readStream(path), { maxBytes: 8 }), fsError("ENOTSUP", "readStream", path));
      });
    }
  }
}

test("capabilities are immutable, detached, conservative, and omit unknown extensions", () => {
  const capabilities = {
    readOnly: false, append: true, symlinks: true, hardlinks: true, permissions: true, timestamps: true,
    atomicRename: true, streamingRead: true, streamingWrite: true, nativeExec: true, customWrites: true,
  };
  const fixture = createFixture(true, capabilities);
  const filesystem = createReadOnlyFileSystem(fixture.filesystem);
  assert.deepEqual(filesystem.capabilities, {
    readOnly: true, append: false, symlinks: true, hardlinks: false, permissions: false, timestamps: false,
    atomicRename: false, streamingRead: true, streamingWrite: false,
    write: false, exclusiveCreate: false, mkdir: false, recursiveMkdir: false,
    remove: false, removeDirectory: false, recursiveRemove: false, rename: false,
    copy: false, exclusiveCopy: false, truncate: false, streamingAppend: false, randomAccessWrite: false,
  });
  assert.ok(Object.isFrozen(filesystem.capabilities));
  assert.equal(Reflect.set(filesystem.capabilities, "readOnly", false), false);
  assert.equal(Reflect.set(filesystem, "capabilities", capabilities), false);
  assert.throws(() => Object.defineProperty(filesystem.capabilities, "streamingWrite", { value: true }), TypeError);
  capabilities.symlinks = false;
  capabilities.streamingRead = false;
  assert.equal(filesystem.capabilities.symlinks, true);
  assert.equal(filesystem.capabilities.streamingRead, true);
  assert.equal(filesystem.capabilities.readOnly, true);
});

test("no delegate references or unknown convenience/native execution APIs are exposed", () => {
  const fixture = createFixture();
  Object.assign(fixture.filesystem, {
    nativeExec() { assert.fail("native execution must not be exposed"); },
    writeTextFile() { assert.fail("convenience writes must not be exposed"); },
    open() { assert.fail("mutable handles must not be exposed"); },
  });
  const filesystem = createReadOnlyFileSystem(fixture.filesystem);
  assert.deepEqual(Reflect.ownKeys(filesystem), []);
  for (const key of ["filesystem", "delegate", "inner", "nativeExec", "exec", "open", "writeTextFile"]) {
    assert.equal(Reflect.get(filesystem, key), undefined);
  }
});
