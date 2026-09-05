import { describe, expect, it, vi } from "vitest";
import { MemoryFileSystem, MountFileSystem, ReadOnlyFileSystem, openFileDescriptor } from "../src/core.js";
import type { DescriptorBackend, FileDescriptor, FileDescriptorCapabilities, OpenFileOptions } from "../src/core.js";

const capabilities: FileDescriptorCapabilities = {
  position: true, positionedRead: true, positionedWrite: true, truncate: false, synchronization: "none",
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(accept => { resolve = accept; });
  return { promise, resolve };
}

function fixture() {
  const resource = { bytes: [10, 20, 30, 40], position: 2, live: true };
  const positions: (number | null)[] = [];
  const close = vi.fn(async () => { resource.live = false; });
  const write = vi.fn(async (current: typeof resource, buffer: Uint8Array, position: number | null) => {
    expect(current.live).toBe(true);
    positions.push(position);
    const offset = position ?? current.bytes.length;
    const count = Math.min(buffer.length, 2);
    current.bytes.splice(offset, count, ...buffer.subarray(0, count));
    if (position === null) current.position = offset + count;
    return count;
  });
  const backend: DescriptorBackend<typeof resource> = {
    resource,
    async getPosition(current) { return current.position; },
    async stat() { return { type: "file", size: resource.bytes.length, mode: 0o100600, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 }; },
    async read() { throw new Error("unexpected read"); },
    write,
    async truncate() { throw new Error("unexpected truncate"); },
    async sync() { throw new Error("unexpected sync"); },
    close,
  };
  return { backend, resource, positions, write, close };
}

