import type { CachedData, CacheConfig, FetchOptions } from "./types.js";
import type { MemoryCache } from "./memory-cache.js";
import type { DiskCacheFs } from "./disk-cache.js";
import type { Revalidator } from "./background-revalidator.js";
import { loadFromDisk, persist } from "./disk-cache.js";
import { fetchFromApi, validateFetchConfig } from "./api-fetch.js";

export interface CacheOrchestratorDeps<T> {
  memoryCache: MemoryCache<T>;
  fs: DiskCacheFs;
  fetch?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  revalidator?: Revalidator;
}

export async function resolveData<T>(
  bundledData: T,
  config: CacheConfig,
  deps: CacheOrchestratorDeps<T>,
  options?: FetchOptions,
): Promise<CachedData<T>> {
  if (!Number.isFinite(config.freshTtl) || config.freshTtl < 0) {
    throw new Error("freshTtl must be a finite non-negative number");
  }

  const { forceRefresh, offline, preferOffline } = options ?? {};

  if (!forceRefresh) {
    const memoryCached = deps.memoryCache.get(config.cacheName);
    if (memoryCached) {
      const isStale = Date.now() - memoryCached.timestamp > config.freshTtl;
      if (isStale && deps.revalidator && !offline && !preferOffline) {
        deps.revalidator.trigger(config.cacheName, async () => {
          const data = await fetchFromApi<T>(config, { fetch: deps.fetch });
          const cached: CachedData<T> = { data, timestamp: Date.now() };
          deps.memoryCache.set(config.cacheName, cached);
          await persist(data, config, { fs: deps.fs });
        });
      }
      return memoryCached;
    }

    const diskCached = await loadFromDisk<T>(config, { fs: deps.fs });
    if (diskCached) {
      deps.memoryCache.set(config.cacheName, diskCached);

      const isStale = Date.now() - diskCached.timestamp > config.freshTtl;
      if (isStale && deps.revalidator && !offline && !preferOffline) {
        deps.revalidator.trigger(config.cacheName, async () => {
          const data = await fetchFromApi<T>(config, { fetch: deps.fetch });
          const cached: CachedData<T> = { data, timestamp: Date.now() };
          deps.memoryCache.set(config.cacheName, cached);
          await persist(data, config, { fs: deps.fs });
        });
      }

      return diskCached;
    }
  }

  if (offline) {
    return { data: bundledData, timestamp: 0 };
  }

  if (preferOffline && !forceRefresh) {
    return { data: bundledData, timestamp: 0 };
  }

  validateFetchConfig(config);

  try {
    const data = await fetchFromApi<T>(config, { fetch: deps.fetch });
    const cached: CachedData<T> = { data, timestamp: Date.now() };
    deps.memoryCache.set(config.cacheName, cached);
    await persist(data, config, { fs: deps.fs });
    return cached;
  } catch {
    return { data: bundledData, timestamp: 0 };
  }
}
