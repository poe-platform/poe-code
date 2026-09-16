import { beforeEach, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { RealFileSystem } from "../src/fs/real/index.js";

const geometry = vi.hoisted(() => ({ blksize: undefined as unknown }));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    async stat(path: string) {
      return Object.assign(await fs.promises.stat(path), { blksize: geometry.blksize });
    },
    async lstat(path: string) {
      return Object.assign(await fs.promises.lstat(path), { blksize: geometry.blksize });
    },
  };
});

beforeEach(() => {
  vol.reset();
  vol.fromJSON({ "/root/file": "data" });
  vol.symlinkSync("file", "/root/link");
});

it.each([1, 4096, 65536, Number.MAX_SAFE_INTEGER])("real adapter preserves native preferred I/O size %s", async blksize => {
  geometry.blksize = blksize;
  const fs = new RealFileSystem("/root");
  for (const path of ["/", "/file", "/link"]) {
    for (const operation of ["stat", "lstat"] as const) {
      expect((await fs[operation](path)).ioBlockSize).toBe(blksize);
    }
  }
});

it.each([undefined, null, "4096", false, 0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 4096n])("real adapter omits unusable native preferred I/O size %s", async blksize => {
  geometry.blksize = blksize;
  const fs = new RealFileSystem("/root");
  for (const operation of ["stat", "lstat"] as const) {
    const metadata = await fs[operation]("/file");
    expect(Object.hasOwn(metadata, "ioBlockSize")).toBe(false);
    expect(metadata.size).toBe(4);
  }
});
