import { expect, it, vi } from "vitest";
import type { FileReadHandle, FileResizeHandle, FileStat, FileSystem, FsOptions } from "../src/contracts/filesystem.js";
import { FsError } from "../src/contracts/errors.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { FileSystemQuotaError, withFileSystemQuota } from "../src/fs/quota/index.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(supported = true) {
  const memory = new MemoryFileSystem();
  const pinned: { bytes: Uint8Array; end: bigint; ino: number } = { bytes: Uint8Array.of(1, 2, 3), end: 3n, ino: 1 };
  const entries = new Map([["/file", pinned]]);
  const scope = {};
  const events: string[] = [];
  const observe = (node: typeof pinned): FileStat => ({
    type: "file", size: node.bytes.length, mode: 0o600, mtimeMs: 0, ctimeMs: 0, atimeMs: 0,
    identityScope: scope, dev: 1, ino: node.ino,
  });
  let closed = false;
  let cursor = 0n;
  const check = (options?: FsOptions): void => {
    options?.signal?.throwIfAborted();
    if (closed) throw new FsError("EBADF");
  };
  const seek = vi.fn(async function (this: unknown, options?: FsOptions) {
    expect(this).toBe(original);
    check(options);
    events.push("seek");
    cursor = pinned.end;
    return cursor;
  });
  const original: FileReadHandle & FileResizeHandle = {
    stat: vi.fn(async function (options?: FsOptions) { check(options); events.push("stat"); return observe(pinned); }),
    read: vi.fn(async function (position: number, maxBytes: number, options?: FsOptions) {
      check(options);
      return pinned.bytes.slice(position, position + maxBytes);
    }),
    truncate: vi.fn(async function (length: number, options?: FsOptions) {
      check(options);
      events.push("truncate");
      const bytes = new Uint8Array(length);
      bytes.set(pinned.bytes.subarray(0, length));
      pinned.bytes = bytes;
      pinned.end = BigInt(length);
    }),
    close: vi.fn(async () => { events.push("close"); closed = true; }),
    ...(supported ? { seekEnd: seek } : {}),
  };
  const lookup = (path: string): typeof pinned => {
    const entry = entries.get(path);
    if (!entry) throw new FsError("ENOENT", { path });
    return entry;
  };
  const overrides: Partial<FileSystem> = {
    capabilities: { ...memory.capabilities, retainedRead: true, retainedResize: true },
    async openResizeFile() { return original; },
    async openReadFile() { return original; },
    async stat(path) { return observe(lookup(path)); },
    async lstat(path) { return observe(lookup(path)); },
    readdir: vi.fn(async () => Array.from(entries.keys(), path => ({ name: path.slice(1), type: "file" as const }))),
    async writeFile(path, bytes) { events.push("write"); entries.set(path, { bytes, end: BigInt(bytes.length), ino: 2 }); },
  };
  const filesystem = new Proxy(memory as FileSystem, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const quota = withFileSystemQuota(filesystem, { maxBytes: 8 });
  return { quota, original, pinned, entries, events, seek, overrides, cursor: () => cursor };
}

for (const kind of ["read", "resize"] as const) {
  it(`quota preserves ${kind} end seeking with its receiver, exact bigint and options`, async () => {
    const setup = fixture();
    setup.pinned.end = (1n << 63n) - 1n;
    const handle = kind === "read" ? await setup.quota.openReadFile!("/file") : await setup.quota.openResizeFile!("/file");
    const options = { signal: new AbortController().signal };
    try {
      expect(typeof handle.seekEnd).toBe("function");
      if (kind === "read") expect(handle).toBe(setup.original);
      expect(await handle.seekEnd!(options)).toBe(setup.pinned.end);
      expect(setup.cursor()).toBe(setup.pinned.end);
      expect(setup.seek).toHaveBeenCalledWith(options);
      expect(setup.pinned.bytes).toEqual(Uint8Array.of(1, 2, 3));
      expect(setup.overrides.readdir).not.toHaveBeenCalled();
      expect(setup.original.truncate).not.toHaveBeenCalled();
    } finally { await handle.close(); }
  });

  for (const explicit of [false, true]) it(`quota leaves unsupported ${kind} seekEnd ${explicit ? "undefined" : "absent"}`, async () => {
    const setup = fixture(false);
    if (explicit) setup.original.seekEnd = undefined;
    const handle = kind === "read" ? await setup.quota.openReadFile!("/file") : await setup.quota.openResizeFile!("/file");
    try {
      expect(handle.seekEnd).toBeUndefined();
      if (kind === "resize") expect(Object.hasOwn(handle, "seekEnd")).toBe(false);
    }
    finally { await handle.close(); }
  });
}

it("quota seeking follows retained aliases after pathname replacement without changing admission", async () => {
  const setup = fixture();
  const handle = await setup.quota.openResizeFile!("/file");
  try {
    expect(typeof handle.seekEnd).toBe("function");
    setup.entries.set("/alias", setup.pinned);
    setup.entries.set("/file", { bytes: Uint8Array.of(9, 9), end: 2n, ino: 2 });
    expect(await handle.seekEnd!()).toBe(3n);
    await handle.truncate(6);
    expect(await handle.seekEnd!()).toBe(6n);
    await expect(handle.truncate(7)).rejects.toBeInstanceOf(FileSystemQuotaError);
    expect(setup.entries.get("/file")!.bytes).toEqual(Uint8Array.of(9, 9));
    setup.entries.delete("/alias");
    expect(await handle.seekEnd!()).toBe(6n);
    expect(setup.pinned.bytes).toEqual(Uint8Array.of(1, 2, 3, 0, 0, 0));
  } finally { await handle.close(); }
});

it("quota queues seeking with resize, stat and writes; close drains only admitted handle work", async () => {
  const setup = fixture();
  const entered = deferred();
  const release = deferred();
  const seek = setup.original.seekEnd!;
  setup.original.seekEnd = async function (options) {
    entered.resolve();
    await release.promise;
    return Reflect.apply(seek, this, [options]);
  };
  const handle = await setup.quota.openResizeFile!("/file");
  expect(typeof handle.seekEnd).toBe("function");
  setup.events.length = 0;
  const seeking = handle.seekEnd!();
  await entered.promise;
  const resize = handle.truncate(4);
  const metadata = handle.stat();
  const closing = handle.close();
  expect(handle.close()).toBe(closing);
  await expect(handle.seekEnd!()).rejects.toMatchObject({ code: "EBADF" });
  await expect(handle.truncate(1)).rejects.toMatchObject({ code: "EBADF" });
  expect(setup.events).toEqual([]);
  expect(setup.original.close).not.toHaveBeenCalled();
  const writeEntered = deferred();
  const writeRelease = deferred();
  setup.overrides.writeFile = async () => { writeEntered.resolve(); await writeRelease.promise; };
  const write = setup.quota.writeFile("/other", Uint8Array.of(7));
  release.resolve();
  expect(await seeking).toBe(3n);
  await resize;
  expect((await metadata).size).toBe(4);
  await writeEntered.promise;
  await closing;
  expect(setup.events).toEqual(["seek", "stat", "truncate", "stat", "close"]);
  expect(setup.original.close).toHaveBeenCalledTimes(1);
  writeRelease.resolve();
  await write;
});

it("quota seeking observes an earlier queued resize and waits for earlier namespace writes", async () => {
  const setup = fixture();
  const entered = deferred();
  const release = deferred();
  const write = setup.overrides.writeFile!;
  setup.overrides.writeFile = async (...args) => {
    entered.resolve();
    await release.promise;
    await write(...args);
  };
  const handle = await setup.quota.openResizeFile!("/file");
  try {
    expect(typeof handle.seekEnd).toBe("function");
    const writing = setup.quota.writeFile("/other", Uint8Array.of(7));
    await entered.promise;
    const resizing = handle.truncate(5);
    const seeking = handle.seekEnd!();
    expect(setup.seek).not.toHaveBeenCalled();
    expect(setup.original.truncate).not.toHaveBeenCalled();
    release.resolve();
    await writing;
    await resizing;
    expect(await seeking).toBe(5n);
    expect(setup.events).toEqual(["stat", "write", "stat", "truncate", "seek"]);
  } finally { release.resolve(); await handle.close(); }
});

it("quota close drains a seek rejecting undefined without hiding its own failure", async () => {
  const setup = fixture();
  const entered = deferred();
  const release = deferred();
  setup.original.seekEnd = async () => { entered.resolve(); await release.promise; throw undefined; };
  setup.original.close = vi.fn(async () => { throw false; });
  const handle = await setup.quota.openResizeFile!("/file");
  expect(typeof handle.seekEnd).toBe("function");
  const seeking = handle.seekEnd!().then(value => ({ value }), error => ({ error }));
  await entered.promise;
  const closing = handle.close();
  expect(setup.original.close).not.toHaveBeenCalled();
  release.resolve();
  expect(await seeking).toEqual({ error: undefined });
  await expect(closing).rejects.toBe(false);
  expect(setup.original.close).toHaveBeenCalledTimes(1);
});

for (const reason of [false, null, 0, ""]) {
  it(`quota refuses queued seeking canceled by an earlier callback: ${JSON.stringify(reason)}`, async () => {
    const setup = fixture();
    const controller = new AbortController();
    const handle = await setup.quota.openResizeFile!("/file");
    try {
      expect(typeof handle.seekEnd).toBe("function");
      const stat = setup.original.stat;
      setup.original.stat = async options => { controller.abort(reason); return stat(options); };
      const earlier = handle.stat();
      const outcome = handle.seekEnd!({ signal: controller.signal });
      await expect(outcome).rejects.toBe(reason);
      await earlier;
      expect(setup.seek).not.toHaveBeenCalled();
    } finally { await handle.close(); }
  });

  it(`quota drains in-flight seeking on cancellation: ${JSON.stringify(reason)}`, async () => {
    const setup = fixture();
    const entered = deferred();
    const release = deferred();
    const controller = new AbortController();
    setup.original.seekEnd = async function () {
      expect(this).toBe(setup.original);
      entered.resolve();
      await release.promise;
      return 3n;
    };
    const handle = await setup.quota.openResizeFile!("/file");
    expect(typeof handle.seekEnd).toBe("function");
    const outcome = handle.seekEnd!({ signal: controller.signal }).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    controller.abort(reason);
    const closing = handle.close();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(setup.original.close).not.toHaveBeenCalled();
    release.resolve();
    expect(await outcome).toEqual({ error: reason });
    await closing;
    expect(setup.original.close).toHaveBeenCalledTimes(1);
  });

  it(`quota preserves falsey seek failures and separate close failures: ${JSON.stringify(reason)}`, async () => {
    const setup = fixture();
    setup.original.seekEnd = async () => { throw reason; };
    setup.original.close = vi.fn(async () => { throw null; });
    const handle = await setup.quota.openResizeFile!("/file");
    expect(typeof handle.seekEnd).toBe("function");
    await expect(handle.seekEnd!()).rejects.toBe(reason);
    expect((await handle.stat()).size).toBe(3);
    const closing = handle.close();
    expect(handle.close()).toBe(closing);
    await expect(closing).rejects.toBeNull();
    expect(setup.original.close).toHaveBeenCalledTimes(1);
  });
}

it("quota captures a seek getter once with cancellation checked before returning the handle", async () => {
  const setup = fixture();
  const controller = new AbortController();
  const getter = vi.fn(() => { controller.abort(false); return setup.seek; });
  Object.defineProperty(setup.original, "seekEnd", { get: getter });
  await expect(setup.quota.openResizeFile!("/file", { signal: controller.signal })).rejects.toBe(false);
  expect(getter).toHaveBeenCalledTimes(1);
  expect(setup.seek).not.toHaveBeenCalled();
  expect(setup.original.close).toHaveBeenCalledTimes(1);
});

for (const failure of [false, null, 0, "", undefined]) {
  it(`quota preserves a failing seek getter through acquisition cleanup: ${String(failure)}`, async () => {
    const setup = fixture();
    Object.defineProperty(setup.original, "seekEnd", { get() { throw failure; } });
    setup.original.close = vi.fn(async () => { throw new Error("cleanup"); });
    await expect(setup.quota.openResizeFile!("/file")).rejects.toBe(failure);
    expect(setup.original.close).toHaveBeenCalledTimes(1);
  });
}

it("quota does not repeat the captured seek getter at dispatch", async () => {
  const setup = fixture();
  const getter = vi.fn(() => setup.seek);
  Object.defineProperty(setup.original, "seekEnd", { get: getter });
  const handle = await setup.quota.openResizeFile!("/file");
  try {
    expect(typeof handle.seekEnd).toBe("function");
    expect(await handle.seekEnd!()).toBe(3n);
    expect(await handle.seekEnd!()).toBe(3n);
    expect(getter).toHaveBeenCalledTimes(1);
  } finally { await handle.close(); }
});

it("quota refuses dispatch when the operation signal getter aborts", async () => {
  const setup = fixture();
  const controller = new AbortController();
  const handle = await setup.quota.openResizeFile!("/file");
  try {
    expect(typeof handle.seekEnd).toBe("function");
    await expect(handle.seekEnd!({ get signal() { controller.abort(0); return controller.signal; } })).rejects.toBe(0);
    expect(setup.seek).not.toHaveBeenCalled();
  } finally { await handle.close(); }
});
