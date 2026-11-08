import { describe, expect, it, vi } from "vitest";
import { FsError } from "../../src/contracts/errors.js";
import type { FileDescriptor, FileSystem } from "../../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { MountFileSystem } from "../../src/fs/mount/index.js";
import { ReadOnlyFileSystem } from "../../src/fs/readonly/index.js";
import { withFileSystemQuota } from "../../src/fs/quota/index.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(fulfilled => { resolve = fulfilled; });
  return { promise, resolve };
}

describe("independent descriptor review", () => {
  it("copy growth cannot bypass capacity or change the opened destination on ENOSPC", async () => {
    const fs = new MemoryFileSystem({ maxBytes: 8 });
    await fs.writeFile("/source", new Uint8Array(6).fill(1));
    await fs.writeFile("/target", Uint8Array.of(2, 3));
    const descriptor = await fs.open("/target", { access: "readwrite" });
    try {
      const original = await descriptor.stat();
      await expect(fs.copyFile("/source", "/target")).rejects.toMatchObject({ code: "ENOSPC" });
      expect(await descriptor.stat()).toMatchObject({ ino: original.ino, size: 2 });
      expect(await fs.readFile("/target")).toEqual(Uint8Array.of(2, 3));
    } finally { await descriptor.close(); }
  });

  it("an unlinked open copy remains charged against memory capacity", async () => {
    const fs = new MemoryFileSystem({ maxBytes: 8 });
    await fs.writeFile("/source", new Uint8Array(4));
    await fs.copyFile("/source", "/copy");
    const descriptor = await fs.open("/copy", { access: "read" });
    try {
      await fs.rm("/copy");
      expect(await descriptor.stat()).toMatchObject({ nlink: 0, size: 4 });
      await expect(fs.writeFile("/other", Uint8Array.of(1))).rejects.toMatchObject({ code: "ENOSPC" });
    } finally { await descriptor.close(); }
  });

  it("closing an unlinked copy cannot release capacity belonging to its source", async () => {
    const fs = new MemoryFileSystem({ maxBytes: 8 });
    await fs.writeFile("/source", new Uint8Array(4));
    await fs.copyFile("/source", "/copy");
    const descriptor = await fs.open("/copy", { access: "read" });
    try { await fs.rm("/copy"); }
    finally { await descriptor.close(); }
    await expect(fs.writeFile("/other", new Uint8Array(5))).rejects.toMatchObject({ code: "ENOSPC" });
    expect((await fs.stat("/source")).size).toBe(4);
  });

  it("copy shrink releases capacity for retained descriptor growth", async () => {
    const fs = new MemoryFileSystem({ maxBytes: 8 });
    await fs.writeFile("/source", Uint8Array.of(1, 2));
    await fs.writeFile("/target", new Uint8Array(6));
    const descriptor = await fs.open("/target", { access: "readwrite" });
    try {
      const original = await descriptor.stat();
      await fs.copyFile("/source", "/target");
      expect(await descriptor.stat()).toMatchObject({ ino: original.ino, size: 2 });
      await expect(descriptor.truncate(6)).resolves.toBeUndefined();
      expect(await fs.readFile("/target")).toEqual(Uint8Array.of(1, 2, 0, 0, 0, 0));
      await expect(descriptor.write(Uint8Array.of(3), 6)).rejects.toMatchObject({ code: "ENOSPC" });
    } finally { await descriptor.close(); }
  });

  it("rename over an opened destination retains both inodes and charges until final close", async () => {
    const fs = new MemoryFileSystem({ maxBytes: 8 });
    await fs.writeFile("/source", Uint8Array.of(1, 2, 3, 4));
    await fs.writeFile("/target", Uint8Array.of(5, 6, 7, 8));
    const source = await fs.open("/source", { access: "readwrite" });
    const target = await fs.open("/target", { access: "readwrite" });
    try {
      const before = await target.stat();
      await fs.rename("/source", "/target");
      expect(await target.stat()).toMatchObject({ ino: before.ino, nlink: 0, size: 4 });
      expect((await source.stat()).ino).toBe((await fs.stat("/target")).ino);
      await expect(source.truncate(5)).rejects.toMatchObject({ code: "ENOSPC" });
      await target.write(Uint8Array.of(9), 0);
      expect(await fs.readFile("/target")).toEqual(Uint8Array.of(1, 2, 3, 4));
      await target.close();
      await source.truncate(8);
      await expect(source.truncate(9)).rejects.toMatchObject({ code: "ENOSPC" });
    } finally { await Promise.all([source.close(), target.close()]); }
  });

  it("mounted append and truncate keep the sequential cursor independent of positioned reads", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/file", Uint8Array.of(1, 2, 3));
    const mount = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/data": fs } });
    const descriptor = await mount.open("/data/file", { access: "readwrite", append: true });
    try {
      const buffer = new Uint8Array(1);
      await descriptor.read(buffer, null);
      expect(buffer[0]).toBe(1);
      await descriptor.read(buffer, 2);
      expect(buffer[0]).toBe(3);
      await descriptor.read(buffer, null);
      expect(buffer[0]).toBe(2);
      await descriptor.write(Uint8Array.of(4), null);
      await descriptor.truncate(1);
      expect(await descriptor.read(buffer, null)).toBe(0);
      await descriptor.write(Uint8Array.of(5), null);
      expect(await fs.readFile("/file")).toEqual(Uint8Array.of(1, 5));
      await expect(descriptor.write(Uint8Array.of(6), 0)).rejects.toMatchObject({ code: "EINVAL" });
    } finally { await descriptor.close(); }
  });

  it("creation may acquire mode-zero access but later opens cannot bypass permissions", async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/parent");
    const descriptor = await fs.open("/parent/file", { access: "readwrite", creation: "exclusive", mode: 0 });
    try {
      await expect(fs.open("/parent/file", { access: "readwrite", truncate: true })).rejects.toMatchObject({ code: "EACCES" });
      await fs.chmod("/parent", 0);
      await descriptor.write(Uint8Array.of(255, 0, 128), null);
      const buffer = new Uint8Array(3);
      expect(await descriptor.read(buffer, 0)).toBe(3);
      expect(buffer).toEqual(Uint8Array.of(255, 0, 128));
      await expect(fs.open("/parent/new", { access: "write", creation: "ifMissing" })).rejects.toMatchObject({ code: "EACCES" });
    } finally { await descriptor.close(); }
  });

  it.each(["quota", "readonly-quota", "mount-quota"])("%s cannot acquire an unaccounted descriptor", async kind => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/file", Uint8Array.of(7));
    const acquire = vi.spyOn(fs, "open");
    const quota = withFileSystemQuota(fs, { maxBytes: 1 });
    const view: FileSystem = kind === "readonly-quota" ? new ReadOnlyFileSystem(quota)
      : kind === "mount-quota" ? new MountFileSystem({ root: quota }) : quota;
    expect(view.capabilities.open).toBe(true);
    expect((await view.capabilitiesFor!("/file")).open).toBe(true);
    const descriptor = await view.open!("/file", { access: "read" });
    const output = new Uint8Array(1);
    expect(await descriptor.read(output, null)).toBe(1);
    expect(output).toEqual(Uint8Array.of(7));
    await expect(descriptor.write(Uint8Array.of(8), 1)).rejects.toMatchObject({ code: "EBADF" });
    await descriptor.close();
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(await fs.readFile("/file")).toEqual(Uint8Array.of(7));
  });

  it("readonly mount retains an acquired inode after pathname replacement without forwarding mutations", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/file", Uint8Array.of(1, 2));
    const acquire = vi.spyOn(fs, "open");
    const view = new MountFileSystem({ root: new ReadOnlyFileSystem(fs) });
    const descriptor = await view.open("/file", { access: "read" });
    try {
      await fs.rename("/file", "/old");
      await fs.writeFile("/file", Uint8Array.of(3));
      await fs.rm("/old");
      const buffer = new Uint8Array(2);
      expect(await descriptor.read(buffer, null)).toBe(2);
      expect(buffer).toEqual(Uint8Array.of(1, 2));
      expect((await descriptor.stat()).nlink).toBe(0);
      await expect(descriptor.write(Uint8Array.of(4), null)).rejects.toMatchObject({ code: "EBADF" });
      await expect(view.open("/file", { access: "read", creation: "ifMissing" })).rejects.toMatchObject({ code: "EROFS" });
      expect(acquire).toHaveBeenCalledTimes(1);
    } finally { await descriptor.close(); }
  });

  it("nested views drain late acquisition cleanup before preserving falsey cancellation", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/file", Uint8Array.of(1));
    const retained = await fs.open("/file", { access: "read" });
    const controller = new AbortController();
    const closing = deferred<void>(), release = deferred<void>();
    const close = retained.close.bind(retained);
    const closingSpy = vi.spyOn(retained, "close").mockImplementation(async () => {
      closing.resolve();
      await release.promise;
      await close();
      throw new FsError("EIO");
    });
    vi.spyOn(fs, "open").mockImplementation(async () => { controller.abort(false); return retained; });
    const view = new MountFileSystem({ root: new ReadOnlyFileSystem(fs) });
    const opening = view.open("/file", { access: "read", signal: controller.signal });
    let settled = false;
    const checked = expect(opening).rejects.toBe(false);
    void opening.then(() => { settled = true; }, () => { settled = true; });
    try {
      await closing.promise;
      expect(settled).toBe(false);
    } finally {
      release.resolve();
      await checked;
    }
    expect(closingSpy).toHaveBeenCalledTimes(1);
    await expect(retained.stat()).rejects.toMatchObject({ code: "EBADF" });
  });

  it("close drains queued work, does not admit new work, and remains identical through errors", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/file", Uint8Array.of(1));
    const retained = await fs.open("/file", { access: "readwrite" });
    const entered = deferred<void>(), release = deferred<void>();
    const innerRead = retained.read.bind(retained);
    vi.spyOn(retained, "read").mockImplementation(async (...args) => {
      entered.resolve();
      await release.promise;
      return innerRead(...args);
    });
    const write = vi.spyOn(retained, "write");
    const close = vi.spyOn(retained, "close");
    vi.spyOn(fs, "open").mockResolvedValue(retained);
    const mount = new MountFileSystem({ root: fs });
    const descriptor: FileDescriptor = await mount.open("/file", { access: "readwrite" });
    const cancellation = new AbortController();
    const reading = descriptor.read(new Uint8Array(1), null);
    const queued = descriptor.write(Uint8Array.of(2), null, { signal: cancellation.signal });
    const checked = expect(queued).rejects.toBe(0);
    await entered.promise;
    cancellation.abort(0);
    const closing = descriptor.close();
    try {
      expect(descriptor.close()).toBe(closing);
      await expect(descriptor.stat()).rejects.toMatchObject({ code: "EBADF" });
      expect(close).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      await Promise.all([reading, checked, closing]);
    }
    expect(write).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
