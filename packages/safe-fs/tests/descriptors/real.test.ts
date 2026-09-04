import * as native from "node:fs/promises";
import { constants } from "node:fs";
import { fs, vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RealFileSystem } from "../../src/fs/real/index.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, open: vi.fn(), lstat: vi.fn() };
});

beforeEach(() => {
  vi.resetAllMocks();
  vol.reset();
  vol.fromJSON({ "/machine/file": "abcdef", "/outside/file": "secret" });
  vi.mocked(native.open).mockImplementation(fs.promises.open as unknown as typeof native.open);
  vi.mocked(native.lstat).mockImplementation(fs.promises.lstat as typeof native.lstat);
});

describe("rooted real canonical descriptors (memfs fixtures)", () => {
  it("retains one native handle, forwards exact positions, and closes once", async () => {
    const handle = await fs.promises.open("/machine/file", "r+");
    const read = vi.spyOn(handle, "read");
    const write = vi.spyOn(handle, "write");
    const close = vi.spyOn(handle, "close");
    vi.mocked(native.open).mockResolvedValue(handle as unknown as native.FileHandle);
    const filesystem = new RealFileSystem("/machine");
    const fd = await filesystem.open("/file", { access: "readwrite" });
    const view = new Uint8Array([8, 9, 10]).subarray(1, 2);
    expect(await fd.read(view, 3)).toBe(1);
    expect(read).toHaveBeenLastCalledWith(view, 0, 1, 3);
    await fd.read(view, null);
    expect(read).toHaveBeenLastCalledWith(view, 0, 1, null);
    await fd.write(view, 2);
    expect(write).toHaveBeenLastCalledWith(view, 0, 1, 2);
    await fd.write(view, null);
    expect(write).toHaveBeenLastCalledWith(view, 0, 1, null);
    const inode = (await fd.stat()).ino;
    await fs.promises.rename("/machine/file", "/machine/moved");
    await fs.promises.unlink("/machine/moved");
    await fs.promises.writeFile("/machine/file", "new");
    expect(await fd.stat()).toMatchObject({ ino: inode, nlink: 0 });
    await fd.truncate(2);
    expect(await fs.promises.readFile("/machine/file", "utf8")).toBe("new");
    await Promise.all([fd.close(), fd.close()]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(native.open).toHaveBeenCalledTimes(1);
  });

  it("maps creation, append, and synchronization to real handle operations", async () => {
    const handle = await fs.promises.open("/machine/new", "w+");
    const sync = vi.spyOn(handle as unknown as native.FileHandle, "sync");
    const datasync = vi.spyOn(handle, "datasync");
    vi.mocked(native.open).mockResolvedValue(handle as unknown as native.FileHandle);
    const filesystem = new RealFileSystem("/machine");
    const fd = await filesystem.open("/new", { access: "readwrite", creation: "exclusive", append: true, mode: 0o600, synchronization: "all" });
    const flags = constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK;
    expect(native.open).toHaveBeenCalledWith("/machine/new", flags, 0o600);
    expect(fd.capabilities).toMatchObject({ synchronization: "storage", positionedWrite: false });
    await fd.sync(true);
    await fd.sync(false);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(datasync).toHaveBeenCalledTimes(1);
    await fd.close();
  });

  it("rejects escapes and native special files before opening", async () => {
    await fs.promises.symlink("/outside/file", "/machine/escape");
    const filesystem = new RealFileSystem("/machine");
    await expect(filesystem.open("/escape", { access: "write", truncate: true })).rejects.toMatchObject({ code: "EACCES", path: "/escape" });
    const special = await fs.promises.lstat("/machine/file");
    vi.spyOn(special, "isFile").mockReturnValue(false);
    vi.mocked(native.lstat).mockResolvedValue(special as Awaited<ReturnType<typeof native.lstat>>);
    await expect(filesystem.open("/file", { access: "read" })).rejects.toMatchObject({ code: "ENOTSUP", path: "/file" });
    expect(native.open).not.toHaveBeenCalled();
    expect(await fs.promises.readFile("/outside/file", "utf8")).toBe("secret");
  });

  it("closes a handle rejected by post-open file-type admission", async () => {
    const handle = await fs.promises.open("/machine/file", "r");
    const special = await handle.stat();
    vi.spyOn(special, "isFile").mockReturnValue(false);
    vi.spyOn(handle, "stat").mockResolvedValue(special);
    const close = vi.spyOn(handle, "close");
    vi.mocked(native.open).mockResolvedValue(handle as unknown as native.FileHandle);
    const filesystem = new RealFileSystem("/machine");
    await expect(filesystem.open("/file", { access: "read" })).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("drains late acquisition on falsey cancellation, preserving it over cleanup error", async () => {
    const controller = new AbortController();
    const handle = await fs.promises.open("/machine/file", "r");
    const close = vi.spyOn(handle, "close").mockImplementation(async () => { throw new Error("secondary"); });
    vi.mocked(native.open).mockImplementation(async () => {
      controller.abort(0);
      return handle as unknown as native.FileHandle;
    });
    const filesystem = new RealFileSystem("/machine");
    await expect(filesystem.open("/file", { access: "read", signal: controller.signal })).rejects.toBe(0);
    expect(close).toHaveBeenCalledTimes(1);
    fs.closeSync(handle.fd);
  });

  it("enforces nocreat and directory admission with virtual error paths", async () => {
    const filesystem = new RealFileSystem("/machine");
    await expect(filesystem.open("/absent", { access: "write" })).rejects.toMatchObject({ code: "ENOENT", path: "/absent", syscall: "open" });
    await expect(filesystem.open("/", { access: "read" })).rejects.toMatchObject({ code: "EISDIR", path: "/" });
  });
});
