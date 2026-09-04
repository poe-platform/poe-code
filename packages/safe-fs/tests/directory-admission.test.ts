import * as native from "node:fs/promises";
import type { Dir, Dirent } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { RealFileSystem } from "../src/fs/real/index.js";
import { FsError } from "../src/contracts/errors.js";
import { admitDirectoryEntries, directoryEntryLimit } from "../src/fs/directory-admission.js";
import type { ReadDirectoryOptions } from "../src/contracts/filesystem.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, readdir: vi.fn(fs.promises.readdir), opendir: vi.fn() };
});

type DirectoryOptions = ReadDirectoryOptions;

beforeEach(() => {
  vi.clearAllMocks();
  vol.reset();
  vol.fromJSON({ "/machine/a": "a", "/machine/b": "b", "/machine/c": "c" });
});
afterEach(() => { vi.restoreAllMocks(); });

function directory(names: readonly string[]) {
  const values = names.map(name => ({ name, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }) as Dirent);
  const read = vi.fn(async () => values.shift() ?? null);
  const close = vi.fn(async () => {});
  const handle = { read, close } as unknown as Dir;
  vi.mocked(native.opendir).mockResolvedValue(handle);
  return { handle, read, close };
}

describe("bounded directory admission", () => {
  it("Memory rejects before entry iteration, while omission retains sorted legacy output", async () => {
    const filesystem = new MemoryFileSystem();
    for (const name of ["c", "a", "b"]) await filesystem.writeFile(`/${name}`, new Uint8Array());
    const iterate = Map.prototype[Symbol.iterator];
    let visits = 0;
    vi.spyOn(Map.prototype, Symbol.iterator).mockImplementation(function (this: Map<unknown, unknown>) {
      if (this.has("a") && this.has("b") && this.has("c")) visits++;
      return iterate.call(this);
    });
    const options: DirectoryOptions = { maxEntries: 2 };
    await expect(filesystem.readdir("/", options)).rejects.toMatchObject({ code: "EFBIG", syscall: "readdir", path: "/" });
    expect(visits).toBe(0);
    expect((await filesystem.readdir("/")).map(entry => entry.name)).toEqual(["a", "b", "c"]);
    expect(visits).toBe(1);
  });

  it("Memory accepts exact limits and empty directories at zero", async () => {
    const filesystem = new MemoryFileSystem();
    const zero: DirectoryOptions = { maxEntries: 0 };
    expect(await filesystem.readdir("/", zero)).toEqual([]);
    await filesystem.writeFile("/a", new Uint8Array());
    const exact: DirectoryOptions = { maxEntries: 1 };
    expect(await filesystem.readdir("/", exact)).toEqual([{ name: "a", type: "file" }]);
    await expect(filesystem.readdir("/", zero)).rejects.toMatchObject({ code: "EFBIG" });
  });

  for (const adapter of ["Memory", "Real"] as const) {
    it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(`${adapter} rejects invalid maxEntries %s`, async maxEntries => {
      const filesystem = adapter === "Memory" ? new MemoryFileSystem() : new RealFileSystem("/machine");
      const options: DirectoryOptions = { maxEntries };
      await expect(filesystem.readdir("/", options)).rejects.toMatchObject({ code: "EINVAL", syscall: "readdir", path: "/" });
      expect(native.opendir).not.toHaveBeenCalled();
      expect(native.readdir).not.toHaveBeenCalled();
    });

    it.each([false, 0, "", null])(`${adapter} preserves cancellation before invalid admission: %s`, async reason => {
      const filesystem = adapter === "Memory" ? new MemoryFileSystem() : new RealFileSystem("/machine");
      const controller = new AbortController();
      controller.abort(reason);
      const options: DirectoryOptions = { maxEntries: -1, signal: controller.signal };
      await expect(filesystem.readdir("/", options)).rejects.toBe(reason);
      expect(native.opendir).not.toHaveBeenCalled();
      expect(native.readdir).not.toHaveBeenCalled();
    });
  }

  it("Real admits exact N only after EOF and closes once", async () => {
    const { read, close } = directory(["b", "a"]);
    const options: DirectoryOptions = { maxEntries: 2 };
    expect(await new RealFileSystem("/machine").readdir("/", options)).toEqual([{ name: "b", type: "file" }, { name: "a", type: "file" }]);
    expect(read).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledOnce();
    expect(native.readdir).not.toHaveBeenCalled();
    expect(native.opendir).toHaveBeenCalledWith("/machine", expect.objectContaining({ bufferSize: 1 }));
  });

  it("Real rejects after N+1 entries without reading another or returning a prefix", async () => {
    const { read, close } = directory(["a", "b", "c", "d"]);
    const options: DirectoryOptions = { maxEntries: 2 };
    await expect(new RealFileSystem("/machine").readdir("/", options)).rejects.toMatchObject({ code: "EFBIG", syscall: "readdir", path: "/" });
    expect(read).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledOnce();
    expect(native.readdir).not.toHaveBeenCalled();
  });

  it.each([{ names: [] }, { names: ["a"] }])("Real zero limit reads once to establish empty or overflow: $names", async ({ names }) => {
    const { read, close } = directory(names);
    const options: DirectoryOptions = { maxEntries: 0 };
    const operation = new RealFileSystem("/machine").readdir("/", options);
    if (names.length) await expect(operation).rejects.toMatchObject({ code: "EFBIG" });
    else expect(await operation).toEqual([]);
    expect(read).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("Real omission retains native eager readdir route", async () => {
    expect((await new RealFileSystem("/machine").readdir("/")).map(entry => entry.name)).toEqual(["a", "b", "c"]);
    expect(native.readdir).toHaveBeenCalledOnce();
    expect(native.opendir).not.toHaveBeenCalled();
  });

  it("shared admission handles omission, zero, exact capacity and overflow", () => {
    expect(directoryEntryLimit({}, "/directory")).toBeUndefined();
    expect(directoryEntryLimit({ maxEntries: 0 }, "/directory")).toBe(0);
    expect(directoryEntryLimit({ maxEntries: Number.MAX_SAFE_INTEGER }, "/directory")).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => admitDirectoryEntries(3, undefined, "/directory")).not.toThrow();
    expect(() => admitDirectoryEntries(0, 0, "/directory")).not.toThrow();
    expect(() => admitDirectoryEntries(2, 2, "/directory")).not.toThrow();
    expect(() => admitDirectoryEntries(3, 2, "/directory")).toThrow(expect.objectContaining({ code: "EFBIG", syscall: "readdir", path: "/directory" }));
  });

  it("Memory preserves normal path and permission errors before size rejection", async () => {
    const filesystem = new MemoryFileSystem();
    await filesystem.mkdir("/private", { mode: 0o700 });
    await filesystem.writeFile("/private/file", new Uint8Array());
    await filesystem.chmod("/private", 0o000);
    await expect(filesystem.readdir("/private", { maxEntries: 0 })).rejects.toMatchObject({ code: "EACCES" });
    await expect(filesystem.readdir("/absent", { maxEntries: 0 })).rejects.toMatchObject({ code: "ENOENT" });
    await filesystem.writeFile("/file", new Uint8Array());
    await expect(filesystem.readdir("/file", { maxEntries: 0 })).rejects.toMatchObject({ code: "ENOTDIR" });
  });

  it("Real retains confinement and path errors before opening", async () => {
    const { fs } = await import("memfs");
    vol.fromJSON({ "/outside/secret": "secret" });
    fs.symlinkSync("/outside", "/machine/escape");
    const filesystem = new RealFileSystem("/machine");
    await expect(filesystem.readdir("/escape", { maxEntries: 0 })).rejects.toMatchObject({ code: "EACCES", syscall: "readdir", path: "/escape" });
    await expect(filesystem.readdir("/missing", { maxEntries: 0 })).rejects.toMatchObject({ code: "ENOENT", syscall: "readdir", path: "/missing" });
    expect(native.opendir).not.toHaveBeenCalled();
  });

  it("Real closes after unsupported entry type", async () => {
    const { read, close } = directory([]);
    read.mockResolvedValueOnce({ name: "fifo", isFile: () => false, isDirectory: () => false, isSymbolicLink: () => false } as Dirent);
    await expect(new RealFileSystem("/machine").readdir("/", { maxEntries: 1 })).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(read).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("Real does not inspect the excess entry before admission", async () => {
    const { read, close } = directory([]);
    const classify = vi.fn(() => { throw new Error("unadmitted entry inspected"); });
    read.mockResolvedValueOnce({ get name() { return classify(); }, isFile: classify, isDirectory: classify, isSymbolicLink: classify } as unknown as Dirent);
    await expect(new RealFileSystem("/machine").readdir("/", { maxEntries: 0 })).rejects.toMatchObject({ code: "EFBIG" });
    expect(classify).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("Real surfaces close failure only when listing otherwise succeeded", async () => {
    const { close } = directory([]);
    close.mockRejectedValue(new FsError("EACCES", { message: "private host data", path: "/machine" }));
    const result = new RealFileSystem("/machine").readdir("/", { maxEntries: 0 });
    await expect(result).rejects.toMatchObject({ code: "EACCES", syscall: "readdir", path: "/" });
    await expect(result).rejects.not.toHaveProperty("cause");
    await expect(result).rejects.not.toHaveProperty("message", expect.stringContaining("private host data"));
    expect(close).toHaveBeenCalledOnce();
  });

  it("Real overflow remains primary over a close failure", async () => {
    const { close } = directory(["a"]);
    close.mockRejectedValue(new FsError("EACCES"));
    await expect(new RealFileSystem("/machine").readdir("/", { maxEntries: 0 })).rejects.toMatchObject({ code: "EFBIG" });
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([undefined, null, false, 0, ""])("Real falsey host read rejection remains primary over close error: %s", async reason => {
    const { read, close } = directory([]);
    read.mockRejectedValue(reason);
    close.mockRejectedValue(new FsError("EACCES"));
    await expect(new RealFileSystem("/machine").readdir("/", { maxEntries: 1 })).rejects.toMatchObject({ code: "EIO", syscall: "readdir", path: "/" });
    expect(read).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([false, 0, "", null])("Real cancellation after read wins over overflow and close failure: %s", async reason => {
    const { read, close } = directory(["a"]);
    const controller = new AbortController();
    const original = read.getMockImplementation()!;
    read.mockImplementation(async () => {
      const entry = await original();
      controller.abort(reason);
      return entry;
    });
    close.mockRejectedValue(new FsError("EACCES"));
    await expect(new RealFileSystem("/machine").readdir("/", { maxEntries: 0, signal: controller.signal })).rejects.toBe(reason);
    expect(read).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("Real closes a handle acquired after cancellation without reading it", async () => {
    const { handle, read, close } = directory(["a"]);
    const controller = new AbortController();
    let entered!: () => void;
    let acquire!: (value: Dir) => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<Dir>(resolve => { acquire = resolve; });
    vi.mocked(native.opendir).mockImplementation(() => { entered(); return pending; });
    const operation = new RealFileSystem("/machine").readdir("/", { maxEntries: 1, signal: controller.signal });
    const rejected = expect(operation).rejects.toBe(false);
    await started;
    controller.abort(false);
    acquire(handle);
    await rejected;
    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("Real waits for close settlement before returning its entries", async () => {
    const { close } = directory([]);
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    close.mockImplementation(() => { entered(); return pending; });
    let settled = false;
    const operation = new RealFileSystem("/machine").readdir("/", { maxEntries: 0 }).then(entries => { settled = true; return entries; });
    await started;
    try { expect(settled).toBe(false); } finally { release(); }
    expect(await operation).toEqual([]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("Real cancellation during successful close remains exact", async () => {
    const { close } = directory([]);
    const controller = new AbortController();
    close.mockImplementation(async () => { controller.abort(0); });
    await expect(new RealFileSystem("/machine").readdir("/", { maxEntries: 0, signal: controller.signal })).rejects.toBe(0);
    expect(close).toHaveBeenCalledOnce();
  });
});
