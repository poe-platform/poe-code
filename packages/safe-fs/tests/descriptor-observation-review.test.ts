import { describe, expect, it, vi } from "vitest";
import * as core from "../src/core.js";
import * as publicApi from "../src/index.js";
import type { DescriptorBackend, FileDescriptor, FileDescriptorCapabilities, OpenFileOptions } from "../src/core.js";
import { forwardFileDescriptor, openFileDescriptor } from "../src/fs/descriptor.js";

const legacyCapabilities: FileDescriptorCapabilities = {
  positionedRead: false, positionedWrite: false, truncate: false, synchronization: "none",
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(accept => { resolve = accept; });
  return { promise, resolve };
}

function fixture() {
  const resource = { bytes: Uint8Array.of(0, 255, 65), position: 0 };
  const events: string[] = [];
  const read = vi.fn(async (current: typeof resource, buffer: Uint8Array) => {
    const bytes = current.bytes.subarray(current.position, current.position + buffer.length);
    buffer.set(bytes);
    current.position += bytes.length;
    events.push("read");
    return bytes.length;
  });
  const close = vi.fn(async () => { events.push("close"); });
  const truncate = vi.fn(async () => {});
  const backend: DescriptorBackend<typeof resource> = {
    resource,
    async getPosition(current) { return current.position; },
    async probeRead(current) {
      expect(this).toBe(backend);
      expect(current).toBe(resource);
      events.push("probe");
      return "ready";
    },
    async stat() { return { type: "file", size: 3, mode: 0o100600, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 }; },
    read,
    async write(_current, bytes) { return bytes.length; },
    truncate,
    async sync() {},
    close,
  };
  return { backend, resource, events, read, close, truncate };
}

