import { describe, expect, it, vi } from "vitest";
import type { FileDescriptor, FileStat, OpenFileOptions } from "../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { FileSystemQuotaError, withFileSystemQuota } from "../src/fs/quota/index.js";

const bytes = (text: string) => new TextEncoder().encode(text);

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

async function fixture(maxBytes = 6, options: OpenFileOptions = { access: "readwrite" }) {
  const source = new MemoryFileSystem();
  await source.writeFile("/file", bytes("abc"));
  const retained = await source.open("/file", options);
  const acquire = vi.spyOn(source, "open").mockResolvedValueOnce(retained);
  const quota = withFileSystemQuota(source, { maxBytes });
  return { source, retained, acquire, quota };
}

describe("quota descriptor acquisition review", () => {
  it.each(["open", "capabilitiesFor", "capabilities"])("preserves a throwing filesystem %s getter and releases admission", async property => {
    const source = new MemoryFileSystem();
    await source.writeFile("/file", bytes("abc"));
    const original = Object.getOwnPropertyDescriptor(source, property);
    const failure = new Error(`${property} getter failed`);
    const quota = withFileSystemQuota(source, { maxBytes: 4 });
    Object.defineProperty(source, property, { configurable: true, get() { throw failure; } });
    try {
      await expect(quota.open!("/file", { access: "readwrite" })).rejects.toBe(failure);
    } finally {
      if (original) Object.defineProperty(source, property, original);
      else Reflect.deleteProperty(source, property);
    }
    const descriptor = await quota.open!("/file", { access: "readwrite" });
    try {
      await descriptor.write(bytes("d"), 3);
      expect(await source.readFile("/file")).toEqual(bytes("abcd"));
    } finally { await descriptor.close(); }
  });

  it("does not acquire when reading the open capability cancels admission", async () => {
    const source = new MemoryFileSystem();
    const controller = new AbortController();
    const acquire = vi.spyOn(source, "open");
    Object.defineProperty(source, "capabilities", {
      value: { ...source.capabilities, get open() { controller.abort(false); return true; } },
    });
    const quota = withFileSystemQuota(source, { maxBytes: 3 });
    await expect(quota.open!("/new", {
      access: "write", creation: "exclusive", signal: controller.signal,
    })).rejects.toBe(false);
    expect(acquire).not.toHaveBeenCalled();
    await expect(source.stat("/new")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["capabilities", "getPosition", "probeRead"])("drains cleanup after a retained %s getter throws", async property => {
    const { retained, quota } = await fixture();
    const failure = new Error(`${property} getter failed`);
    const cleanupFailure = new Error("cleanup failed");
    const entered = deferred<void>();
    const release = deferred<void>();
    const close = retained.close.bind(retained);
    const closing = vi.spyOn(retained, "close").mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      await close();
      throw cleanupFailure;
    });
    if (property === "probeRead") {
      Object.defineProperty(retained, "capabilities", { value: { ...retained.capabilities, readObservation: true }, configurable: true });
    }
    Object.defineProperty(retained, property, { configurable: true, get() { throw failure; } });
    let settled = false;
    const outcome = quota.open!("/file", { access: "readwrite" }).then(
      value => { settled = true; return { value }; },
      error => { settled = true; return { error }; },
    );
    try {
      await entered.promise;
      expect(settled).toBe(false);
    } finally {
      release.resolve();
      await outcome;
    }
    expect(await outcome).toEqual({ error: failure });
    expect(closing).toHaveBeenCalledTimes(1);
    await expect(retained.stat()).rejects.toMatchObject({ code: "EBADF" });
    const recovered = await quota.open!("/file", { access: "read" });
    await recovered.close();
  });

  it("waits for acquired identity metadata and cleanup before reporting late cancellation", async () => {
    const { retained, quota } = await fixture();
    const stat = await retained.stat();
    const entered = deferred<void>();
    const metadata = deferred<FileStat>();
    const cleanupEntered = deferred<void>();
    const cleanupRelease = deferred<void>();
    const controller = new AbortController();
    vi.spyOn(retained, "stat").mockImplementationOnce(() => { entered.resolve(); return metadata.promise; });
    const close = retained.close.bind(retained);
    const closing = vi.spyOn(retained, "close").mockImplementation(async () => {
      cleanupEntered.resolve();
      await cleanupRelease.promise;
      await close();
      throw new Error("late close failed");
    });
    let settled = false;
    const outcome = quota.open!("/file", { access: "readwrite", signal: controller.signal }).then(
      value => { settled = true; return { value }; },
      error => { settled = true; return { error }; },
    );
    try {
      await entered.promise;
      controller.abort(null);
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(closing).not.toHaveBeenCalled();
      metadata.resolve(stat);
      await cleanupEntered.promise;
      expect(settled).toBe(false);
    } finally {
      metadata.resolve(stat);
      cleanupRelease.resolve();
      await outcome;
    }
    expect(await outcome).toEqual({ error: null });
    expect(closing).toHaveBeenCalledTimes(1);
  });
});

