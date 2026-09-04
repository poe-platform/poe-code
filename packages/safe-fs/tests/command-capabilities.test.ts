import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { OverlayFileSystem } from "../src/fs/overlay/index.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";
import { S3FileSystem } from "../src/fs/s3/filesystem.js";
import { MockS3Client } from "../src/fs/s3/mock.js";
import { WebDavFileSystem } from "../src/fs/webdav/webdav.js";
import type { FileSystem, FileSystemCapabilities } from "../src/contracts/filesystem.js";

function declared(capabilities: FileSystemCapabilities): FileSystem {
  const backing = new MemoryFileSystem();
  return new Proxy(backing, {
    get(target, property) {
      if (property === "capabilities") return capabilities;
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}

describe("semantic command capabilities", () => {
  it("declares memory write modes and explicit directories without inferring from methods", () => {
    expect(new MemoryFileSystem().capabilities).toMatchObject({
      write: true, append: true, exclusiveCreate: true, explicitDirectories: true, implicitDirectories: false,
      mkdir: true, recursiveMkdir: true, remove: true, removeDirectory: true, recursiveRemove: true,
      rename: true, copy: true, exclusiveCopy: true, readlink: true, streamingAppend: true,
    });
  });

  it("preserves readonly link inspection while rejecting every mutation mode", () => {
    const fs = new ReadOnlyFileSystem(new MemoryFileSystem());
    expect(fs.capabilities).toMatchObject({ readlink: true, explicitDirectories: true,
      write: false, exclusiveCreate: false, streamingAppend: false, mkdir: false, rename: false, removeDirectory: false });
  });

  it("distinguishes unsupported overlay mutations from a readonly upper policy", () => {
    const unavailable = new OverlayFileSystem({ lower: new MemoryFileSystem(), upper: declared({ atomicRename: false, readOnly: false }) });
    expect(unavailable.capabilities.readOnly).toBe(false);
    expect(unavailable.capabilities.write).toBe(false);
    const readonly = new OverlayFileSystem({ lower: new MemoryFileSystem(), upper: new ReadOnlyFileSystem(new MemoryFileSystem()) });
    expect(readonly.capabilities.readOnly).toBe(true);
  });

  it("does not treat a heterogeneous mount as uniformly supported or unsupported", () => {
    const fs = new MountFileSystem({ root: new MemoryFileSystem(), mounts: {
      "/restricted": declared({ write: false, timestamps: false, symlinks: false, rename: false }),
    } });
    for (const capability of ["write", "timestamps", "symlinks", "rename"]) {
      expect(fs.capabilities[capability], capability).toBeUndefined();
    }
    const unknown = new MountFileSystem({ root: declared({}) });
    expect(unknown.capabilities.write).toBeUndefined();
    expect(unknown.capabilities.timestamps).toBeUndefined();
    const twoWritable = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/other": new MemoryFileSystem() } });
    expect(twoWritable.capabilities.rename).toBeUndefined();
  });

  it("resolves selected mount capabilities without mutating missing targets", async () => {
    const memory = new MemoryFileSystem();
    const readonly = new ReadOnlyFileSystem(new MemoryFileSystem());
    const mounted = new MountFileSystem({ root: memory, mounts: { "/readonly": readonly } });
    expect(await mounted.capabilitiesFor("/new")).toMatchObject({ write: true, randomAccessWrite: true });
    expect(await mounted.capabilitiesFor("/readonly/new")).toMatchObject({ write: false, randomAccessWrite: false });
    expect(await withFileSystemQuota(mounted, { maxBytes: 64 }).capabilitiesFor!("/readonly/new")).toMatchObject({ streamingWrite: false });
    expect(await new ReadOnlyFileSystem(mounted).capabilitiesFor("/new")).toMatchObject({ write: false });
    await expect(memory.stat("/new")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("omits destination-dependent native copy and rename claims on composed paths", async () => {
    const backend = declared({ ...new MemoryFileSystem().capabilities, rename: false, copy: false, exclusiveCopy: false });
    const mounted = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/other": backend } });
    const selected = await mounted.capabilitiesFor("/other/new");
    expect(Object.isFrozen(selected)).toBe(true);
    for (const capability of ["rename", "copy", "exclusiveCopy"]) {
      expect(Object.hasOwn(selected, capability), capability).toBe(false);
      expect(mounted.capabilities[capability], capability).toBeUndefined();
    }
    const unavailable = new MountFileSystem({ root: new MemoryFileSystem(), mounts: {
      "/other": declared({ ...backend.capabilities, write: false, streamingWrite: false, exclusiveCreate: false }),
    } });
    expect(await unavailable.capabilitiesFor("/other/new")).toMatchObject({ copy: false, exclusiveCopy: false });
  });

  it("does not reject the existing exclusive-publication route on a create-only destination", async () => {
    const root = new MemoryFileSystem();
    await root.writeFile("/source", Uint8Array.of(1, 2, 3));
    const backend = declared({ ...root.capabilities, copy: false, exclusiveCopy: false,
      write: false, streamingWrite: false, exclusiveCreate: true });
    const mounted = new MountFileSystem({ root, mounts: { "/create-only": backend } });
    await mounted.copyFile("/source", "/create-only/new", { exclusive: true });
    expect(await backend.readFile("/new")).toEqual(Uint8Array.of(1, 2, 3));
    const selected = await mounted.capabilitiesFor("/create-only/next");
    expect(Object.hasOwn(selected, "copy")).toBe(false);
    expect(Object.hasOwn(selected, "exclusiveCopy")).toBe(false);
    expect(selected.exclusiveCreate).toBe(true);
  });

  it("quota streams report their incremental route, not the underlying atomic stream", () => {
    const fs = withFileSystemQuota(declared({ write: true, append: false, streamingWrite: true, streamingAppend: true }), { maxBytes: 64 });
    expect(fs.capabilities.streamingWrite).toBe(false);
    expect(fs.capabilities.streamingAppend).toBe(false);
  });

  it("retains unknown append support despite mandatory methods being present", () => {
    const unknown = declared({ atomicRename: true });
    expect(unknown.appendFile).toBeTypeOf("function");
    expect(unknown.capabilities.append).toBeUndefined();
    expect(new MountFileSystem({ root: unknown }).capabilities.append).toBeUndefined();
    expect(new OverlayFileSystem({ upper: unknown, lower: new MemoryFileSystem() }).capabilities.append).toBeUndefined();
    expect(withFileSystemQuota(unknown, { maxBytes: 64 }).capabilities.streamingAppend).toBeUndefined();
    expect(new ReadOnlyFileSystem(unknown).capabilities.append).toBe(false);
  });

  it("overlay does not turn missing upper primitives into advertised mutations", () => {
    const fs = new OverlayFileSystem({ lower: new MemoryFileSystem(), upper: declared({
      atomicRename: true, write: false, exclusiveCreate: false, mkdir: false, recursiveMkdir: false,
      streamingWrite: true, streamingRead: true, append: true,
    }) });
    expect(fs.capabilities.write).toBe(false);
    expect(fs.capabilities.exclusiveCreate).toBe(false);
    expect(fs.capabilities.mkdir).toBe(false);
    expect(fs.capabilities.streamingWrite).toBe(false);
    expect(fs.capabilities.append).toBe(false);
  });

  it("S3 separates ordinary writes from conditional and configured rename primitives", () => {
    const transport = new MockS3Client({ buckets: ["bucket"] });
    const fs = new S3FileSystem({ bucket: "bucket", transport, allowNonAtomicRename: false });
    expect(fs.capabilities).toMatchObject({ write: true, exclusiveCreate: true, append: true, rename: false,
      explicitDirectories: true, implicitDirectories: true, readlink: false });
    const withoutConditions = new Proxy(transport, {
      get(target, property) {
        if (property === "capabilities") return {};
        const member = Reflect.get(target, property);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    expect(new S3FileSystem({ bucket: "bucket", transport: withoutConditions }).capabilities).toMatchObject({
      write: true, append: false, exclusiveCreate: false, rename: false, streamingAppend: false,
    });
  });

  it("WebDAV does not advertise safe empty-directory removal without a binding", () => {
    const fs = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch: async () => { throw new Error("unexpected network"); } });
    expect(fs.capabilities).toMatchObject({ write: true, exclusiveCreate: true, removeDirectory: false, readlink: false, truncate: false });
  });
});
