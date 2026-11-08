import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { collectBytes, createMemoryFileSystem, createMountFileSystem, FsError, toByteSource } from "poe-code/safe-fs";
import type { FileSystem, ReadStreamOptions } from "poe-code/safe-fs";
import { createDeviceFileSystem } from "../../../src/fs/devices/index.js";

const names = ["null", "random", "urandom", "zero"] as const;
const errno = (code: string, path?: string) => (error: unknown): boolean => {
  assert.ok(error instanceof FsError);
  assert.equal(error.code, code);
  if (path !== undefined) assert.equal(error.path, path);
  return true;
};

test("devices are character nodes, not empty regular files", async () => {
  const fs: FileSystem = createDeviceFileSystem();
  assert.equal((await fs.stat("/")).type, "directory");
  assert.deepEqual(await fs.readdir("/"), names.map(name => ({ name, type: "character" })));
  for (const name of names) {
    const stat = await fs.stat(`/${name}`);
    assert.equal(stat.type, "character");
    assert.equal(stat.mode, 0o020666);
    assert.equal(stat.size, 0);
    assert.equal(stat.allocatedBytes, undefined);
    assert.deepEqual(await fs.lstat(`/${name}`), stat);
    await fs.access(`/${name}`, 6);
    await assert.rejects(fs.access(`/${name}`, 1), errno("EACCES"));
  }
  assert.equal(fs.capabilities.streamingRead, true);
  assert.equal(fs.capabilities.streamingWrite, true);
  assert.equal(fs.capabilities.streamingAppend, true);
  assert.equal(fs.capabilities.randomAccessWrite, false);
  assert.equal(fs.capabilities.permissions, false);
  assert.equal(fs.capabilities.readOnly, false);
});

test("paths are walked before dot reduction, including trailing slash", async () => {
  const fs = createDeviceFileSystem();
  for (const path of ["null", "/./null", "//null", "/../null", "///./../null"]) {
    assert.equal(await fs.realpath(path), "/null");
  }
  for (const path of ["", "/missing", "/dev/null", "/missing/../null", "/NULL"]) {
    await assert.rejects(fs.stat(path), errno("ENOENT", path));
  }
  for (const path of ["/null/", "/null/.", "/null/..", "/zero/../null", "/random/child"]) {
    await assert.rejects(fs.stat(path), errno("ENOTDIR", path));
  }
  await assert.rejects(fs.stat("/null\0"), errno("EINVAL"));
  await assert.rejects(fs.readdir("/zero"), errno("ENOTDIR"));
  await assert.rejects(fs.readFile("/"), errno("EISDIR"));
  await assert.rejects(fs.readdir("/", { maxEntries: 3 }), errno("EFBIG"));
  assert.equal((await fs.readdir("/", { maxEntries: 4 })).length, 4);
});

test("stat and lstat errors identify the requested operation", async () => {
  const fs = createDeviceFileSystem();
  for (const syscall of ["stat", "lstat"] as const) {
    await assert.rejects(fs[syscall]("/absent"), error => {
      assert.ok(error instanceof FsError);
      assert.equal(error.syscall, syscall);
      return true;
    });
  }
});

test("null reaches EOF; endless buffered reads fail without silently truncating", async () => {
  const fs = createDeviceFileSystem();
  assert.deepEqual(await fs.readFile("/null", { maxBytes: 0 }), new Uint8Array());
  assert.deepEqual(await collectBytes(fs.readStream("/null"), { maxBytes: 0 }), new Uint8Array());
  for (const name of ["zero", "random", "urandom"]) {
    for (const options of [{}, { maxBytes: 0 }, { maxBytes: 32 }, { maxBytes: Number.MAX_SAFE_INTEGER }]) {
      await assert.rejects(fs.readFile(`/${name}`, options), errno("EFBIG"));
    }
  }
  for (const maxBytes of [-1, 0.5, NaN, Infinity]) {
    await assert.rejects(fs.readFile("/null", { maxBytes }), errno("EINVAL"));
  }
});

