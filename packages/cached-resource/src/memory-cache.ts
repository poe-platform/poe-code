import { LRUCache } from "lru-cache";
import type { CachedData } from "./types.js";

export interface MemoryCacheOptions {
  max: number;
  ttl: number;
}

export interface MemoryCache<T> {
  get(key: string): CachedData<T> | undefined;
  set(key: string, value: CachedData<T>): void;
  clear(): void;
  readonly size: number;
  readonly max: number;
}

export function createMemoryCache<T>(
  options: MemoryCacheOptions,
): MemoryCache<T> {
  const lru = new LRUCache<string, CachedData<T>>({
    max: options.max,
    ttl: options.ttl,
    allowStale: false,
  });

  return {
    get: (key) => lru.get(key),
    set: (key, value) => lru.set(key, value),
    clear: () => lru.clear(),
    get size() {
      return lru.size;
    },
    get max() {
      return lru.max;
    },
  };
}