describe("independent descriptor observation review", () => {
  it.each(["ready", "blocked", "unknown"] as const)("observes %s between reads without consuming bytes or moving the cursor", async readiness => {
    const { backend, resource, read } = fixture();
    backend.probeRead = async () => readiness;
    const descriptor = await core.openFileDescriptor("/input", { access: "read" }, {
      ...legacyCapabilities, position: true, readObservation: true,
    }, async () => backend);
    try {
      const first = new Uint8Array(1);
      await descriptor.read(first, null);
      expect([...first]).toEqual([0]);
      expect(await descriptor.getPosition!()).toBe(1);
      expect(await descriptor.probeRead!()).toBe(readiness);
      expect(await descriptor.probeRead!()).toBe(readiness);
      expect(await descriptor.getPosition!()).toBe(1);
      expect(resource.position).toBe(1);
      expect(read).toHaveBeenCalledTimes(1);
      const rest = new Uint8Array(2);
      expect(await descriptor.read(rest, null)).toBe(2);
      expect([...rest]).toEqual([255, 65]);
    } finally { await descriptor.close(); }
  });

  it.each([["core", core], ["root", publicApi]] as const)("%s exports the implementation itself and grants observation, not read or ftruncate", async (_name, surface) => {
    expect(surface.openFileDescriptor).toBe(openFileDescriptor);
    const { backend, read, truncate, close } = fixture();
    const acquire = vi.fn(async (options: OpenFileOptions) => {
      expect(options.truncate).toBe(true);
      expect(Object.isFrozen(options)).toBe(true);
      return backend;
    });
    const descriptor = await surface.openFileDescriptor("/input", { access: "write", truncate: true }, {
      ...legacyCapabilities, readObservation: true, openTruncate: true,
    }, acquire);
    try {
      expect(Object.isFrozen(descriptor.capabilities)).toBe(true);
      expect(await descriptor.probeRead!()).toBe("ready");
      await expect(descriptor.read(new Uint8Array(0), null)).rejects.toMatchObject({ code: "EBADF", syscall: "read" });
      await expect(descriptor.read(new Uint8Array(1), null)).rejects.toMatchObject({ code: "EBADF", syscall: "read" });
      await expect(descriptor.truncate(0)).rejects.toMatchObject({ code: "ENOTSUP", syscall: "ftruncate" });
      expect(read).not.toHaveBeenCalled();
      expect(truncate).not.toHaveBeenCalled();
      expect(acquire).toHaveBeenCalledTimes(1);
    } finally { await descriptor.close(); }
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, false])("does not inspect an unadvertised method or promote capability %s", async readObservation => {
    const { backend, close } = fixture();
    const getter = vi.fn(() => { throw new Error("unadvertised method"); });
    Object.defineProperty(backend, "probeRead", { get: getter });
    const capabilities = { ...legacyCapabilities, ...(readObservation === undefined ? {} : { readObservation }) };
    const descriptor = await core.openFileDescriptor("/input", { access: "read" }, capabilities, async () => backend);
    try {
      expect(descriptor.capabilities).toEqual(capabilities);
      expect(Object.hasOwn(descriptor.capabilities, "openTruncate")).toBe(false);
      expect(Object.hasOwn(descriptor.capabilities, "readObservation")).toBe(readObservation !== undefined);
      await expect(descriptor.probeRead!()).rejects.toMatchObject({ code: "ENOTSUP" });
      expect(() => forwardFileDescriptor(descriptor, async (_syscall, _options, action) => action(), {
        ...capabilities, readObservation: true,
      })).toThrowError(expect.objectContaining({ code: "ENOTSUP" }));
      expect(getter).not.toHaveBeenCalled();
    } finally { await descriptor.close(); }
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null, false, "ready"])("refuses advertised non-method %j and cleans up exactly once", async method => {
    const { backend, close } = fixture();
    Object.defineProperty(backend, "probeRead", { value: method });
    await expect(core.openFileDescriptor("/input", { access: "read" }, {
      ...legacyCapabilities, readObservation: true,
    }, async () => backend)).rejects.toMatchObject({ code: "ENOTSUP", syscall: "probeRead" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("captures backend and forwarded methods and their receivers before replacement", async () => {
    const { backend, events } = fixture();
    const original = backend.probeRead!;
    const backendGetter = vi.fn(() => original);
    Object.defineProperty(backend, "probeRead", { configurable: true, get: backendGetter });
    const source = await core.openFileDescriptor("/input", { access: "read" }, {
      ...legacyCapabilities, readObservation: true,
    }, async () => backend);
    const sourceProbe = source.probeRead!;
    const sourceGetter = vi.fn(() => sourceProbe);
    Object.defineProperty(source, "probeRead", { configurable: true, get: sourceGetter });
    const forwarded = forwardFileDescriptor(source, async (_syscall, _options, action) => action());
    const replacement = vi.fn(async () => { throw new Error("replacement called"); });
    Object.defineProperty(backend, "probeRead", { value: replacement });
    Object.defineProperty(source, "probeRead", { value: replacement });
    const alias = await core.openFileDescriptor("/alias", { access: "read" }, legacyCapabilities, async () => forwarded);
    try {
      expect(await alias.probeRead!()).toBe("ready");
      expect(await alias.probeRead!()).toBe("ready");
      expect(backendGetter).toHaveBeenCalledTimes(1);
      expect(sourceGetter).toHaveBeenCalledTimes(1);
      expect(replacement).not.toHaveBeenCalled();
      expect(events).toEqual(["probe", "probe"]);
    } finally { await alias.close(); }
  });

  it.each(["READY", "eof", null, false, 0, undefined, { state: "ready" }])("rejects malformed result %j without poisoning admitted work", async result => {
    const { backend, close } = fixture();
    Object.defineProperty(backend, "probeRead", { value: async () => result });
    const descriptor = await core.openFileDescriptor("/input", { access: "read" }, {
      ...legacyCapabilities, readObservation: true,
    }, async () => backend);
    const probe = descriptor.probeRead!();
    const stat = descriptor.stat();
    const closing = descriptor.close();
    await expect(probe).rejects.toMatchObject({ code: "EIO", syscall: "probeRead", path: "/input" });
    expect((await stat).size).toBe(3);
    await closing;
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null, false, 0, ""])("preserves falsey provider rejection %j through close drain", async reason => {
    const { backend, close } = fixture();
    backend.probeRead = async () => { throw reason; };
    const descriptor = await core.openFileDescriptor("/input", { access: "read" }, {
      ...legacyCapabilities, readObservation: true,
    }, async () => backend);
    const probe = descriptor.probeRead!();
    const closing = descriptor.close();
    await expect(probe).rejects.toBe(reason);
    await closing;
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([null, false, 0, ""])("cancellation %j wins over successful in-flight observation and drains before close", async reason => {
    const { backend, close } = fixture();
    const started = deferred<void>();
    const release = deferred<"ready">();
    const controller = new AbortController();
    backend.probeRead = async (_resource, options) => {
      expect(options.signal).toBe(controller.signal);
      started.resolve();
      return release.promise;
    };
    const descriptor = await core.openFileDescriptor("/input", { access: "read" }, {
      ...legacyCapabilities, readObservation: true,
    }, async () => backend);
    const probe = descriptor.probeRead!({ signal: controller.signal });
    const outcome = expect(probe).rejects.toBe(reason);
    await started.promise;
    controller.abort(reason);
    const closing = descriptor.close();
    await Promise.resolve();
    expect(close).not.toHaveBeenCalled();
    release.resolve("ready");
    await outcome;
    await closing;
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("admits probes synchronously and drains both when the first source probe reenters close", async () => {
    const { backend, events, close } = fixture();
    const started = deferred<void>();
    const release = deferred<void>();
    let reentrantClose: Promise<void> | undefined;
    let invocations = 0;
    backend.probeRead = async () => {
      invocations++;
      events.push(`probe${invocations}`);
      if (invocations === 1) {
        reentrantClose = descriptor.close();
        started.resolve();
        await release.promise;
      }
      return "ready";
    };
    const descriptor: FileDescriptor = await core.openFileDescriptor("/input", { access: "read" }, {
      ...legacyCapabilities, readObservation: true,
    }, async () => backend);
    const first = descriptor.probeRead!();
    const second = descriptor.probeRead!();
    expect(events).toEqual([]);
    await started.promise;
    expect(descriptor.close()).toBe(reentrantClose);
    const refused = expect(descriptor.probeRead!()).rejects.toMatchObject({ code: "EBADF", syscall: "probeRead" });
    expect(close).not.toHaveBeenCalled();
    release.resolve();
    expect(await first).toBe("ready");
    expect(await second).toBe("ready");
    await refused;
    await reentrantClose;
    expect(events).toEqual(["probe1", "probe2", "close"]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("skips canceled queued observation while draining a later admitted probe", async () => {
    const { backend, events, close } = fixture();
    const started = deferred<void>();
    const release = deferred<void>();
    const read = backend.read;
    backend.read = async (resource, buffer, position, options) => {
      started.resolve();
      await release.promise;
      return read(resource, buffer, position, options);
    };
    const descriptor = await core.openFileDescriptor("/input", { access: "read" }, {
      ...legacyCapabilities, readObservation: true,
    }, async () => backend);
    const reading = descriptor.read(new Uint8Array(1), null);
    await started.promise;
    const controller = new AbortController();
    const canceled = expect(descriptor.probeRead!({ signal: controller.signal })).rejects.toBe("");
    const retained = descriptor.probeRead!();
    const closing = descriptor.close();
    controller.abort("");
    expect(close).not.toHaveBeenCalled();
    release.resolve();
    await reading;
    await canceled;
    expect(await retained).toBe("ready");
    await closing;
    expect(events).toEqual(["read", "probe", "close"]);
  });

  describe.each(["readonly-mount", "mount-readonly"] as const)("%s forwarding", composition => {
    it.each([undefined, false, true])("retains observation=%s without promotion, reopen or byte consumption", async readObservation => {
      const source = new core.MemoryFileSystem();
      await source.writeFile("/input", Uint8Array.of(1));
      const { backend, read, close, resource } = fixture();
      const capabilities = { ...legacyCapabilities, ...(readObservation === undefined ? {} : { readObservation }) };
      const open = vi.fn(async (path: string, options: OpenFileOptions) => core.openFileDescriptor(path, options, capabilities, async () => backend));
      Object.defineProperty(source, "open", { value: open });
      const mount = new core.MountFileSystem({
        root: new core.MemoryFileSystem(),
        mounts: { "/volume": composition === "mount-readonly" ? new core.ReadOnlyFileSystem(source) : source },
      });
      const filesystem = composition === "readonly-mount" ? new core.ReadOnlyFileSystem(mount) : mount;
      const descriptor = await filesystem.open("/volume/input", { access: "read" });
      try {
        await source.rm("/input");
        expect(descriptor.capabilities).toEqual(capabilities);
        expect(Object.hasOwn(descriptor.capabilities, "readObservation")).toBe(readObservation !== undefined);
        expect(Object.hasOwn(descriptor.capabilities, "openTruncate")).toBe(false);
        if (readObservation) expect(await descriptor.probeRead!()).toBe("ready");
        else await expect(descriptor.probeRead!()).rejects.toMatchObject({ code: "ENOTSUP" });
        expect(open).toHaveBeenCalledTimes(1);
        expect(read).not.toHaveBeenCalled();
        expect(resource.position).toBe(0);
      } finally { await descriptor.close(); }
      expect(close).toHaveBeenCalledTimes(1);
    });
  });
});