test("zero streams forever with fresh bounded chunks and finite windows", async () => {
  const fs = createDeviceFileSystem();
  const iterator = fs.readStream("/zero", { chunkSize: 7 })[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.equal(first.done, false);
  assert.deepEqual(first.value, new Uint8Array(7));
  first.value!.fill(255);
  assert.deepEqual((await iterator.next()).value, new Uint8Array(7));
  await iterator.return!();
  assert.equal((await iterator.next()).done, true);
  assert.deepEqual(await collectBytes(fs.readStream("/zero", { start: 9, endExclusive: 20, chunkSize: 4 }), { maxBytes: 11 }), new Uint8Array(11));
  const bounded = fs.readStream("/zero", { chunkSize: Number.MAX_SAFE_INTEGER })[Symbol.asyncIterator]();
  assert.equal((await bounded.next()).value!.byteLength, 65536);
  await bounded.return!();
});

test("random devices call Web Crypto only on demand with owned quota-sized chunks", async context => {
  const calls: Uint8Array[] = [];
  context.mock.method(globalThis.crypto, "getRandomValues", (bytes: Uint8Array) => {
    calls.push(bytes);
    bytes.fill(calls.length);
    return bytes;
  });
  const fs = createDeviceFileSystem();
  for (const name of ["random", "urandom"]) {
    const before = calls.length;
    const iterator = fs.readStream(`/${name}`, { chunkSize: 100000, endExclusive: 65539 })[Symbol.asyncIterator]();
    assert.equal(calls.length, before);
    const first = await iterator.next();
    assert.equal(first.value!.byteLength, 65536);
    assert.equal(calls.length, before + 1);
    const second = await iterator.next();
    assert.equal(second.value!.byteLength, 3);
    assert.notEqual(first.value!.buffer, second.value!.buffer);
    assert.equal(first.value![0], before + 1);
    assert.equal((await iterator.next()).done, true);
    assert.equal(calls.length, before + 2);
  }
  const iterator = fs.readStream("/urandom")[Symbol.asyncIterator]();
  await iterator.next();
  const before = calls.length;
  await iterator.return!();
  await iterator.next();
  assert.equal(calls.length, before);
});

test("missing or failed Web Crypto fails closed without disabling null/zero", async context => {
  context.mock.getter(globalThis, "crypto", () => undefined);
  const fs = createDeviceFileSystem();
  await assert.rejects(fs.readStream("/urandom")[Symbol.asyncIterator]().next(), errno("ENOTSUP"));
  assert.deepEqual(await collectBytes(fs.readStream("/zero", { endExclusive: 2 }), { maxBytes: 2 }), new Uint8Array(2));
});

test("Web Crypto failures retain the cause rather than substitute weak randomness", async context => {
  const failure = new Error("entropy provider failed");
  context.mock.method(globalThis.crypto, "getRandomValues", () => { throw failure; });
  await assert.rejects(createDeviceFileSystem().readStream("/random")[Symbol.asyncIterator]().next(), error => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, "EIO");
    assert.equal(error.cause, failure);
    return true;
  });
});

test("invalid stream ranges reject before allocating or reading", async () => {
  const fs = createDeviceFileSystem();
  const cases: ReadStreamOptions[] = [{ start: -1 }, { start: Infinity }, { endExclusive: -1 }, { start: 2, endExclusive: 1 }, { chunkSize: 0 }, { chunkSize: NaN }, { chunkSize: 1.5 }];
  for (const options of cases) {
    await assert.rejects(fs.readStream("/null", options)[Symbol.asyncIterator]().next(), errno("EINVAL"));
  }
  assert.deepEqual(await collectBytes(fs.readStream("/random", { endExclusive: 0 }), { maxBytes: 0 }), new Uint8Array());
});

