import { describe, expect, it } from "vitest";
import type { FileStat, FileSystem, FsOptions } from "../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { OverlayFileSystem } from "../src/fs/overlay/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";
import { bridgeStats } from "../src/bridge/stats.js";

class GeometryFileSystem extends MemoryFileSystem {
  constructor(readonly preferredSize?: number) { super(); }

  override async stat(path: string, options?: FsOptions): Promise<FileStat> {
    const metadata = { ...await super.stat(path, options) };
    delete metadata.ioBlockSize;
    return this.preferredSize === undefined ? metadata : { ...metadata, ioBlockSize: this.preferredSize };
  }

  override async lstat(path: string, options?: FsOptions): Promise<FileStat> {
    const metadata = { ...await super.lstat(path, options) };
    delete metadata.ioBlockSize;
    return this.preferredSize === undefined ? metadata : { ...metadata, ioBlockSize: this.preferredSize };
  }
}

it("memory metadata declares its existing virtual stream preference, not physical allocation", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array(64 * 1024 + 1));
  await fs.symlink("/file", "/link");
  for (const path of ["/", "/file", "/link"]) {
    for (const operation of ["stat", "lstat"] as const) {
      const metadata = await fs[operation](path);
      expect(metadata.ioBlockSize).toBe(64 * 1024);
      expect(metadata.allocatedBytes).toBeUndefined();
    }
  }
  const chunks: number[] = [];
  for await (const chunk of fs.readStream("/file")) chunks.push(chunk.length);
  expect(chunks).toEqual([64 * 1024, 1]);
  const explicit: number[] = [];
  for await (const chunk of fs.readStream("/file", { chunkSize: 32768 })) explicit.push(chunk.length);
  expect(explicit).toEqual([32768, 32768, 1]);
  await fs.truncate("/file", 0);
  expect((await fs.stat("/file")).ioBlockSize).toBe(64 * 1024);
});

const wrappers: Record<string, (backend: FileSystem) => FileSystem> = {
  readonly: backend => new ReadOnlyFileSystem(backend),
  mount: backend => new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/volume": backend } }),
  overlay: backend => new OverlayFileSystem({ lower: backend, upper: new MemoryFileSystem() }),
  quota: backend => withFileSystemQuota(backend, { maxBytes: 1024 }),
};

describe.each(Object.entries(wrappers))("%s preferred I/O metadata", (name, wrap) => {
  it.each([undefined, 1, 16384, Number.MAX_SAFE_INTEGER])("preserves known geometry or absence: %s", async preferredSize => {
    const backend = new GeometryFileSystem(preferredSize);
    await backend.writeFile("/file", new Uint8Array(3));
    await backend.symlink("/file", "/link");
    const fs = wrap(backend);
    for (const entry of ["file", "link"]) {
      const path = name === "mount" ? `/volume/${entry}` : `/${entry}`;
      for (const operation of ["stat", "lstat"] as const) {
        const metadata = await fs[operation](path);
        expect(metadata.ioBlockSize).toBe(preferredSize);
        expect(Object.hasOwn(metadata, "ioBlockSize")).toBe(preferredSize !== undefined);
        expect(metadata.allocatedBytes).toBeUndefined();
      }
    }
  });
});

it.each([undefined, 32768])("overlay copy-up reports the selected upper geometry: %s", async upperSize => {
  const lower = new GeometryFileSystem(8192);
  const upper = new GeometryFileSystem(upperSize);
  await lower.writeFile("/file", new Uint8Array([1, 2]));
  const fs = new OverlayFileSystem({ lower, upper });
  expect((await fs.stat("/file")).ioBlockSize).toBe(8192);
  await fs.writeFile("/file", new Uint8Array([3]));
  for (const operation of ["stat", "lstat"] as const) {
    const metadata = await fs[operation]("/file");
    expect(metadata.ioBlockSize).toBe(upperSize);
    expect(Object.hasOwn(metadata, "ioBlockSize")).toBe(upperSize !== undefined);
  }
  expect((await lower.stat("/file")).ioBlockSize).toBe(8192);
});

it("mount synthetic ancestors do not acquire backing geometry", async () => {
  const fs = new MountFileSystem({ root: new GeometryFileSystem(), mounts: { "/virtual/nested": new GeometryFileSystem(8192) } });
  expect(Object.hasOwn(await fs.stat("/virtual"), "ioBlockSize")).toBe(false);
});

it.each([1, 16384, 65536, Number.MAX_SAFE_INTEGER])("bridge exposes known preferred I/O size %s", async ioBlockSize => {
  const fs = new GeometryFileSystem(ioBlockSize);
  await fs.writeFile("/file", new Uint8Array(7));
  const metadata = await fs.stat("/file");
  expect(bridgeStats(metadata).blksize).toBe(ioBlockSize);
  expect(metadata.allocatedBytes).toBeUndefined();
});

it("bridge legacy fallback does not populate absent canonical metadata", async () => {
  const fs = new GeometryFileSystem();
  const metadata = await fs.stat("/");
  expect(bridgeStats(metadata).blksize).toBe(4096);
  expect(Object.hasOwn(metadata, "ioBlockSize")).toBe(false);
});
