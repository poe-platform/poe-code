import { describe, expect, it, vi } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import type { FileStat } from "../src/contracts/filesystem.js";
import { PythonFileSystem, translatePythonOpenFlags } from "../src/python/index.js";

const bytes = (text: string) => new TextEncoder().encode(text);
it("enforces Python directory admission when a backend returns more than requested", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/first", bytes("a"));
  await fs.writeFile("/second", bytes("b"));
  const entries = await fs.readdir("/");
  const list = vi.spyOn(fs, "readdir").mockResolvedValue(entries);
  const bounded = new PythonFileSystem(fs, { cwd: "/", maxDirectoryEntries: 1 });
  const exact = new PythonFileSystem(fs, { cwd: "/", maxDirectoryEntries: 2 });
  try {
    await expect(bounded.dispatch({ op: "readdir", args: ["/"] })).rejects.toMatchObject({ code: "EFBIG" });
    expect(list).toHaveBeenCalledWith("/", expect.objectContaining({ maxEntries: 1 }));
    expect(await exact.dispatch({ op: "readdir", args: ["/"] })).toEqual(entries);
    expect(await fs.readFile("/first")).toEqual(bytes("a"));
  } finally { await Promise.all([bounded.close(), exact.close()]); }
});
it("preserves cancellation precedence over an oversized Python directory reply", async () => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  vi.spyOn(fs, "readdir").mockImplementation(async () => {
    controller.abort(false);
    return [{ name: "first", type: "file" }, { name: "second", type: "file" }];
  });
  const service = new PythonFileSystem(fs, { cwd: "/", maxDirectoryEntries: 1, signal: controller.signal });
  try {
    await expect(service.dispatch({ op: "readdir", args: ["/"] })).rejects.toBe(false);
  } finally { await service.close(); }
});
it("preserves read-only rmdir errors through mounted canonical Python filesystems", async () => {
  const storage = new MemoryFileSystem();
  await storage.mkdir("/empty");
  const readonly = new ReadOnlyFileSystem(storage);
  const views = [
    { fs: readonly, path: "/empty" },
    { fs: new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/protected": readonly } }), path: "/protected/empty" },
  ];
  for (const { fs, path } of views) {
    const service = new PythonFileSystem(fs, { cwd: "/" });
    try {
      await expect(service.dispatch({ op: "rmdir", args: [path] })).rejects.toMatchObject({ code: "EROFS" });
      expect(await storage.stat("/empty")).toMatchObject({ type: "directory" });
    } finally { await service.close(); }
  }
});
it("refuses snapshot-only directory removal without delegating from Python", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/empty");
  Object.assign(fs, { capabilitiesFor: vi.fn(async () => ({ ...fs.capabilities, snapshotRmdir: true })) });
  const remove = vi.spyOn(fs, "rmdir");
  const service = new PythonFileSystem(fs, { cwd: "/" });
  try {
    await expect(service.dispatch({ op: "rmdir", args: ["/empty"] })).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(remove).not.toHaveBeenCalled();
    expect(await fs.stat("/empty")).toMatchObject({ type: "directory" });
  } finally { await service.close(); }
});
describe("Python canonical filesystem service", () => {
  it("retains descriptor identity across rename, unlink and path replacement", async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    await fs.writeFile("/work/file", bytes("abcdef"));
    const service = new PythonFileSystem(fs, { cwd: "/work" });
    const fd = await service.dispatch({ op: "open", args: ["file", { access: "readwrite" }] }) as number;
    const before = await service.dispatch({ op: "fstat", args: [fd] }) as FileStat;
    await fs.rename("/work/file", "/work/moved");
    await fs.rm("/work/moved");
    await fs.writeFile("/work/file", bytes("replacement"));
    expect(await service.dispatch({ op: "read", args: [fd, 3, 2] })).toEqual(bytes("cde"));
    await service.dispatch({ op: "ftruncate", args: [fd, 2] });
    expect(await service.dispatch({ op: "fstat", args: [fd] })).toMatchObject({ identityScope: before.identityScope, dev: before.dev, ino: before.ino, size: 2, nlink: 0 });
    expect(await fs.readFile("/work/file")).toEqual(bytes("replacement"));
    await service.close();
    await expect(service.dispatch({ op: "fstat", args: [fd] })).rejects.toMatchObject({ code: "EBADF" });
  });
  it("passes exclusive and append acquisition atomically and refuses unsupported flags", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/file", bytes("a"));
    await fs.symlink("/missing", "/link");
    const service = new PythonFileSystem(fs, { cwd: "/" });
    for (const path of ["/file", "/link"]) await expect(service.dispatch({ op: "open", args: [path, translatePythonOpenFlags(64 | 128 | 131072 | 1)] })).rejects.toMatchObject({ code: "EEXIST" });
    const fd = await service.dispatch({ op: "open", args: ["file", translatePythonOpenFlags(1024 | 1)] }) as number;
    expect(await service.dispatch({ op: "write", args: [fd, bytes("b"), null] })).toBe(1);
    expect(await fs.readFile("/file")).toEqual(bytes("ab"));
    expect(() => translatePythonOpenFlags(131072)).toThrowError(expect.objectContaining({ code: "ENOTSUP" }));
    await service.close();
  });
  it("refuses oversized transfers before backend work and preserves read-only errors", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/file", bytes("abcdef"));
    const service = new PythonFileSystem(new ReadOnlyFileSystem(fs), { cwd: "/", maxTransferBytes: 3 });
    await expect(service.dispatch({ op: "open", args: ["file", { access: "write" }] })).rejects.toMatchObject({ code: "EROFS" });
    const fd = await service.dispatch({ op: "open", args: ["file", { access: "read" }] }) as number;
    await expect(service.dispatch({ op: "read", args: [fd, 4, 0] })).rejects.toMatchObject({ code: "EFBIG" });
    expect(await service.dispatch({ op: "read", args: [fd, 3, 1] })).toEqual(bytes("bcd"));
    await service.close();
  });
  it("closes late acquisitions when shutdown begins and drains delayed work", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/file", bytes("a"));
    const descriptor = await fs.open("/file", { access: "read" });
    const close = vi.spyOn(descriptor, "close");
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(fs, "open").mockImplementation(async () => { await gate; return descriptor; });
    const service = new PythonFileSystem(fs, { cwd: "/" });
    const pending = service.dispatch({ op: "open", args: ["file", { access: "read" }] });
    const rejected = expect(pending).rejects.toMatchObject({ code: "ECANCELED" });
    const closing = service.close();
    release();
    await rejected;
    await closing;
    expect(close).toHaveBeenCalledTimes(1);
  });
});