test("writes and append discard; exclusive flags and missing entries still fail", async () => {
  const fs = createDeviceFileSystem();
  const payload = new Uint8Array([0, 255, 128]);
  for (const name of names) {
    const path = `/${name}`;
    if (name === "urandom") {
      await assert.rejects(fs.writeFile(path, payload), errno("EPERM"));
      await assert.rejects(fs.writeFile(path, payload, { flag: "a" }), errno("EPERM"));
      await assert.rejects(fs.appendFile(path, payload), errno("EPERM"));
      await assert.rejects(fs.writeStream(path, toByteSource(payload), { flag: "a" }), errno("EPERM"));
    } else {
      await fs.writeFile(path, payload);
      await fs.writeFile(path, payload, { flag: "a" });
      await fs.appendFile(path, payload);
      await fs.writeStream(path, toByteSource(payload), { flag: "a" });
    }
    for (const flag of ["wx", "ax"] as const) {
      await assert.rejects(fs.writeFile(path, payload, { flag }), errno("EEXIST"));
    }
    assert.equal((await fs.stat(path)).size, 0);
  }
  await assert.rejects(fs.writeFile("/missing", payload), errno("ENOENT"));
  await assert.rejects(fs.writeFile("/", payload), errno("EISDIR"));
  await assert.rejects(fs.writeFile("/null", "text" as unknown as Uint8Array), TypeError);
});

test("stream writes validate before pulling, propagate errors and close producers", async () => {
  const fs = createDeviceFileSystem();
  let pulls = 0;
  let closed = false;
  async function* source() {
    try {
      pulls++;
      yield new Uint8Array(1);
      pulls++;
      yield "invalid" as unknown as Uint8Array;
    } finally { closed = true; }
  }
  await assert.rejects(fs.writeStream("/missing", source()), errno("ENOENT"));
  await assert.rejects(fs.writeStream("/null", source(), { flag: "wx" }), errno("EEXIST"));
  assert.equal(pulls, 0);
  await assert.rejects(fs.writeStream("/null", source()), TypeError);
  assert.equal(pulls, 2);
  assert.equal(closed, true);
});

test("cancellation preserves reason identity and prevents pre-aborted effects", async () => {
  const fs = createDeviceFileSystem();
  const reason = new FsError("ENOENT");
  const signal = AbortSignal.abort(reason);
  const operations = [
    () => fs.stat("/null", { signal }), () => fs.lstat("/null", { signal }),
    () => fs.readFile("/zero", { signal }), () => fs.writeFile("/null", new Uint8Array(), { signal }),
    () => fs.appendFile("/null", new Uint8Array(), { signal }), () => fs.readdir("/", { signal }),
    () => fs.realpath("/null", { signal }), () => fs.access("/null", 6, { signal }),
    () => fs.rm("/missing", { force: true, signal }), () => fs.mkdir("/", { signal }),
    () => fs.rmdir("/", { signal }), () => fs.rename("/null", "/zero", { signal }),
    () => fs.copyFile("/null", "/zero", { signal }),
    () => fs.readStream("/zero", { signal })[Symbol.asyncIterator]().next(),
    () => fs.writeStream("/null", toByteSource("ignored"), { signal }),
  ];
  for (const operation of operations) await assert.rejects(operation(), error => error === reason);
});

test("endless reads yield to timer cancellation, without prefetch", async () => {
  const fs = createDeviceFileSystem();
  const controller = new AbortController();
  const reason = new Error("stop");
  let chunks = 0;
  const timer = setTimeout(() => controller.abort(reason), 5);
  try {
    await assert.rejects(async () => {
      for await (const chunk of fs.readStream("/zero", { signal: controller.signal, chunkSize: 8 })) {
        assert.equal(chunk.byteLength, 8);
        chunks++;
      }
    }, error => error === reason);
    assert.ok(chunks > 0);
  } finally { clearTimeout(timer); }
});

test("cancelling a stalled writer calls return without waiting on opaque input", async () => {
  const fs = createDeviceFileSystem();
  const controller = new AbortController();
  const reason = new Error("cancel pending pull");
  let returned = 0;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const pending = fs.writeStream("/null", {
    [Symbol.asyncIterator]() {
      return {
        next() { started(); return new Promise<IteratorResult<Uint8Array>>(() => {}); },
        async return() { returned++; return { done: true as const, value: undefined }; },
      };
    },
  }, { signal: controller.signal });
  await ready;
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(returned, 1);
});

