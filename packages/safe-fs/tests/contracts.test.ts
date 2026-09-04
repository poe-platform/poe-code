import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import {
  FsError,
  MemoryFileSystem,
  RealFileSystem,
  S3FileSystem,
  MockS3Client,
  MountFileSystem,
  OverlayFileSystem,
  ReadOnlyFileSystem,
  collectBytes,
  toByteSource,
  createRealFileSystem,
  createMemoryFileSystem,
  createMountFileSystem,
  createOverlayFileSystem,
  createReadOnlyFileSystem
} from "@poe-code/safe-fs";
import type { FileSystem } from "@poe-code/safe-fs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  const promises = {
    ...fs.promises,
    async open(filename: string, flags: number, mode?: number) {
      const handle = await fs.promises.open(filename, flags, mode);
      if ((flags & fs.constants.O_APPEND) !== 0) {
        const write = handle.write.bind(handle);
        handle.write = async (buffer, offset, length, position) =>
          write(buffer, offset, length, position ?? Number((await handle.stat()).size));
      }
      return handle;
    }
  };
  return { ...promises, default: promises };
});

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return { constants: fs.constants };
});

beforeEach(() => {
  vol.reset();
  vol.fromJSON({ "/machine/.keep": "", "/outside/secret": "outside" });
});

const adapters: Array<{ name: string; create: () => FileSystem }> = [
  { name: "memory", create: () => new MemoryFileSystem() },
  { name: "machine directory (memfs)", create: () => new RealFileSystem({ root: "/machine" }) },
  {
    name: "S3 mock",
    create: () =>
      new S3FileSystem({
        transport: new MockS3Client({ buckets: ["test"] }),
        bucket: "test",
        allowNonAtomicRename: true
      })
  },
  { name: "mount", create: () => new MountFileSystem({ root: new MemoryFileSystem() }) },
  {
    name: "overlay",
    create: () =>
      new OverlayFileSystem({ lower: new MemoryFileSystem(), upper: new MemoryFileSystem() })
  }
];

