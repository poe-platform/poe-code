import { Volume, createFsFromVolume } from "memfs";
import { vi } from "vitest";
import type { CachedData } from "../types.js";
import type { CachedResource, CacheStats } from "../create-cached-resource.js";
import type { DiskCacheFs } from "../disk-cache.js";

export type MockCachedResource<T> = {
  [K in keyof CachedResource<T>]: CachedResource<T>[K] extends (...args: infer A) => infer R
    ? ReturnType<typeof vi.fn<(...args: A) => R>>
    : CachedResource<T>[K];
};

export function createMemFs(files: Record<string, string> = {}): DiskCacheFs {
  const vol = Volume.fromJSON(files, "/");
  const fs = createFsFromVolume(vol).promises;
  return {
    readFile: (p: string, encoding: BufferEncoding) =>
      fs.readFile(p, encoding) as Promise<string>,
    writeFile: (p: string, data: string) =>
      fs.writeFile(p, data) as Promise<void>,
    rename: (from: string, to: string) => fs.rename(from, to) as Promise<void>,
    mkdir: (p: string, options?: { recursive?: boolean }) =>
      fs.mkdir(p, options) as Promise<void>,
    unlink: (p: string) => fs.unlink(p) as Promise<void>,
    realpath: (p: string) => fs.realpath(p) as Promise<string>,
  };
}

export function createMockCachedResource<T>(bundledData: T): MockCachedResource<T> {
  const defaultResult: CachedData<T> = { data: bundledData, timestamp: 0 };
  const defaultStats: CacheStats = { memoryCacheSize: 0, memoryCacheMax: 0, cacheDir: "" };

  return {
    get: vi.fn<(options?: import("../types.js").FetchOptions) => Promise<CachedData<T>>>()
      .mockResolvedValue(defaultResult),
    refresh: vi.fn<() => Promise<CachedData<T>>>()
      .mockResolvedValue(defaultResult),
    clear: vi.fn<() => Promise<void>>()
      .mockResolvedValue(undefined),
    stats: vi.fn<() => CacheStats>()
      .mockReturnValue(defaultStats),
  };
}
