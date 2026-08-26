import fs from "node:fs/promises";
import type { CachedData, CacheConfig, FetchOptions } from "./types.js";
import type { DiskCacheFs } from "./disk-cache.js";
import { removeFromDisk } from "./disk-cache.js";
import { createMemoryCache } from "./memory-cache.js";
import { createRevalidator } from "./background-revalidator.js";
import { resolveData } from "./cache-orchestrator.js";

export interface CachedResourceDeps {
  fs?: DiskCacheFs;
  fetch?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
}

export interface CacheStats {
  memoryCacheSize: number;
  memoryCacheMax: number;
  cacheDir: string;
}

export interface CachedResource<T> {
  get(options?: FetchOptions): Promise<CachedData<T>>;
  refresh(): Promise<CachedData<T>>;
  clear(): Promise<void>;
  stats(): CacheStats;
}

function createDefaultFs(): DiskCacheFs {
  return {
    readFile: (path, encoding) => fs.readFile(path, encoding),
    writeFile: (path, data, options) => fs.writeFile(path, data, options),
    rename: (from, to) => fs.rename(from, to),
    mkdir: (path, options) => fs.mkdir(path, options).then(() => {}),
    unlink: (path) => fs.unlink(path),
    realpath: (path) => fs.realpath(path),
  };
}

export function createCachedResource<T>(
  bundledData: T,
  config: CacheConfig,
  deps?: CachedResourceDeps,
): CachedResource<T> {
  const diskFs = deps?.fs ?? createDefaultFs();

  const memoryCache = createMemoryCache<T>({
    max: 100,
    ttl: config.staleTtl,
  });

  const revalidator = createRevalidator();
  const pendingResolutions = new Set<Promise<CachedData<T>>>();

  return {
    get(options?: FetchOptions): Promise<CachedData<T>> {
      const resolution = resolveData(bundledData, config, {
        memoryCache,
        fs: diskFs,
        fetch: deps?.fetch,
        revalidator,
      }, options);
      pendingResolutions.add(resolution);
      void resolution.then(
        () => pendingResolutions.delete(resolution),
        () => pendingResolutions.delete(resolution),
      );
      return resolution.then(cloneCachedData);
    },

    refresh(): Promise<CachedData<T>> {
      return this.get({ forceRefresh: true });
    },

    async clear(): Promise<void> {
      await Promise.allSettled([...pendingResolutions]);
      await revalidator.waitForRevalidation(config.cacheName);
      memoryCache.clear();
      await removeFromDisk(config, { fs: diskFs });
    },

    stats(): CacheStats {
      return {
        memoryCacheSize: memoryCache.size,
        memoryCacheMax: memoryCache.max,
        cacheDir: config.cacheDir,
      };
    },
  };
}

function cloneCachedData<T>(cached: CachedData<T>): CachedData<T> {
  return structuredClone(cached);
}