test("empty-chunk writers remain cancellable and finalize their source", async () => {
  const controller = new AbortController();
  const reason = new Error("stop empty chunks");
  let closed = false;
  async function* source() {
    try { while (true) yield new Uint8Array(); }
    finally { closed = true; }
  }
  const timer = setTimeout(() => controller.abort(reason), 5);
  try {
    await assert.rejects(createDeviceFileSystem().writeStream("/null", source(), { signal: controller.signal }), error => error === reason);
    assert.equal(closed, true);
  } finally { clearTimeout(timer); }
});

test("producer failures and falsey cancellation reasons are not rewritten", async () => {
  const fs = createDeviceFileSystem();
  for (const reason of [null, false, 0, ""]) {
    await assert.rejects(fs.readFile("/null", { signal: AbortSignal.abort(reason) }), error => error === reason);
    async function* source() {
      yield new Uint8Array([1]);
      throw reason;
    }
    await assert.rejects(fs.writeStream("/null", source()), error => error === reason);
  }
});

test("device namespace is fixed, and unsupported mutations do not fake success", async () => {
  const fs = createDeviceFileSystem();
  await fs.mkdir("/", { recursive: true });
  await fs.rm("/missing", { force: true });
  await assert.rejects(fs.mkdir("/"), errno("EEXIST"));
  await assert.rejects(fs.mkdir("/new"), errno("ENOTSUP"));
  await assert.rejects(fs.rm("/null"), errno("ENOTSUP"));
  await assert.rejects(fs.rmdir("/null"), errno("ENOTDIR"));
  await assert.rejects(fs.rmdir("/"), errno("ENOTEMPTY"));
  await assert.rejects(fs.rename("/null", "/new"), errno("ENOTSUP"));
  const entries = await fs.readdir("/");
  const destination = await fs.stat("/zero");
  const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c",
    "test -c /dev/zero && cp /dev/null /dev/zero && test -c /dev/zero && head -c 17 /dev/zero",
  ], { env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, timeout: 2000, maxBuffer: 65536 });
  assert.equal(native.error, undefined);
  assert.equal(native.signal, null);
  assert.equal(native.status, 0);
  assert.deepEqual(new Uint8Array(native.stdout), new Uint8Array(17));
  assert.equal(native.stderr.length, 0);
  await fs.copyFile("/null", "/zero");
  assert.deepEqual(await fs.readdir("/"), entries);
  assert.equal((await fs.stat("/zero")).type, "character");
  assert.deepEqual(await fs.stat("/zero"), destination);
  assert.deepEqual(await fs.readFile("/null"), new Uint8Array());
  assert.deepEqual(await collectBytes(fs.readStream("/zero", { endExclusive: 17 }), { maxBytes: 17 }), new Uint8Array(native.stdout));
  await assert.rejects(fs.copyFile("/null", "/new"), errno("ENOENT"));
  await assert.rejects(fs.copyFile("/null", "/zero", { exclusive: true }), errno("EEXIST"));
  assert.deepEqual(await fs.readdir("/"), entries);
});

test("explicit mount preserves memory defaults, canonical paths, streaming and metadata", async () => {
  const root = createMemoryFileSystem();
  const fs = createMountFileSystem({ root, mounts: { "/dev": createDeviceFileSystem() } });
  await assert.rejects(root.stat("/dev/null"), errno("ENOENT"));
  assert.equal((await fs.stat("/dev/null")).type, "character");
  assert.equal(await fs.realpath("/dev/./urandom"), "/dev/urandom");
  assert.deepEqual(await collectBytes(fs.readStream("/dev/zero", { endExclusive: 17 }), { maxBytes: 17 }), new Uint8Array(17));
  await fs.writeStream("/dev/null", toByteSource("discard me"));
  await assert.rejects(fs.readFile("/dev/random", { maxBytes: 64 }), errno("EFBIG", "/dev/random"));
  await assert.rejects(fs.stat("/dev/null/.."), errno("ENOTDIR", "/dev/null/.."));
  await fs.writeFile("/ordinary", new Uint8Array([42]));
  assert.deepEqual(await root.readFile("/ordinary"), new Uint8Array([42]));
});
