import { describe, expect, it, vi } from "vitest";
import { createMemoryFileSystem, FsError } from "./engine/index.js";
import type { FileSystem } from "./engine/index.js";
import { decodeError, encodeError, hostFileSystem, remoteFileSystem } from "./execution-filesystem.js";

vi.mock("./engine/index.js", async () => {
  const { buildBrowserEngine } = await import("./engine/build-plugin.mjs");
  const built = await buildBrowserEngine();
  return import(
    /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(`const navigator = { language: "en-US" };\n${built.code}\n//# sourceURL=safe-bash-browser-execution-filesystem.mjs`).toString("base64")}`
  );
});

function fixture(filesystem: FileSystem = createMemoryFileSystem()) {
  const controller = new AbortController();
  const host = hostFileSystem(filesystem, controller.signal);
  const remote = remoteFileSystem(structuredClone(host.description), async (method, args) => {
    try {
      return structuredClone(await host.dispatch(method, structuredClone(args)));
    } catch (error) {
      throw decodeError(structuredClone(encodeError(error)));
    }
  });
  return { filesystem, controller, host, remote };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe("retained execution descriptors", () => {
  it("uses supplied retained handles across rename, unlink and replacement with shared stat identity", async () => {
    const memory = createMemoryFileSystem();
    const openRead = vi.fn(memory.openReadFile!.bind(memory));
    const openResize = vi.fn(memory.openResizeFile!.bind(memory));
    const pathnameResize = vi.fn(memory.truncate!.bind(memory));
    const guarded = new Proxy(memory, { get(target, property) {
      if (property === "openReadFile") return openRead;
      if (property === "openResizeFile") return openResize;
      if (property === "truncate") return pathnameResize;
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const { filesystem, host, remote } = fixture(guarded);
    await filesystem.writeFile("/file", Uint8Array.of(0, 128, 255));
    try {
      expect(remote.openReadFile).toBeTypeOf("function");
      expect(remote.openResizeFile).toBeTypeOf("function");
      const reader = await remote.openReadFile!("/file");
      const writer = await remote.openResizeFile!("/file", { create: false });
      const original = await remote.stat("/file");
      expect((await reader.stat()).identityScope).toBe(original.identityScope);
      expect((await writer.stat()).identityScope).toBe(original.identityScope);
      expect((await writer.stat()).ino).toBe(original.ino);
      await remote.rename!("/file", "/moved");
      await remote.rm("/moved");
      await remote.writeFile("/file", Uint8Array.of(9));
      await writer.truncate(5);
      expect(await reader.read(0, 8)).toEqual(Uint8Array.of(0, 128, 255, 0, 0));
      expect((await writer.stat()).size).toBe(5);
      expect(await remote.readFile("/file")).toEqual(Uint8Array.of(9));
      expect(openRead).toHaveBeenCalledTimes(1);
      expect(openResize).toHaveBeenCalledWith("/file", expect.objectContaining({ create: false, signal: expect.any(AbortSignal) }));
      expect(pathnameResize).not.toHaveBeenCalled();
      await Promise.all([reader.close(), writer.close()]);
    } finally { await host.close(); }
  });

  it("forwards creation options and guarded resize failures without pathname fallback", async () => {
    const memory = createMemoryFileSystem();
    const truncate = vi.fn(async () => { throw new FsError("ENOSPC", { syscall: "ftruncate", path: "/new" }); });
    const close = vi.fn(async () => {});
    const open = vi.spyOn(memory, "openResizeFile").mockImplementation(async (path, options) => {
      expect(path).toBe("/new");
      expect(options).toMatchObject({ create: true, mode: 0o620 });
      return { stat: async () => memory.stat("/"), truncate, close };
    });
    const { host, remote } = fixture(memory);
    try {
      expect(remote.openResizeFile).toBeTypeOf("function");
      const handle = await remote.openResizeFile!("/new", { create: true, mode: 0o620 });
      await expect(handle.truncate(10)).rejects.toMatchObject({ code: "ENOSPC", syscall: "ftruncate", path: "/new" });
      await handle.close();
      expect(open).toHaveBeenCalledTimes(1);
      expect(truncate).toHaveBeenCalledWith(10, expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(close).toHaveBeenCalledTimes(1);
      await expect(memory.stat("/new")).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await host.close(); }
  });

  for (const method of ["openReadFile", "openResizeFile"] as const) {
    it(`${method} preserves optional seekEnd and exact BigInt results`, async () => {
      const memory = createMemoryFileSystem();
      const end = 9223372036854775807n;
      const seekEnd = vi.fn(async () => end);
      const close = vi.fn(async () => {});
      const handle = { stat: async () => memory.stat("/"), read: async () => Uint8Array.of(255), truncate: async () => {}, seekEnd, close };
      vi.spyOn(memory, method).mockResolvedValue(handle);
      const { host, remote } = fixture(memory);
      try {
        expect(remote[method]).toBeTypeOf("function");
        const retained = await remote[method]!("/file");
        expect(retained.seekEnd).toBeTypeOf("function");
        expect(await retained.seekEnd!()).toBe(end);
        await retained.close();
        expect(close).toHaveBeenCalledTimes(1);
      } finally { await host.close(); }
    });

    it(`${method} stops admission synchronously and shares exactly-once close`, async () => {
      const memory = createMemoryFileSystem();
      const held = deferred<void>();
      const close = vi.fn(() => held.promise);
      const stat = vi.fn(async () => memory.stat("/"));
      vi.spyOn(memory, method).mockResolvedValue({ stat, read: async () => new Uint8Array(), truncate: async () => {}, close });
      const { host, remote } = fixture(memory);
      try {
        expect(remote[method]).toBeTypeOf("function");
        const handle = await remote[method]!("/file");
        expect(handle.seekEnd).toBeUndefined();
        const lateStat = handle.stat;
        const closing = handle.close();
        expect(handle.close()).toBe(closing);
        await expect(lateStat()).rejects.toMatchObject({ code: "EBADF" });
        expect(stat).not.toHaveBeenCalled();
        held.resolve();
        await closing;
        expect(close).toHaveBeenCalledTimes(1);
      } finally { held.resolve(); await host.close(); }
    });

    it.each(["close", "cancel"])(`${method} drains late acquisition after host %s`, async termination => {
      const memory = createMemoryFileSystem();
      const entered = deferred<void>();
      const acquired = deferred<Awaited<ReturnType<NonNullable<FileSystem[typeof method]>>>>();
      const retired = deferred<void>();
      const closeEntered = deferred<void>();
      const close = vi.fn(() => { closeEntered.resolve(); return retired.promise; });
      vi.spyOn(memory, method).mockImplementation(() => { entered.resolve(); return acquired.promise; });
      const { host, remote, controller } = fixture(memory);
      try {
        expect(remote[method]).toBeTypeOf("function");
        const opening = remote[method]!("/file").then(value => ({ value }), error => ({ error }));
        await entered.promise;
        if (termination === "cancel") controller.abort(false);
        const closing = host.close();
        expect(host.close()).toBe(closing);
        let settled = false;
        void closing.then(() => { settled = true; });
        acquired.resolve({ stat: async () => memory.stat("/"), read: async () => new Uint8Array(), truncate: async () => {}, close });
        await closeEntered.promise;
        expect(settled).toBe(false);
        retired.resolve();
        expect(await opening).toHaveProperty("error");
        await closing;
        expect(close).toHaveBeenCalledTimes(1);
      } finally { retired.resolve(); await host.close(); }
    });
  }

  it("does not advertise affirmative retained support when methods are missing", async () => {
    const memory = createMemoryFileSystem();
    Reflect.set(memory, "openReadFile", undefined);
    Reflect.set(memory, "openResizeFile", undefined);
    Reflect.set(memory, "capabilitiesFor", async () => memory.capabilities);
    const { host, remote } = fixture(memory);
    try {
      expect(host.description.capabilities.retainedRead).not.toBe(true);
      expect(host.description.capabilities.retainedResize).not.toBe(true);
      expect(remote.openReadFile).toBeUndefined();
      expect(remote.openResizeFile).toBeUndefined();
      expect(remote.capabilitiesFor).toBeTypeOf("function");
      const capabilities = await remote.capabilitiesFor!("/", { create: false });
      expect(capabilities.retainedRead).not.toBe(true);
      expect(capabilities.retainedResize).not.toBe(true);
    } finally { await host.close(); }
  });

  it("bounds live handles, retains the slot while closing and recovers after cleanup", async () => {
    const memory = createMemoryFileSystem();
    const released = deferred<void>();
    const close = vi.fn(() => released.promise);
    const open = vi.spyOn(memory, "openResizeFile").mockImplementation(async () => ({ stat: async () => memory.stat("/"), truncate: async () => {}, close }));
    const { host, remote } = fixture(memory);
    try {
      const handles = [];
      for (let index = 0; index < 64; index++) handles.push(await remote.openResizeFile!("/file"));
      await expect(remote.openResizeFile!("/file")).rejects.toThrow("handle limit");
      await expect(host.dispatch("handle-open-resize", ["/file"])).rejects.toThrow("handle limit");
      expect(open).toHaveBeenCalledTimes(64);
      const closing = handles[0]!.close();
      await expect(remote.openResizeFile!("/file")).rejects.toThrow("handle limit");
      released.resolve();
      await closing;
      const replacement = await remote.openResizeFile!("/file");
      await Promise.all([...handles.map(handle => handle.close()), replacement.close()]);
      expect(close).toHaveBeenCalledTimes(65);
    } finally { released.resolve(); await host.close(); }
  });

  it("reserves pending acquisition slots before backend reentrant dispatch", async () => {
    const memory = createMemoryFileSystem();
    const held = deferred<Awaited<ReturnType<NonNullable<FileSystem["openResizeFile"]>>>>();
    const operations: Promise<unknown>[] = [];
    let entries = 0;
    vi.spyOn(memory, "openResizeFile").mockImplementation(() => {
      if (++entries <= 64) operations.push(host.dispatch("handle-open-resize", ["/file"]).catch(error => error));
      return held.promise;
    });
    const host = hostFileSystem(memory, new AbortController().signal);
    const original = host.dispatch("handle-open-resize", ["/file"]);
    expect(entries).toBe(64);
    const close = vi.fn(async () => {});
    held.resolve({ stat: async () => memory.stat("/"), truncate: async () => {}, close });
    await original;
    const results = await Promise.all(operations);
    expect(results.filter(result => result instanceof Error)).toHaveLength(1);
    await host.close();
    expect(close).toHaveBeenCalledTimes(64);
  });

  it("reserves remote cleanup capacity when retained calls saturate ordinary requests", async () => {
    const memory = createMemoryFileSystem();
    const held = deferred<void>();
    const close = vi.fn(async () => {});
    vi.spyOn(memory, "openResizeFile").mockResolvedValue({ stat: async () => memory.stat("/"), truncate: () => held.promise, close });
    const { host, remote } = fixture(memory);
    try {
      const handle = await remote.openResizeFile!("/file");
      const operations = Array.from({ length: 63 }, () => handle.truncate(0));
      await expect(handle.truncate(0)).rejects.toThrow("request limit");
      const closing = handle.close();
      await new Promise<void>(resolve => setImmediate(resolve));
      try { expect(close).not.toHaveBeenCalled(); }
      finally { held.resolve(); await closing; }
      await Promise.all(operations);
      expect(close).toHaveBeenCalledTimes(1);
    } finally { held.resolve(); await host.close(); }
  });

  it("drains held retained work before physical release and shares the host drain", async () => {
    const memory = createMemoryFileSystem();
    const held = deferred<Uint8Array>();
    const entered = deferred<void>();
    const close = vi.fn(async () => {});
    vi.spyOn(memory, "openReadFile").mockResolvedValue({ stat: async () => memory.stat("/"), read: () => { entered.resolve(); return held.promise; }, close });
    const { host, remote } = fixture(memory);
    const handle = await remote.openReadFile!("/file");
    const reading = handle.read(0, 1).catch(error => error);
    await entered.promise;
    const closing = host.close();
    expect(host.close()).toBe(closing);
    await new Promise<void>(resolve => setImmediate(resolve));
    try { expect(close).not.toHaveBeenCalled(); }
    finally { held.resolve(Uint8Array.of(1)); await closing; }
    expect(await reading).toMatchObject({ code: "ECANCELED" });
    await handle.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([false, 0, "", null, undefined, NaN])("retires remote late acquisition on caller cancellation %s", async reason => {
    const memory = createMemoryFileSystem();
    const entered = deferred<void>();
    const acquired = deferred<Awaited<ReturnType<NonNullable<FileSystem["openResizeFile"]>>>>();
    const close = vi.fn(async () => {});
    vi.spyOn(memory, "openResizeFile").mockImplementation(() => { entered.resolve(); return acquired.promise; });
    const { host, remote } = fixture(memory);
    const controller = new AbortController();
    try {
      const opening = remote.openResizeFile!("/file", { signal: controller.signal }).catch(error => error);
      await entered.promise;
      controller.abort(reason);
      acquired.resolve({ stat: async () => memory.stat("/"), truncate: async () => {}, close });
      expect(await opening).toBe(controller.signal.reason);
      expect(close).toHaveBeenCalledTimes(1);
    } finally { await host.close(); }
  });

  it.each(["open", "stat", "seekEnd"])("does not invoke callbacks after %s getter cancellation", async phase => {
    const memory = createMemoryFileSystem();
    const controller = new AbortController();
    const close = vi.fn(async () => {});
    const stat = vi.fn(async () => memory.stat("/"));
    const seek = vi.fn(async () => 0n);
    const handle = { stat, truncate: async () => {}, close };
    if (phase === "stat") Object.defineProperty(handle, "stat", { get() { controller.abort(false); return stat; } });
    if (phase === "seekEnd") Object.defineProperty(handle, "seekEnd", { get() { controller.abort(false); return seek; } });
    const open = vi.fn(async () => handle);
    let armed = false;
    Object.defineProperty(memory, "openResizeFile", { get() { if (armed && phase === "open") controller.abort(false); return open; } });
    const host = hostFileSystem(memory, controller.signal);
    armed = true;
    await expect(host.dispatch("handle-open-resize", ["/file"])).rejects.toBe(false);
    await host.close();
    expect(open).toHaveBeenCalledTimes(phase === "open" ? 0 : 1);
    expect(stat).not.toHaveBeenCalled();
    expect(seek).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(phase === "open" ? 0 : 1);
  });

  it("captures retained callbacks and preserves falsey close failures in its shared drain", async () => {
    const memory = createMemoryFileSystem();
    const stat = vi.fn(async () => memory.stat("/"));
    const close = vi.fn(async () => { throw false; });
    const handle = { stat, truncate: async () => {}, close };
    vi.spyOn(memory, "openResizeFile").mockResolvedValue(handle);
    const host = hostFileSystem(memory, new AbortController().signal);
    const remote = remoteFileSystem(host.description, (method, args) => host.dispatch(method, args));
    const retained = await remote.openResizeFile!("/file");
    Object.defineProperty(handle, "stat", { get() { throw new Error("late lookup"); } });
    Object.defineProperty(handle, "close", { get() { throw new Error("late lookup"); } });
    expect((await retained.stat()).type).toBe("directory");
    const closing = host.close();
    expect(host.close()).toBe(closing);
    await expect(closing).rejects.toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("bounds each retained read before invoking a provider", async () => {
    const memory = createMemoryFileSystem();
    const read = vi.fn(async (_position: number, maxBytes: number) => new Uint8Array(maxBytes));
    vi.spyOn(memory, "openReadFile").mockResolvedValue({ stat: async () => memory.stat("/"), read, close: async () => {} });
    const { host, remote } = fixture(memory);
    try {
      const retained = await remote.openReadFile!("/file");
      expect((await retained.read(0, 1024 * 1024)).length).toBe(64 * 1024);
      expect(read).toHaveBeenCalledWith(0, 64 * 1024, expect.anything());
      for (const invalid of [-1, NaN, Infinity, 1.5]) await expect(retained.read(0, invalid)).rejects.toMatchObject({ code: "EINVAL" });
      expect(read).toHaveBeenCalledTimes(1);
      await retained.close();
    } finally { await host.close(); }
  });

  it("does not turn opaque capabilities into a host shutdown drain barrier", async () => {
    const memory = createMemoryFileSystem();
    const held = deferred<FileSystem["capabilities"]>();
    const entered = deferred<void>();
    Reflect.set(memory, "capabilitiesFor", () => { entered.resolve(); return held.promise; });
    const { host, remote } = fixture(memory);
    const query = remote.capabilitiesFor!("/").catch(error => error);
    await entered.promise;
    let settled = false;
    const closing = host.close().then(() => { settled = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    try { expect(settled).toBe(true); }
    finally { held.resolve(memory.capabilities); await closing; await query; }
  });

  it.each(["stat", "read", "truncate", "seekEnd"] as const)("drains admitted %s before physical close even when the adapter does not drain", async operation => {
    const memory = createMemoryFileSystem();
    const entered = deferred<void>();
    const release = deferred<void>();
    const close = vi.fn(async () => {});
    const callbacks = {
      stat: async () => { entered.resolve(); await release.promise; return memory.stat("/"); },
      read: async () => { entered.resolve(); await release.promise; return Uint8Array.of(1); },
      truncate: async () => { entered.resolve(); await release.promise; },
      seekEnd: async () => { entered.resolve(); await release.promise; return 9223372036854775807n; },
      close
    };
    const method = operation === "read" ? "openReadFile" : "openResizeFile";
    vi.spyOn(memory, method).mockResolvedValue(callbacks);
    const { host, remote } = fixture(memory);
    try {
      const handle = await remote[method]!("/file");
      const pending = Reflect.apply(Reflect.get(handle, operation), handle, operation === "read" ? [0, 1] : operation === "truncate" ? [1] : []);
      await entered.promise;
      const closing = handle.close();
      expect(handle.close()).toBe(closing);
      await expect(handle.stat()).rejects.toMatchObject({ code: "EBADF" });
      await new Promise<void>(resolve => setImmediate(resolve));
      try { expect(close).not.toHaveBeenCalled(); }
      finally { release.resolve(); await pending; await closing; }
      expect(close).toHaveBeenCalledTimes(1);
    } finally { release.resolve(); await host.close(); }
  });

  it("enrolls retained operations before a callback reentrantly closes the host", async () => {
    const memory = createMemoryFileSystem();
    const entered = deferred<void>();
    const held = deferred<void>();
    let closing: Promise<void> | undefined;
    const close = vi.fn(async () => {});
    vi.spyOn(memory, "openResizeFile").mockResolvedValue({
      stat: async () => memory.stat("/"),
      truncate: async () => { closing = host.close(); entered.resolve(); await held.promise; },
      close
    });
    const host = hostFileSystem(memory, new AbortController().signal);
    const remote = remoteFileSystem(host.description, (method, args) => host.dispatch(method, args));
    const handle = await remote.openResizeFile!("/file");
    const pending = handle.truncate(0).catch(error => error);
    await entered.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    try { expect(close).not.toHaveBeenCalled(); }
    finally { held.resolve(); await pending; await closing; }
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("cancellation alone retires admitted resources without an explicit host close call", async () => {
    const memory = createMemoryFileSystem();
    const close = vi.fn(async () => {});
    vi.spyOn(memory, "openResizeFile").mockResolvedValue({ stat: async () => memory.stat("/"), truncate: async () => {}, close });
    const { host, controller, remote } = fixture(memory);
    const retained = await remote.openResizeFile!("/file");
    controller.abort(false);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(close).toHaveBeenCalledTimes(1);
    await retained.close();
    await host.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([false, 0, "", null, undefined, NaN])("preserves late caller cancellation %s when cleanup also fails", async reason => {
    const memory = createMemoryFileSystem();
    const entered = deferred<void>();
    const acquired = deferred<Awaited<ReturnType<NonNullable<FileSystem["openResizeFile"]>>>>();
    const close = vi.fn(async () => { throw new Error("cleanup failure"); });
    vi.spyOn(memory, "openResizeFile").mockImplementation(() => { entered.resolve(); return acquired.promise; });
    const { host, remote } = fixture(memory);
    const controller = new AbortController();
    const pending = remote.openResizeFile!("/file", { signal: controller.signal }).catch(error => error);
    await entered.promise;
    controller.abort(reason);
    acquired.resolve({ stat: async () => memory.stat("/"), truncate: async () => {}, close });
    expect(await pending).toBe(controller.signal.reason);
    expect(close).toHaveBeenCalledTimes(1);
    await host.close();
  });

  it("forwards selected capability query creation intent without promoting aggregate support", async () => {
    const memory = createMemoryFileSystem();
    const query = vi.fn(async (_path, options) => ({ retainedRead: true, retainedResize: options.create === true }));
    Reflect.set(memory, "capabilitiesFor", query);
    const guarded = new Proxy(memory, { get(target, property) {
      if (property === "capabilities") return { ...memory.capabilities, retainedResize: false };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const { host, remote } = fixture(guarded);
    try {
      expect(remote.capabilities.retainedResize).toBe(false);
      expect(remote.openResizeFile).toBeTypeOf("function");
      expect((await remote.capabilitiesFor!("/selected", { create: true })).retainedResize).toBe(true);
      expect((await remote.capabilitiesFor!("/selected", { create: false })).retainedResize).toBe(false);
      expect(query).toHaveBeenCalledWith("/selected", expect.objectContaining({ create: true, signal: expect.any(AbortSignal) }));
    } finally { await host.close(); }
  });
});

describe("execution filesystem bridge", () => {
  it("preserves filesystem error context as well as the errno code", () => {
    const error = new FsError("ENOENT", { syscall: "rename", path: "/source", dest: "/destination" });
    expect(decodeError(structuredClone(encodeError(error)))).toMatchObject({
      code: "ENOENT", syscall: "rename", path: "/source", dest: "/destination", message: error.message
    });
  });

  it("preserves binary bytes, errors, hardlinks, and clone-safe stat identity", async () => {
    const { filesystem, host, remote } = fixture();
    const bytes = new Uint8Array([0, 128, 255]);
    await remote.writeFile("/source", bytes);
    bytes.fill(42);
    expect(await remote.readFile("/source")).toEqual(new Uint8Array([0, 128, 255]));
    await remote.link!("/source", "/linked");
    const source = await remote.stat("/source");
    const linked = await remote.stat("/linked");
    expect(source.identityScope).toBeDefined();
    expect(source.identityScope).toBe(linked.identityScope);
    expect(source.ino).toBe(linked.ino);
    expect(await remote.compareEntry!("/source", remote, "/linked")).toBe("same");
    expect(await remote.compareEntry!("/source", filesystem, "/source")).toBe("unknown");
    await expect(remote.readFile("/missing")).rejects.toBeInstanceOf(FsError);
    await expect(remote.readFile("/missing")).rejects.toMatchObject({ code: "ENOENT" });
    await host.close();
  });

  it("preserves options and aborts before dispatch without cloning signals", async () => {
    const { host, remote } = fixture();
    await remote.writeFile("/file", new Uint8Array([1]), { flag: "wx" });
    await expect(remote.writeFile("/file", new Uint8Array(), { flag: "wx" })).rejects.toMatchObject({ code: "EEXIST" });
    const controller = new AbortController();
    controller.abort(new Error("caller cancellation"));
    await expect(remote.readFile("/file", { signal: controller.signal })).rejects.toThrow("caller cancellation");
    expect(await remote.readFile("/file")).toEqual(new Uint8Array([1]));
    await host.close();
  });

  it("rejects unknown methods and keeps optional capabilities absent", async () => {
    const { host } = fixture();
    await expect(host.dispatch("constructor", [])).rejects.toThrow("Unsupported filesystem operation");
    const remote = remoteFileSystem({ capabilities: {}, methods: ["readFile"] }, vi.fn());
    expect(remote.readStream).toBeUndefined();
    expect(remote.writeStream).toBeUndefined();
    expect(remote.compareEntry).toBeUndefined();
    await host.close();
  });

  it("pulls streams lazily and closes an early consumer exactly once", async () => {
    const { filesystem, controller, host } = fixture();
    await filesystem.writeFile("/file", new Uint8Array([1, 2, 3, 4]));
    await host.close();
    const readStream = vi.spyOn(filesystem, "readStream");
    const streamingHost = hostFileSystem(filesystem, controller.signal);
    const request = vi.fn((method, args) => streamingHost.dispatch(method, args));
    const remote = remoteFileSystem(streamingHost.description, request);
    const iterator = remote.readStream!("/file", { chunkSize: 2, start: 1, endExclusive: 3 })[Symbol.asyncIterator]();
    expect(readStream).not.toHaveBeenCalled();
    expect(await iterator.next()).toEqual({ done: false, value: new Uint8Array([2, 3]) });
    await iterator.return!();
    await iterator.return!();
    expect(request.mock.calls.filter(([method]) => method === "stream-close")).toHaveLength(1);
    expect(await iterator.next()).toMatchObject({ done: true });
    await streamingHost.close();
  });

  it("closes admitted stream resources when execution is terminated", async () => {
    const { filesystem, controller, host } = fixture();
    await host.close();
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    vi.spyOn(filesystem, "readStream").mockReturnValue({
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: false, value: new Uint8Array([1]) }), return: close })
    });
    const streamingHost = hostFileSystem(filesystem, controller.signal);
    const identity = await streamingHost.dispatch("stream-open", ["/file"]);
    await streamingHost.dispatch("stream-next", [identity]);
    controller.abort();
    await streamingHost.close();
    await streamingHost.close();
    expect(close).toHaveBeenCalledTimes(1);
    await expect(streamingHost.dispatch("writeFile", ["/late", new Uint8Array()])).rejects.toMatchObject({ code: "ECANCELED" });
  });

  it("bounds pending requests and waits for admitted work before closing", async () => {
    const { filesystem, host } = fixture();
    await host.close();
    let release!: (data: Uint8Array) => void;
    const blocked = new Promise<Uint8Array>((resolve) => { release = resolve; });
    vi.spyOn(filesystem, "readFile").mockReturnValue(blocked);
    const bounded = hostFileSystem(filesystem, new AbortController().signal);
    const requests = Array.from({ length: 64 }, () => bounded.dispatch("readFile", ["/file"]));
    await expect(bounded.dispatch("readFile", ["/file"])).rejects.toThrow("request limit");
    let closed = false;
    const closing = bounded.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    release(new Uint8Array([1]));
    await Promise.all(requests);
    await closing;
    expect(closed).toBe(true);
  });

  it("preserves guarded streaming writes and closes the producer on failure", async () => {
    const { filesystem, host, remote } = fixture();
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    const append = vi.spyOn(filesystem, "appendFile").mockRejectedValue(new Error("workspace exhausted"));
    await expect(remote.writeStream!("/file", {
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: false, value: new Uint8Array([1]) }), return: close })
    })).rejects.toThrow("workspace exhausted");
    expect(append).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(await filesystem.readFile("/file")).toEqual(new Uint8Array());
    await host.close();
  });
});