describe("quota descriptor cancellation and failure review", () => {
  it.each(["readdir", "lstat"])("canceled %s census releases the descriptor before opaque metadata finishes", async method => {
    const { source, retained, quota } = await fixture();
    const descriptor = await quota.open!("/file", { access: "readwrite" });
    const entered = deferred<void>();
    const release = deferred<void>();
    const original = source[method].bind(source);
    const metadata = vi.spyOn(source, method).mockImplementationOnce(async (...args: Parameters<typeof original>) => {
      const result = await Reflect.apply(original, source, args);
      entered.resolve();
      await release.promise;
      return result;
    });
    const write = vi.spyOn(retained, "write");
    const close = vi.spyOn(retained, "close");
    const controller = new AbortController();
    const outcome = descriptor.write(bytes("d"), 3, { signal: controller.signal }).then(
      value => ({ value }), error => ({ error }),
    );
    await entered.promise;
    controller.abort(false);
    const closing = descriptor.close();
    let drained = false;
    try {
      drained = await Promise.race([
        Promise.all([outcome, closing]).then(() => true),
        new Promise<false>(resolve => setImmediate(() => resolve(false))),
      ]);
    } finally {
      release.resolve();
      await metadata.mock.results[0].value;
      await closing;
    }
    expect(drained).toBe(true);
    expect(await outcome).toEqual({ error: false });
    expect(write).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(await source.readFile("/file")).toEqual(bytes("abc"));
    await quota.writeFile("/other", bytes("def"));
  });

  it("close drains already-dispatched writes without rolling back late canceled effects", async () => {
    const { source, retained, quota } = await fixture(4);
    const descriptor = await quota.open!("/file", { access: "readwrite" });
    const entered = deferred<void>();
    const release = deferred<void>();
    const events: string[] = [];
    const write = retained.write.bind(retained);
    vi.spyOn(retained, "write").mockImplementationOnce(async (buffer, position) => {
      events.push("write-start");
      entered.resolve();
      await release.promise;
      const count = await write(buffer, position);
      events.push("write-end");
      return count;
    });
    const close = retained.close.bind(retained);
    const closingSpy = vi.spyOn(retained, "close").mockImplementation(async () => {
      events.push("close");
      await close();
    });
    const controller = new AbortController();
    let settled = false;
    const outcome = descriptor.write(bytes("d"), null, { signal: controller.signal }).then(
      value => { settled = true; return { value }; },
      error => { settled = true; return { error }; },
    );
    await entered.promise;
    controller.abort(0);
    const closing = descriptor.close();
    try {
      expect(descriptor.close()).toBe(closing);
      await expect(descriptor.write(bytes("e"), null)).rejects.toMatchObject({ code: "EBADF" });
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(closingSpy).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      await Promise.all([outcome, closing]);
    }
    expect(await outcome).toEqual({ error: 0 });
    expect(events).toEqual(["write-start", "write-end", "close"]);
    expect(closingSpy).toHaveBeenCalledTimes(1);
    expect(await source.readFile("/file")).toEqual(bytes("dbc"));
    await quota.writeFile("/other", bytes("e"));
  });

  it.each(["write", "truncate"])("a failed backend %s growth preserves bytes, identity, and cursor without reserving quota", async operation => {
    const { source, retained, quota } = await fixture(4);
    const descriptor = await quota.open!("/file", { access: "readwrite" });
    try {
      await descriptor.read(new Uint8Array(3), null);
      const before = await descriptor.stat();
      const failure = new Error("backend growth refused");
      vi.spyOn(retained, operation).mockRejectedValueOnce(failure);
      const growth = operation === "write" ? descriptor.write(bytes("d"), null) : descriptor.truncate(4);
      await expect(growth).rejects.toBe(failure);
      expect(await descriptor.stat()).toEqual(before);
      expect(await descriptor.getPosition!()).toBe(3);
      expect(await source.readFile("/file")).toEqual(bytes("abc"));
      await quota.writeFile("/other", bytes("e"));
      await expect(descriptor.truncate(4)).rejects.toBeInstanceOf(FileSystemQuotaError);
      expect(await source.readFile("/other")).toEqual(bytes("e"));
    } finally { await descriptor.close(); }
  });
});

