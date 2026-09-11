import { describe, expect, it, vi } from "vitest";
import { MemoryFileSystem, MountFileSystem, OverlayFileSystem, ReadOnlyFileSystem, DeviceFileSystem, scopeFileSystem, withFileSystemQuota } from "../src/index.js";
import { RealFileSystem } from "../src/fs/real/index.js";
import { S3FileSystem } from "../src/fs/s3/filesystem.js";
import { MockS3Client } from "../src/fs/s3/mock.js";
import { WebDavFileSystem } from "../src/fs/webdav/webdav.js";
import type { FileSystem } from "../src/contracts/filesystem.js";

const bytes = Uint8Array.of(1, 2, 3);
const wrappers = ["mount", "quota", "devices", "scope"];
function wrapFilesystem(wrapper: string, fs: FileSystem): FileSystem {
  if (wrapper === "mount") return new MountFileSystem({ root: fs });
  if (wrapper === "quota") return withFileSystemQuota(fs, { maxBytes: 100 });
  if (wrapper === "devices") return new DeviceFileSystem(fs);
  return scopeFileSystem(fs, () => {}, new AbortController().signal);
}

describe("atomic no-replace rename", () => {
  it.each(["file", "directory", "dangling symlink", "same path", "hardlink"])("preserves an existing %s", async kind => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/source", bytes);
    const destination = kind === "same path" ? "/source" : "/destination";
    if (kind === "file") await fs.writeFile(destination, Uint8Array.of(9));
    if (kind === "directory") await fs.mkdir(destination);
    if (kind === "dangling symlink") await fs.symlink("/missing", destination);
    if (kind === "hardlink") await fs.link("/source", destination);
    const before = await fs.lstat(destination);
    await expect(fs.rename("/source", destination, { noReplace: true })).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.lstat(destination)).toEqual(before);
    expect(await fs.readFile("/source")).toEqual(bytes);
  });

  it.each(["file", "directory", "symlink"])("atomically moves a %s to an absent entry", async kind => {
    const fs = new MemoryFileSystem();
    if (kind === "file") await fs.writeFile("/source", bytes);
    if (kind === "directory") { await fs.mkdir("/source"); await fs.writeFile("/source/child", bytes); }
    if (kind === "symlink") await fs.symlink("/missing", "/source");
    const before = await fs.lstat("/source");
    expect(fs.capabilities.atomicRenameNoReplace).toBe(true);
    await fs.rename("/source", "/destination", { noReplace: true });
    expect((await fs.lstat("/destination")).ino).toBe(before.ino);
    await expect(fs.lstat("/source")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("admits one concurrent publisher without replacing the winner", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/a", Uint8Array.of(1)); await fs.writeFile("/b", Uint8Array.of(2));
    const outcomes = await Promise.allSettled([fs.rename("/a", "/target", { noReplace: true }), fs.rename("/b", "/target", { noReplace: true })]);
    expect(outcomes.map(value => value.status)).toEqual(["fulfilled", "rejected"]);
    expect(await fs.readFile("/target")).toEqual(Uint8Array.of(1));
    expect(await fs.readFile("/b")).toEqual(Uint8Array.of(2));
  });

  it.each(wrappers)("%s forwards supported mode and refuses undeclared support", async wrapper => {
    const backing = new MemoryFileSystem();
    await backing.writeFile("/source", bytes);
    const rename = vi.spyOn(backing, "rename");
    const wrap = (fs: FileSystem) => wrapFilesystem(wrapper, fs);
    const fs = wrap(backing);
    const options = { noReplace: true, signal: new AbortController().signal };
    await fs.rename("/source", "/target", options);
    expect(rename).toHaveBeenLastCalledWith("/source", "/target", options);
    Object.defineProperty(backing, "capabilities", { value: { ...backing.capabilities, atomicRenameNoReplace: undefined } });
    rename.mockClear();
    await expect(wrap(backing).rename("/target", "/next", options)).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(rename).not.toHaveBeenCalled();
    expect(await backing.readFile("/target")).toEqual(bytes);
  });

  it.each(wrappers)("%s honors path support over global support", async wrapper => {
    for (const supported of [false, true]) {
      const backing = new MemoryFileSystem();
      await backing.writeFile("/source", bytes);
      const rename = vi.spyOn(backing, "rename");
      const backend: FileSystem = new Proxy(backing, {
        get(target, property) {
          if (property === "capabilities") return { ...target.capabilities, atomicRenameNoReplace: !supported };
          if (property === "capabilitiesFor") return async () => ({ atomicRenameNoReplace: supported });
          const member = Reflect.get(target, property);
          return typeof member === "function" ? member.bind(target) : member;
        },
      });
      const fs = wrapFilesystem(wrapper, backend);
      const move = fs.rename("/source", "/target", { noReplace: true });
      if (supported) { await move; expect(await backing.readFile("/target")).toEqual(bytes); }
      else { await expect(move).rejects.toMatchObject({ code: "ENOTSUP" }); expect(rename).not.toHaveBeenCalled(); }
    }
  });

  it.each(wrappers)("%s stops when capability admission is cancelled", async wrapper => {
    const backing = new MemoryFileSystem();
    await backing.writeFile("/source", bytes);
    const controller = new AbortController(); const reason = new Error("cancel admission");
    const backend: FileSystem = new Proxy(backing, {
      get(target, property) {
        if (property === "capabilitiesFor") return async () => {
          controller.abort(reason);
          return { atomicRenameNoReplace: true };
        };
        const member = Reflect.get(target, property);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    const rename = vi.spyOn(backing, "rename");
    const fs = wrapFilesystem(wrapper, backend);
    await expect(fs.rename("/source", "/target", { noReplace: true, signal: controller.signal })).rejects.toBe(reason);
    expect(rename).not.toHaveBeenCalled();
    expect(await backing.readFile("/source")).toEqual(bytes);
  });

  it("selects no-replace support per mount and refuses cross-mount moves", async () => {
    const backing = new MemoryFileSystem();
    await backing.writeFile("/source", bytes);
    const fs = new MountFileSystem({ root: backing, mounts: { "/other": new MemoryFileSystem() } });
    expect(fs.capabilities.atomicRenameNoReplace).toBeUndefined();
    expect((await fs.capabilitiesFor("/new")).atomicRenameNoReplace).toBe(true);
    await expect(fs.rename("/source", "/other/target", { noReplace: true })).rejects.toMatchObject({ code: "EXDEV" });
    expect(await backing.readFile("/source")).toEqual(bytes);
  });

  it("device paths refuse no-replace publication without touching the backing source", async () => {
    const backing = new MemoryFileSystem();
    await backing.writeFile("/source", bytes);
    const fs = new DeviceFileSystem(backing);
    expect((await fs.capabilitiesFor("/dev/null")).atomicRenameNoReplace).toBe(false);
    const rename = vi.spyOn(backing, "rename");
    await expect(fs.rename("/source", "/dev/null", { noReplace: true })).rejects.toMatchObject({ code: "EBUSY" });
    expect(rename).not.toHaveBeenCalled();
    expect(await backing.readFile("/source")).toEqual(bytes);
  });

  it.each([undefined, false])("ordinary remote rename retains normalized cancellation (noReplace=%s)", async noReplace => {
    const fetch = vi.fn(async () => { throw new Error("unexpected request"); });
    const adapters: FileSystem[] = [
      new S3FileSystem({ bucket: "bucket", transport: new MockS3Client({ buckets: ["bucket"] }), allowNonAtomicRename: true }),
      new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch }),
    ];
    for (const fs of [...adapters, ...adapters.map(fs => withFileSystemQuota(fs, { maxBytes: 100 }))]) {
      await expect(fs.rename("/source", "/target", { signal: AbortSignal.abort(), ...(noReplace === undefined ? {} : { noReplace }) }))
        .rejects.toMatchObject({ code: "ECANCELED" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("unsupported adapters refuse before remote requests or overlay publication", async () => {
    const fetch = vi.fn(async () => { throw new Error("unexpected request"); });
    const upper = new MemoryFileSystem(); const lower = new MemoryFileSystem();
    await lower.writeFile("/source", bytes);
    const adapters: FileSystem[] = [
      new RealFileSystem("/nonexistent-no-replace-root"),
      new S3FileSystem({ bucket: "bucket", transport: new MockS3Client({ buckets: ["bucket"] }), allowNonAtomicRename: true }),
      new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch }),
      new OverlayFileSystem({ upper, lower }),
    ];
    for (const fs of adapters) {
      expect(fs.capabilities.atomicRenameNoReplace).toBe(false);
      await expect(fs.rename("/source", "/target", { noReplace: true })).rejects.toMatchObject({ code: "ENOTSUP" });
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(await upper.readdir("/")).toEqual([]);
    expect(await lower.readFile("/source")).toEqual(bytes);
    expect(new ReadOnlyFileSystem(lower).capabilities.atomicRenameNoReplace).toBe(false);
    const controller = new AbortController();
    const reason = new Error("cancel no-replace rename");
    controller.abort(reason);
    for (const fs of [...adapters, lower, new MountFileSystem({ root: lower }), withFileSystemQuota(lower, { maxBytes: 100 })]) {
      await expect(fs.rename("/source", "/target", { noReplace: true, signal: controller.signal })).rejects.toBe(reason);
    }
  });
});