it("preserves canonical partial I/O, sequential positions and errors without replay", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/file", bytes("abcdef"));
  const descriptor = await fs.open("/file", { access: "readwrite" });
  const read = descriptor.read.bind(descriptor);
  const write = descriptor.write.bind(descriptor);
  vi.spyOn(descriptor, "read").mockImplementation((buffer, position, options) => read(buffer.subarray(0, 2), position, options));
  vi.spyOn(descriptor, "write").mockImplementation((buffer, position, options) => write(buffer.subarray(0, 1), position, options));
  const service = new PythonFileSystem(fs, { cwd: "/", open: async () => descriptor });
  const id = await service.dispatch({ op: "open", args: ["file", { access: "readwrite" }] }) as number;
  expect(await service.dispatch({ op: "read", args: [id, 6, null] })).toEqual(bytes("ab"));
  expect(await service.dispatch({ op: "position", args: [id] })).toBe(2);
  expect(await service.dispatch({ op: "write", args: [id, bytes("XYZ"), null] })).toBe(1);
  expect(await service.dispatch({ op: "position", args: [id] })).toBe(3);
  expect(await fs.readFile("/file")).toEqual(bytes("abXdef"));
  await expect(service.dispatch({ op: "read", args: [id, 1, -1] })).rejects.toMatchObject({ code: "EINVAL" });
  await service.dispatch({ op: "close", args: [id] });
  await expect(service.dispatch({ op: "read", args: [id, 1, 0] })).rejects.toMatchObject({ code: "EBADF" });
  await service.close();
});

it("propagates exact abort reasons to delayed backends and drains on close", async () => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  vi.spyOn(fs, "stat").mockImplementation(async (_path, options) => {
    entered();
    return new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
    });
  });
  const service = new PythonFileSystem(fs, { cwd: "/", signal: controller.signal });
  const pending = service.dispatch({ op: "stat", args: ["/file"] });
  const assertion = expect(pending).rejects.toBe(false);
  await started;
  controller.abort(false);
  await assertion;
  await service.close();
});