const invalidMetadata = [
  { label: "missing scope", field: "identityScope", value: undefined, code: "ENOTSUP" },
  { label: "null scope", field: "identityScope", value: null, code: "ENOTSUP" },
  { label: "primitive scope", field: "identityScope", value: "scope", code: "ENOTSUP" },
  { label: "missing device", field: "dev", value: undefined, code: "ENOTSUP" },
  { label: "negative device", field: "dev", value: -1, code: "ENOTSUP" },
  { label: "fractional device", field: "dev", value: 0.5, code: "ENOTSUP" },
  { label: "missing inode", field: "ino", value: undefined, code: "ENOTSUP" },
  { label: "unsafe inode", field: "ino", value: Number.MAX_SAFE_INTEGER + 1, code: "ENOTSUP" },
  { label: "nonfinite inode", field: "ino", value: NaN, code: "ENOTSUP" },
  { label: "non-file type", field: "type", value: "directory", code: "ENOTSUP" },
  { label: "negative size", field: "size", value: -1, code: "EIO" },
  { label: "fractional size", field: "size", value: 3.5, code: "EIO" },
  { label: "unsafe size", field: "size", value: Number.MAX_SAFE_INTEGER + 1, code: "EIO" },
];

describe("quota descriptor retained identity review", () => {
  it.each(invalidMetadata)("rejects $label on acquisition and closes exactly once", async ({ field, value, code }) => {
    const { source, retained, quota } = await fixture();
    const stat = await retained.stat();
    vi.spyOn(retained, "stat").mockResolvedValueOnce({ ...stat, [field]: value });
    const close = vi.spyOn(retained, "close");
    await expect(quota.open!("/file", { access: "readwrite" })).rejects.toMatchObject({ code });
    expect(close).toHaveBeenCalledTimes(1);
    expect(await source.readFile("/file")).toEqual(bytes("abc"));
  });

  it.each([
    ...invalidMetadata,
    { label: "changed scope", field: "identityScope", value: Symbol("replacement") },
    { label: "changed device", field: "dev", value: Number.MAX_SAFE_INTEGER },
    { label: "changed inode", field: "ino", value: Number.MAX_SAFE_INTEGER },
  ])("rejects $label after acquisition before write or truncate", async ({ field, value }) => {
    const { source, retained, quota } = await fixture();
    const descriptor = await quota.open!("/file", { access: "readwrite" });
    try {
      const before = await retained.stat();
      const stat = vi.spyOn(retained, "stat").mockResolvedValue({ ...before, [field]: value });
      const write = vi.spyOn(retained, "write");
      const truncate = vi.spyOn(retained, "truncate");
      await expect(descriptor.write(bytes("d"), 3)).rejects.toMatchObject({ code: "EIO" });
      await expect(descriptor.truncate(4)).rejects.toMatchObject({ code: "EIO" });
      expect(write).not.toHaveBeenCalled();
      expect(truncate).not.toHaveBeenCalled();
      stat.mockRestore();
      expect(await descriptor.getPosition!()).toBe(0);
      expect(await source.readFile("/file")).toEqual(bytes("abc"));
      await descriptor.write(bytes("d"), 3);
    } finally { await descriptor.close(); }
  });

  it("snapshots the acquired identity rather than retaining a mutable stat reply", async () => {
    const { source, retained, quota } = await fixture();
    const metadata = { ...await retained.stat() };
    vi.spyOn(retained, "stat").mockResolvedValue(metadata);
    const descriptor = await quota.open!("/file", { access: "readwrite" });
    try {
      metadata.ino! += 1;
      const write = vi.spyOn(retained, "write");
      await expect(descriptor.write(bytes("d"), 3)).rejects.toMatchObject({ code: "EIO" });
      expect(write).not.toHaveBeenCalled();
      expect(await source.readFile("/file")).toEqual(bytes("abc"));
    } finally { await descriptor.close(); }
  });

  it.each(["identityScope", "dev", "ino"] as const)("treats a namespace identity differing only in %s as distinct", async field => {
    const { source, retained, quota } = await fixture(5);
    await source.writeFile("/other", bytes("x"));
    const pinned = await retained.stat();
    const lstat = source.lstat.bind(source);
    vi.spyOn(source, "lstat").mockImplementation(async (path, options) => {
      const stat = await lstat(path, options);
      if (path !== "/other") return stat;
      return {
        ...stat, identityScope: pinned.identityScope, dev: pinned.dev, ino: pinned.ino,
        [field]: field === "identityScope" ? Symbol.for("quota-review-distinct") : pinned[field]! + 1,
      };
    });
    const descriptor = await quota.open!("/file", { access: "readwrite" });
    try {
      await descriptor.write(bytes("d"), 3);
      expect(await source.readFile("/file")).toEqual(bytes("abcd"));
      expect(await source.readFile("/other")).toEqual(bytes("x"));
      await expect(descriptor.write(bytes("e"), 4)).rejects.toBeInstanceOf(FileSystemQuotaError);
    } finally { await descriptor.close(); }
  });
});