describe.each(adapters)("shared contract: $name", ({ create }) => {
  it("preserves binary bytes, exclusive creation, append, copy and rename", async () => {
    const filesystem = create();
    const bytes = new Uint8Array([0, 255, 128, 10]);
    await filesystem.mkdir("/dir");
    await filesystem.writeFile("/dir/data", bytes, { flag: "wx" });
    bytes.fill(9);
    expect(await filesystem.readFile("/dir/data")).toEqual(new Uint8Array([0, 255, 128, 10]));
    await expect(filesystem.writeFile("/dir/data", bytes, { flag: "wx" })).rejects.toMatchObject({
      code: "EEXIST"
    });
    await filesystem.appendFile("/dir/data", new Uint8Array([7]));
    await filesystem.copyFile("/dir/data", "/dir/copy");
    await filesystem.rename("/dir/copy", "/dir/moved");
    expect(await filesystem.readFile("/dir/moved")).toEqual(new Uint8Array([0, 255, 128, 10, 7]));
    expect((await filesystem.readdir("/dir")).map((entry) => entry.name).sort()).toEqual([
      "data",
      "moved"
    ]);
    await expect(filesystem.readFile("/dir/moved", { maxBytes: 4 })).rejects.toMatchObject({
      code: "EFBIG"
    });
  });

  it("rejects missing paths with the shared error constructor", async () => {
    const error = await create()
      .readFile("/missing")
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(FsError);
    expect(error).toMatchObject({ code: "ENOENT" });
  });

  it("honors cancellation without publishing writes", async () => {
    const filesystem = create();
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(
      filesystem.writeFile("/cancelled", new Uint8Array([1]), { signal: controller.signal })
    ).rejects.toBeDefined();
    await expect(filesystem.stat("/cancelled")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves conservative append capability declarations through wrappers", () => {
    const writable = create();
    const readonly = new ReadOnlyFileSystem(writable);
    expect(writable.capabilities.append).toBe(true);
    expect(readonly.capabilities.append).toBe(false);
    expect(new MountFileSystem({ root: readonly }).capabilities.append).toBe(false);
    expect(new MountFileSystem({ root: writable }).capabilities.append).toBe(true);
    expect(new OverlayFileSystem({ upper: readonly, lower: writable }).capabilities.append).toBe(false);
    const overlay = new OverlayFileSystem({ upper: writable, lower: create() });
    expect(overlay.capabilities.append).toBe(!overlay.capabilities.readOnly);
  });

  it("preserves retained stream chunks when a producer reuses its buffer", async () => {
    const filesystem = create();
    expect(filesystem.capabilities.streamingWrite).toBe(true);
    const fragment = Buffer.from([1, 2]);
    await filesystem.writeStream!(
      "/stream",
      (async function* () {
        yield fragment;
        fragment.fill(3);
        yield fragment;
      })()
    );
    expect(await filesystem.readFile("/stream")).toEqual(new Uint8Array([1, 2, 3, 3]));
    expect(
      await collectBytes(filesystem.readStream!("/stream", { start: 1, endExclusive: 3 }), {
        maxBytes: 2
      })
    ).toEqual(new Uint8Array([2, 3]));
  });

  it("never uses empty-directory removal to delete descendants", async () => {
    const filesystem = create();
    await filesystem.mkdir("/dir");
    await filesystem.writeFile("/dir/child", new Uint8Array([1]));
    expect(filesystem.rmdir).toBeTypeOf("function");
    await expect(filesystem.rmdir!("/dir")).rejects.toMatchObject({ code: "ENOTEMPTY" });
    expect(await filesystem.readFile("/dir/child")).toEqual(new Uint8Array([1]));
  });
});

describe("composition and authority", () => {
  it("retains adapter factory identities", async () => {
    expect(createMemoryFileSystem()).toBeInstanceOf(MemoryFileSystem);
    expect(await createRealFileSystem({ root: "/machine" })).toBeInstanceOf(RealFileSystem);
    const root = createMemoryFileSystem();
    expect(createReadOnlyFileSystem(root)).toBeInstanceOf(ReadOnlyFileSystem);
    expect(createMountFileSystem({ root })).toBeInstanceOf(MountFileSystem);
    expect(createOverlayFileSystem({ lower: root, upper: new MemoryFileSystem() })).toBeInstanceOf(
      OverlayFileSystem
    );
  });

  it("resolves hardlink identities through readonly, mount and overlay views", async () => {
    const lower = new MemoryFileSystem();
    await lower.writeFile("/file", new Uint8Array([1]));
    await lower.link!("/file", "/alias");
    const readonly = new ReadOnlyFileSystem(lower);
    const overlay = new OverlayFileSystem({ lower, upper: new MemoryFileSystem() });
    const mounted = new MountFileSystem({
      root: new MemoryFileSystem(),
      mounts: { "/view": readonly, "/overlay": overlay }
    });
    expect(await lower.compareEntry!("/file", mounted, "/view/alias")).toBe("same");
    expect(await mounted.compareEntry!("/overlay/file", lower, "/alias")).toBe("same");
    const original = await lower.stat("/file");
    expect(await readonly.stat("/file")).toMatchObject({
      identityScope: original.identityScope,
      ino: original.ino,
      nlink: 2
    });
    await expect(readonly.writeFile("/file", new Uint8Array([2]))).rejects.toMatchObject({
      code: "EROFS"
    });
    await expect(overlay.writeFile("/file", new Uint8Array([3]))).rejects.toMatchObject({
      code: "ENOTSUP"
    });
    expect(await lower.readFile("/file")).toEqual(new Uint8Array([1]));
  });

  it("shares S3 authority through mock, prefix aliases and wrappers", async () => {
    const transport = new MockS3Client({ buckets: ["test"] });
    const root = new S3FileSystem({ transport, bucket: "test" });
    const prefixed = new S3FileSystem({ transport, bucket: "test", prefix: "dir" });
    await root.mkdir("/dir");
    await root.writeFile("/dir/file", new Uint8Array([1]));
    const wrapped = new ReadOnlyFileSystem(prefixed);
    expect(await root.compareEntry!("/dir/file", wrapped, "/file")).toBe("same");
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", new Uint8Array([1]));
    expect(await memory.compareEntry!("/file", wrapped, "/file")).toBe("distinct");
    expect(root.capabilities.snapshotRmdir).toBe(true);
    await expect(wrapped.rmdir("/")).rejects.toMatchObject({ code: "EROFS" });
  });

  it("preserves advisory allocation metadata through wrappers", async () => {
    const root = new MemoryFileSystem();
    await root.writeFile("/file", new Uint8Array([1]));
    const stat = await root.stat("/file");
    const view = new ReadOnlyFileSystem(root);
    expect((await view.stat("/file")).allocatedBytes).toBe(stat.allocatedBytes);
  });

  it("confines the existing machine-directory adapter and rejects escaping symlinks", async () => {
    const filesystem = new RealFileSystem({ root: "/machine" });
    await filesystem.writeFile("/safe", new Uint8Array([1]));
    expect(vol.readFileSync("/machine/safe")).toEqual(Buffer.from([1]));
    vol.symlinkSync("/outside/secret", "/machine/escape");
    await expect(filesystem.readFile("/escape")).rejects.toMatchObject({ code: "EACCES" });
    expect(vol.readFileSync("/outside/secret", "utf8")).toBe("outside");
  });

  it("requires an existing explicit machine root", async () => {
    await expect(createRealFileSystem({ root: "/absent" })).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect(vol.existsSync("/absent")).toBe(false);
  });

  it("collects owned bytes and enforces the collection limit", async () => {
    expect(await collectBytes(toByteSource("data"), { maxBytes: 4 })).toEqual(
      new TextEncoder().encode("data")
    );
    await expect(collectBytes(toByteSource("data"), { maxBytes: 3 })).rejects.toBeInstanceOf(
      FsError
    );
  });
});
