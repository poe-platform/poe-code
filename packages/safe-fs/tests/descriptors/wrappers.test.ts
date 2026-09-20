import { describe, expect, it, vi } from "vitest";
import type { FileSystem, OpenFileOptions } from "../../src/contracts/filesystem.js";
import { FsError } from "../../src/contracts/errors.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { MountFileSystem } from "../../src/fs/mount/index.js";
import { ReadOnlyFileSystem } from "../../src/fs/readonly/index.js";
import { OverlayFileSystem } from "../../src/fs/overlay/index.js";
import { withFileSystemQuota } from "../../src/fs/quota/index.js";
import { S3FileSystem } from "../../src/fs/s3/filesystem.js";
import { MockS3Client } from "../../src/fs/s3/mock.js";
import { WebDavFileSystem } from "../../src/fs/webdav/webdav.js";

describe("descriptor wrapper admission", () => {
  it.each(["mount", "readonly"] as const)("%s releases acquisition when returned capability inspection fails", async kind => {
    const source = new MemoryFileSystem();
    await source.writeFile("/file", new Uint8Array());
    const inner = await source.open("/file", { access: "read" });
    const close = vi.spyOn(inner, "close");
    Object.defineProperty(inner, "capabilities", { get() { throw new FsError("EIO"); } });
    vi.spyOn(source, "open").mockResolvedValue(inner);
    const wrapper = kind === "mount" ? new MountFileSystem({ root: source }) : new ReadOnlyFileSystem(source);
    await expect(wrapper.open("/file", { access: "read" })).rejects.toMatchObject({ code: "EIO" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(["read", "write", "readwrite"] as const)("quota wraps %s without leaking Proxy open", async access => {
    const source = new MemoryFileSystem();
    const open = vi.spyOn(source, "open");
    const quota = withFileSystemQuota(source, { maxBytes: 4 });
    expect(quota.capabilities.open).toBe(true);
    expect((await quota.capabilitiesFor!("/file")).open).toBe(true);
    const descriptor = await quota.open!("/file", { access, creation: "ifMissing" });
    expect(descriptor).not.toBe(await open.mock.results[0]!.value);
    await descriptor.close();
    const controller = new AbortController();
    controller.abort(false);
    await expect(quota.open!("/file", { access, signal: controller.signal })).rejects.toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("readonly forwards read-only retained identity and masks an over-capable provider", async () => {
    const source = new MemoryFileSystem();
    await source.writeFile("/file", new Uint8Array([1, 2]));
    const inner = await source.open("/file", { access: "readwrite" });
    const close = vi.spyOn(inner, "close");
    vi.spyOn(source, "open").mockResolvedValue(inner);
    const view = new ReadOnlyFileSystem(source);
    expect(view.capabilities.open).toBe(true);
    const fd = await view.open("/file", { access: "read" });
    expect(fd.capabilities).toMatchObject({ positionedRead: true, positionedWrite: false, truncate: false, synchronization: "none" });
    await expect(fd.write(new Uint8Array([3]), null)).rejects.toMatchObject({ code: "EBADF" });
    await expect(fd.truncate(0)).rejects.toMatchObject({ code: "EBADF" });
    await expect(fd.sync(false)).rejects.toMatchObject({ code: "ENOTSUP" });
    await source.rm("/file");
    const output = new Uint8Array(2);
    expect(await fd.read(output, null)).toBe(2);
    expect(output).toEqual(new Uint8Array([1, 2]));
    await Promise.all([fd.close(), fd.close()]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([
    { access: "write" }, { access: "readwrite" }, { access: "read", creation: "ifMissing" },
    { access: "read", creation: "exclusive" }, { access: "read", truncate: true }, { access: "read", append: true },
  ] satisfies OpenFileOptions[])("readonly rejects mutation before open: %j", async options => {
    const source = new MemoryFileSystem();
    const open = vi.spyOn(source, "open");
    await expect(new ReadOnlyFileSystem(source).open("/file", options)).rejects.toMatchObject({ code: "EROFS" });
    expect(open).not.toHaveBeenCalled();
  });

  it("mount forwards a single retained handle and remaps operation errors", async () => {
    const source = new MemoryFileSystem();
    const mount = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/mnt": source } });
    const open = vi.spyOn(source, "open");
    const fd = await mount.open("/mnt/file", { access: "readwrite", creation: "exclusive" });
    expect(mount.capabilities.open).toBe(true);
    expect((await mount.capabilitiesFor("/mnt/file")).open).toBe(true);
    await source.rename("/file", "/moved");
    await fd.write(new Uint8Array([1, 2]), 2);
    expect(await source.readFile("/moved")).toEqual(new Uint8Array([0, 0, 1, 2]));
    expect(open).toHaveBeenCalledTimes(1);
    const inner = await open.mock.results[0]!.value;
    vi.spyOn(inner, "read").mockRejectedValue(new FsError("EIO", { path: "/private" }));
    await expect(fd.read(new Uint8Array(1), null)).rejects.toMatchObject({ code: "EIO", path: "/mnt/file", syscall: "read" });
    await fd.close();
    await expect(fd.stat()).rejects.toMatchObject({ code: "EBADF", path: "/mnt/file" });
  });

  it("mount preserves actual descriptor capabilities and cleans late opens", async () => {
    const source = new MemoryFileSystem();
    await source.writeFile("/file", new Uint8Array());
    const inner = await source.open("/file", { access: "read" });
    const close = vi.spyOn(inner, "close");
    const controller = new AbortController();
    vi.spyOn(source, "open").mockImplementation(async () => { controller.abort(0); return inner; });
    const mount = new MountFileSystem({ root: source });
    await expect(mount.open("/file", { access: "read", signal: controller.signal })).rejects.toBe(0);
    expect(close).toHaveBeenCalledTimes(1);
    const unseekable = await new MemoryFileSystem().open("/file", { access: "read", creation: "ifMissing" });
    const limited = { ...unseekable.capabilities, positionedRead: false, synchronization: "none" as const };
    Object.defineProperty(unseekable, "capabilities", { value: limited });
    vi.mocked(source.open).mockResolvedValue(unseekable);
    const fd = await mount.open("/file", { access: "read" });
    expect(fd.capabilities).toEqual(limited);
    await expect(fd.read(new Uint8Array(1), 0)).rejects.toMatchObject({ code: "ESPIPE" });
    await fd.close();
  });

  it("mount respects exclusive symlinks, synthetic directories, and refusal composition", async () => {
    const root = new MemoryFileSystem();
    await root.symlink("/absent", "/link");
    const quota = withFileSystemQuota(new MemoryFileSystem(), { maxBytes: 5 });
    const mount = new MountFileSystem({ root, mounts: { "/tree/leaf": quota } });
    await expect(mount.open("/link", { access: "write", creation: "exclusive" })).rejects.toMatchObject({ code: "EEXIST" });
    await expect(mount.open("/tree", { access: "read" })).rejects.toMatchObject({ code: "EISDIR" });
    expect((await mount.capabilitiesFor("/tree")).open).toBe(false);
    expect((await mount.capabilitiesFor("/tree/leaf/file")).open).toBe(true);
    const writer = await mount.open("/tree/leaf/file", { access: "write", creation: "ifMissing" });
    await writer.write(new Uint8Array(5), null);
    await expect(writer.write(new Uint8Array(1), null)).rejects.toMatchObject({ code: "ENOSPC" });
    await writer.close();
    const readonly = new ReadOnlyFileSystem(quota);
    expect(readonly.capabilities.open).toBe(true);
    const reader = await readonly.open("/file", { access: "read" });
    expect(await reader.read(new Uint8Array(5), null)).toBe(5);
    await reader.close();
  });

  it("overlay and object providers explicitly refuse without touching underlying storage", async () => {
    const upper = new MemoryFileSystem();
    const lower = new MemoryFileSystem();
    const upperOpen = vi.spyOn(upper, "open");
    const lowerOpen = vi.spyOn(lower, "open");
    const transport = new MockS3Client({ buckets: ["bucket"] });
    const head = vi.spyOn(transport, "headObject");
    const fetch = vi.fn(async () => { throw new Error("must not fetch"); });
    const providers: FileSystem[] = [
      new OverlayFileSystem({ upper, lower }), new S3FileSystem({ bucket: "bucket", transport }),
      new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch }),
    ];
    for (const provider of providers) {
      expect(provider.capabilities.open).toBe(false);
      await expect(provider.open!("/file", { access: "read" })).rejects.toMatchObject({ code: "ENOTSUP", syscall: "open", path: "/file" });
    }
    expect(upperOpen).not.toHaveBeenCalled();
    expect(lowerOpen).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