describe("quota descriptor position and empty write review", () => {
  it("charges a supplied byte view, does not retry short writes, and measures later actual growth", async () => {
    const { source, retained, quota } = await fixture(5);
    const descriptor = await quota.open!("/file", { access: "readwrite" });
    const write = retained.write.bind(retained);
    const writing = vi.spyOn(retained, "write").mockImplementationOnce((buffer, position, options) => write(buffer.subarray(0, 1), position, options));
    try {
      const view = bytes("!de?").subarray(1, 3);
      expect(await descriptor.write(view, 3)).toBe(1);
      expect(writing).toHaveBeenCalledTimes(1);
      expect(writing.mock.calls[0][0]).toBe(view);
      expect(await descriptor.getPosition!()).toBe(0);
      expect(await source.readFile("/file")).toEqual(bytes("abcd"));
      await quota.writeFile("/other", bytes("x"));
      await expect(descriptor.write(bytes("e"), 4)).rejects.toBeInstanceOf(FileSystemQuotaError);
    } finally { await descriptor.close(); }
  });

  it("keeps explicit positioned append writes separate from null-position appends", async () => {
    const source = new MemoryFileSystem();
    await source.writeFile("/file", bytes("abc"));
    const retained = await source.open("/file", { access: "readwrite" });
    const append = await source.open("/file", { access: "readwrite", append: true });
    const adapter: FileDescriptor = {
      capabilities: { ...retained.capabilities, positionedAppendWrite: true },
      stat: retained.stat.bind(retained),
      getPosition: append.getPosition!.bind(append),
      read: append.read.bind(append),
      write: vi.fn((buffer, position, options) => position === null
        ? append.write(buffer, null, options) : retained.write(buffer, position, options)),
      truncate: retained.truncate.bind(retained),
      sync: retained.sync.bind(retained),
      close: async () => { await Promise.all([retained.close(), append.close()]); },
    };
    vi.spyOn(source, "open").mockResolvedValueOnce(adapter);
    const quota = withFileSystemQuota(source, { maxBytes: 4 });
    const descriptor = await quota.open!("/file", { access: "readwrite", append: true });
    try {
      expect(descriptor.capabilities.positionedAppendWrite).toBe(true);
      await descriptor.read(new Uint8Array(1), null);
      await descriptor.write(bytes("X"), 0);
      expect(await descriptor.getPosition!()).toBe(1);
      expect(await source.readFile("/file")).toEqual(bytes("Xbc"));
      await descriptor.write(bytes("d"), null);
      expect(await descriptor.getPosition!()).toBe(4);
      await descriptor.write(bytes("Y"), 1);
      expect(await descriptor.getPosition!()).toBe(4);
      await expect(descriptor.write(bytes("e"), null)).rejects.toBeInstanceOf(FileSystemQuotaError);
      expect(await source.readFile("/file")).toEqual(bytes("XYcd"));
      expect(adapter.write).toHaveBeenCalledTimes(3);
    } finally { await descriptor.close(); }
  });

  it("validates zero-write positions and access before the native no-I/O fast path", async () => {
    const { retained, quota } = await fixture(3, { access: "readwrite", append: true });
    const descriptor = await quota.open!("/file", { access: "readwrite", append: true });
    const write = vi.spyOn(retained, "write");
    const stat = vi.spyOn(retained, "stat");
    try {
      await expect(descriptor.write(new Uint8Array(), 0)).rejects.toMatchObject({ code: "EINVAL" });
      expect(await descriptor.write(new Uint8Array(), null)).toBe(0);
      expect(await descriptor.getPosition!()).toBe(0);
      expect(write).not.toHaveBeenCalled();
      expect(stat).not.toHaveBeenCalled();
    } finally { await descriptor.close(); }
    const readonly = await quota.open!("/file", { access: "read" });
    try {
      await expect(readonly.write(new Uint8Array(), null)).rejects.toMatchObject({ code: "EBADF" });
    } finally { await readonly.close(); }
  });

  it.each(["success", "failure"])("delegated zero-write %s at a distant offset does not reserve nonexistent growth", async outcome => {
    const { source, retained, quota } = await fixture(3);
    Object.defineProperty(retained, "capabilities", { value: { ...retained.capabilities, delegateZeroLengthWrite: true } });
    const failure = new Error("empty backend write failed");
    const write = vi.spyOn(retained, "write");
    if (outcome === "success") write.mockResolvedValueOnce(0);
    else write.mockRejectedValueOnce(failure);
    const descriptor = await quota.open!("/file", { access: "readwrite" });
    try {
      expect(descriptor.capabilities.delegateZeroLengthWrite).toBe(true);
      const buffer = new Uint8Array();
      const operation = descriptor.write(buffer, Number.MAX_SAFE_INTEGER);
      if (outcome === "success") expect(await operation).toBe(0);
      else await expect(operation).rejects.toBe(failure);
      expect(write).toHaveBeenCalledExactlyOnceWith(buffer, Number.MAX_SAFE_INTEGER, {});
      expect(await descriptor.getPosition!()).toBe(0);
      expect(await source.readFile("/file")).toEqual(bytes("abc"));
    } finally { await descriptor.close(); }
  });
});