it("retains quota accounting for unlinked open files", async () => {
  const fs = new MemoryFileSystem({ maxBytes: 3 });
  await fs.writeFile("/file", bytes("abc"));
  const service = new PythonFileSystem(fs, { cwd: "/" });
  const id = await service.dispatch({ op: "open", args: ["/file", { access: "readwrite" }] }) as number;
  await service.dispatch({ op: "rm", args: ["/file"] });
  await expect(fs.writeFile("/other", bytes("d"))).rejects.toMatchObject({ code: "ENOSPC" });
  await service.dispatch({ op: "ftruncate", args: [id, 2] });
  await fs.writeFile("/other", bytes("d"));
  await service.close();
  await fs.writeFile("/third", bytes("ab"));
});

it("rejects sparse and accessor byte requests before invoking untrusted getters or writing", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/file", bytes("safe"));
  const service = new PythonFileSystem(fs, { cwd: "/" });
  const id = await service.dispatch({ op: "open", args: ["/file", { access: "write" }] }) as number;
  await expect(service.dispatch({ op: "write", args: [id, new Array(2), 0] })).rejects.toMatchObject({ code: "EINVAL" });
  const getter = vi.fn(() => 0);
  const payload: number[] = [1];
  Object.defineProperty(payload, "0", { get: getter });
  await expect(service.dispatch({ op: "write", args: [id, payload, 0] })).rejects.toMatchObject({ code: "EINVAL" });
  expect(getter).not.toHaveBeenCalled();
  expect(await fs.readFile("/file")).toEqual(bytes("safe"));
  await service.close();
});

it("shares one close completion when cooperative abort callbacks reenter cleanup", async () => {
  const fs = new MemoryFileSystem();
  let reentrant: Promise<void> | undefined;
  vi.spyOn(fs, "stat").mockImplementation(async (_path, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener("abort", () => {
      reentrant = service.close();
      reject(options!.signal!.reason);
    }, { once: true });
  }));
  const service = new PythonFileSystem(fs, { cwd: "/" });
  const pending = service.dispatch({ op: "stat", args: ["/file"] });
  const assertion = expect(pending).rejects.toMatchObject({ code: "ECANCELED" });
  const closing = service.close();
  expect(reentrant).toBe(closing);
  await assertion;
  await closing;
});

it("preserves symlink-sensitive caller cwd components for authoritative resolution", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.mkdir("/deep/nested", { recursive: true });
  await fs.symlink("/deep/nested", "/work/link");
  await fs.writeFile("/deep/file", bytes("canonical"));
  await fs.writeFile("/work/file", bytes("lexical"));
  const service = new PythonFileSystem(fs, { cwd: "/work/link/.." });
  const id = await service.dispatch({ op: "open", args: ["file", { access: "read" }] }) as number;
  expect(await service.dispatch({ op: "read", args: [id, 20, 0] })).toEqual(bytes("canonical"));
  await service.close();
});

it("exclusive open bypasses following capability probes and atomically refuses final self-loop entries", async () => {
  const { DeviceFileSystem } = await import("../src/fs/devices/index.js");
  const fs = new MemoryFileSystem();
  await fs.symlink("/self", "/self");
  const devices = new DeviceFileSystem(fs);
  const service = new PythonFileSystem(devices, { cwd: "/" });
  await expect(service.dispatch({ op: "open", args: ["/self", { access: "write", creation: "exclusive" }] })).rejects.toMatchObject({ code: "EEXIST" });
  expect(await fs.readlink("/self")).toBe("/self");
  await service.close();
});

it("preserves readonly mutation precedence over descriptor capability refusal", async () => {
  const { withFileSystemQuota } = await import("../src/fs/quota/index.js");
  const { DeviceFileSystem } = await import("../src/fs/devices/index.js");
  const fs = new MemoryFileSystem();
  await fs.writeFile("/file", bytes("safe"));
  const readonly = new ReadOnlyFileSystem(withFileSystemQuota(fs, { maxBytes: 4 }));
  await expect(readonly.open("/file", { access: "write" })).rejects.toMatchObject({ code: "EROFS" });
  for (const view of [readonly, new DeviceFileSystem(readonly)]) {
    const service = new PythonFileSystem(view, { cwd: "/" });
    await expect(service.dispatch({ op: "open", args: ["/file", { access: "write" }] })).rejects.toMatchObject({ code: "EROFS" });
    await expect(service.dispatch({ op: "open", args: ["/new", { access: "read", creation: "exclusive" }] })).rejects.toMatchObject({ code: "EROFS" });
    await service.close();
  }
  expect(await fs.readFile("/file")).toEqual(bytes("safe"));
});