describe("independent positioned append review", () => {
  it.each([false, true])("uses the acquired backend opt-in instead of admission opt-in=%s", async admitted => {
    const { backend, resource, write, close } = fixture();
    const selected = { ...capabilities, positionedAppendWrite: !admitted };
    const getter = vi.fn(() => selected);
    Object.defineProperty(backend, "capabilities", { get: getter });
    const descriptor = await openFileDescriptor("/file", { access: "write", append: true }, {
      ...capabilities, positionedAppendWrite: admitted,
    }, async () => backend);
    selected.positionedAppendWrite = admitted;
    selected.positionedWrite = false;
    try {
      expect(getter).toHaveBeenCalledTimes(1);
      expect(Object.isFrozen(descriptor.capabilities)).toBe(true);
      expect(descriptor.capabilities.positionedAppendWrite).toBe(!admitted);
      expect(descriptor.capabilities.positionedWrite).toBe(!admitted);
      if (admitted) {
        await expect(descriptor.write(Uint8Array.of(99), 0)).rejects.toMatchObject({ code: "EINVAL" });
        expect(write).not.toHaveBeenCalled();
      } else {
        expect(await descriptor.write(Uint8Array.of(99), 0)).toBe(1);
        expect(resource.bytes).toEqual([99, 20, 30, 40]);
      }
      expect(await descriptor.getPosition!()).toBe(2);
    } finally { await descriptor.close(); }
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("snapshots a false getter before acquisition mutates the original capability", async () => {
    const { backend, write } = fixture();
    let enabled = false;
    const getter = vi.fn(() => enabled);
    const selected = { ...capabilities };
    Object.defineProperty(selected, "positionedAppendWrite", { enumerable: true, get: getter });
    const descriptor = await openFileDescriptor("/file", { access: "write", append: true }, selected, async () => {
      enabled = true;
      return backend;
    });
    try {
      expect(getter).toHaveBeenCalledTimes(1);
      expect(descriptor.capabilities.positionedAppendWrite).toBe(false);
      await expect(descriptor.write(new Uint8Array(), 0)).rejects.toMatchObject({ code: "EINVAL" });
      expect(write).not.toHaveBeenCalled();
    } finally { await descriptor.close(); }
  });

  it.each(["admission", "selected"] as const)("does not publish a resource when the %s capability getter cancels acquisition", async phase => {
    const { backend, close, resource } = fixture();
    const controller = new AbortController();
    const selected = { ...capabilities };
    Object.defineProperty(selected, "positionedAppendWrite", {
      enumerable: true,
      get() { controller.abort(false); return true; },
    });
    if (phase === "selected") Object.defineProperty(backend, "capabilities", { value: selected });
    const cleanupStarted = deferred<void>();
    const cleanupRelease = deferred<void>();
    backend.close = async () => {
      cleanupStarted.resolve();
      await cleanupRelease.promise;
      await close();
    };
    let published: FileDescriptor | undefined;
    let settled = false;
    const opening = openFileDescriptor("/file", { access: "write", append: true, signal: controller.signal },
      phase === "admission" ? selected : capabilities, async () => backend);
    const outcome = opening.then(value => {
      published = value;
      settled = true;
      return { state: "published", value };
    }, error => {
      settled = true;
      return { state: "rejected", error };
    });
    try {
      expect(await Promise.race([outcome, cleanupStarted.promise.then(() => ({ state: "cleanup" }))]))
        .toEqual({ state: "cleanup" });
      expect(settled).toBe(false);
      cleanupRelease.resolve();
      expect(await outcome).toEqual({ state: "rejected", error: false });
      expect(close).toHaveBeenCalledTimes(1);
      expect(resource.live).toBe(false);
    } finally {
      cleanupRelease.resolve();
      await outcome;
      await published?.close();
    }
  });

  it.each([1n, Symbol("true"), () => true])("rejects invalid opt-in %s before acquisition and closes invalid acquired backends", async invalid => {
    const { backend, close, resource } = fixture();
    const selected = { ...capabilities };
    Reflect.set(selected, "positionedAppendWrite", invalid);
    const acquire = vi.fn(async () => backend);
    await expect(openFileDescriptor("/file", { access: "write", append: true }, selected, acquire))
      .rejects.toMatchObject({ code: "EINVAL", syscall: "open" });
    expect(acquire).not.toHaveBeenCalled();
    Object.defineProperty(backend, "capabilities", { value: selected });
    backend.close = async current => { await close(); expect(current).toBe(resource); throw false; };
    await expect(openFileDescriptor("/file", { access: "write", append: true }, capabilities, acquire))
      .rejects.toMatchObject({ code: "EINVAL", syscall: "open" });
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(resource.live).toBe(false);
  });

  it.each([undefined, null, false, 0, ""])("preserves acquired capability getter rejection %j while draining cleanup", async reason => {
    const { backend, close, resource } = fixture();
    const selected = { ...capabilities };
    Object.defineProperty(selected, "positionedAppendWrite", { enumerable: true, get() { throw reason; } });
    Object.defineProperty(backend, "capabilities", { value: selected });
    const cleanupStarted = deferred<void>();
    const cleanupRelease = deferred<void>();
    backend.close = async () => {
      cleanupStarted.resolve();
      await cleanupRelease.promise;
      await close();
      throw new Error("secondary cleanup failure");
    };
    let settled = false;
    const opening = openFileDescriptor("/file", { access: "write", append: true }, capabilities, async () => backend);
    const outcome = opening.then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    await cleanupStarted.promise;
    expect(settled).toBe(false);
    cleanupRelease.resolve();
    expect(await outcome).toEqual({ error: reason });
    expect(close).toHaveBeenCalledTimes(1);
    expect(resource.live).toBe(false);
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])("does not relax offset validation for %s, including zero-byte writes", async offset => {
    const { backend, write } = fixture();
    const descriptor = await openFileDescriptor("/file", { access: "write", append: true }, {
      ...capabilities, positionedAppendWrite: true,
    }, async () => backend);
    try {
      for (const bytes of [new Uint8Array(), Uint8Array.of(99)]) {
        await expect(descriptor.write(bytes, offset)).rejects.toMatchObject({ code: "EINVAL", syscall: "write" });
      }
      expect(write).not.toHaveBeenCalled();
      expect(await descriptor.getPosition!()).toBe(2);
    } finally { await descriptor.close(); }
  });

  it("forwards partial positioned writes once and leaves sequential append cursor semantics to the provider", async () => {
    const { backend, resource, positions, write } = fixture();
    const descriptor = await openFileDescriptor("/file", { access: "readwrite", append: true }, {
      ...capabilities, positionedAppendWrite: true,
    }, async () => backend);
    try {
      expect(await descriptor.write(Uint8Array.of(99, 98, 97), 0)).toBe(2);
      expect(resource.bytes).toEqual([99, 98, 30, 40]);
      expect(await descriptor.getPosition!()).toBe(2);
      expect(write).toHaveBeenCalledTimes(1);
      resource.bytes.push(50);
      expect(await descriptor.write(Uint8Array.of(60, 70, 80), null)).toBe(2);
      expect(resource.bytes).toEqual([99, 98, 30, 40, 50, 60, 70]);
      expect(await descriptor.getPosition!()).toBe(7);
      expect(positions).toEqual([0, null]);
    } finally { await descriptor.close(); }
  });

  it.each([0, -1, 0.5, 4])("does not retry backend count %s or invent cursor movement", async count => {
    const { backend, resource } = fixture();
    const write = vi.fn(async () => count);
    backend.write = write;
    const descriptor = await openFileDescriptor("/file", { access: "write", append: true }, {
      ...capabilities, positionedAppendWrite: true,
    }, async () => backend);
    try {
      const writing = descriptor.write(Uint8Array.of(1, 2, 3), 0);
      if (count === 0) expect(await writing).toBe(0);
      else await expect(writing).rejects.toMatchObject({ code: "EIO", syscall: "write" });
      expect(write).toHaveBeenCalledTimes(1);
      expect(resource.position).toBe(2);
      expect(resource.bytes).toEqual([10, 20, 30, 40]);
    } finally { await descriptor.close(); }
  });

  it.each([null, false, 0, ""])("preserves cancellation %j after a partial write without rollback or retry", async reason => {
    const { backend, resource, write, close } = fixture();
    const controller = new AbortController();
    backend.write = async (current, bytes, position, options) => {
      expect(options.signal).toBe(controller.signal);
      const count = await write(current, bytes, position);
      controller.abort(reason);
      return count;
    };
    const descriptor = await openFileDescriptor("/file", { access: "write", append: true }, {
      ...capabilities, positionedAppendWrite: true,
    }, async () => backend);
    const writing = descriptor.write(Uint8Array.of(99, 98, 97), 0, { signal: controller.signal });
    const closing = descriptor.close();
    await expect(writing).rejects.toBe(reason);
    await closing;
    expect(write).toHaveBeenCalledTimes(1);
    expect(resource.bytes).toEqual([99, 98, 30, 40]);
    expect(resource.position).toBe(2);
    expect(resource.live).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("drains synchronously admitted writes when the provider reenters close, skipping queued cancellation", async () => {
    const { backend, write, positions, close, resource } = fixture();
    const started = deferred<void>();
    const release = deferred<void>();
    let closing: Promise<void> | undefined;
    backend.write = async (current, bytes, position) => {
      if (position === 0) {
        closing = descriptor.close();
        started.resolve();
        await release.promise;
      }
      return write(current, bytes, position);
    };
    const descriptor = await openFileDescriptor("/file", { access: "write", append: true }, {
      ...capabilities, positionedAppendWrite: true,
    }, async () => backend);
    const controller = new AbortController();
    const first = descriptor.write(Uint8Array.of(99), 0);
    const canceled = expect(descriptor.write(Uint8Array.of(88), 1, { signal: controller.signal })).rejects.toBe(false);
    const last = descriptor.write(Uint8Array.of(77), 2);
    await started.promise;
    controller.abort(false);
    expect(descriptor.close()).toBe(closing);
    expect(close).not.toHaveBeenCalled();
    const refused = expect(descriptor.write(new Uint8Array(), 0)).rejects.toMatchObject({ code: "EBADF" });
    release.resolve();
    expect(await first).toBe(1);
    await canceled;
    expect(await last).toBe(1);
    await refused;
    await closing;
    expect(positions).toEqual([0, 2]);
    expect(resource.bytes).toEqual([99, 20, 77, 40]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(resource.live).toBe(false);
  });

  it.each(["mount", "mount-readonly", "readonly-mount"] as const)("%s retains or masks the acquired capability without reopening after unlink", async wrapper => {
    const { backend, write, close, resource } = fixture();
    const source = new MemoryFileSystem();
    await source.writeFile("/file", Uint8Array.of(10));
    const open = vi.fn(async (path: string, options: OpenFileOptions) => openFileDescriptor(path, options, {
      ...capabilities, positionedAppendWrite: true,
    }, async () => backend));
    Object.defineProperty(source, "open", { value: open });
    const mount = new MountFileSystem({ root: new MemoryFileSystem(), mounts: {
      "/volume": wrapper === "mount-readonly" ? new ReadOnlyFileSystem(source) : source,
    } });
    const filesystem = wrapper === "readonly-mount" ? new ReadOnlyFileSystem(mount) : mount;
    const writable = wrapper === "mount";
    const descriptor = await filesystem.open("/volume/file", writable ? { access: "write", append: true } : { access: "read" });
    try {
      await source.rm("/file");
      expect(descriptor.capabilities.positionedAppendWrite).toBe(writable);
      expect(descriptor.capabilities.positionedWrite).toBe(writable);
      if (writable) {
        expect(await descriptor.write(Uint8Array.of(99, 98, 97), 0)).toBe(2);
        expect(write).toHaveBeenCalledTimes(1);
        expect(resource.bytes).toEqual([99, 98, 30, 40]);
      } else {
        await expect(descriptor.write(Uint8Array.of(99), 0)).rejects.toMatchObject({ code: "EBADF" });
        expect(write).not.toHaveBeenCalled();
      }
      expect(await descriptor.getPosition!()).toBe(2);
      expect(open).toHaveBeenCalledTimes(1);
    } finally { await descriptor.close(); }
    expect(close).toHaveBeenCalledTimes(1);
    expect(resource.live).toBe(false);
  });
});
