import { describe, it, expect, vi, beforeEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { fetchFromApi } from "./api-fetch.js";
import { createRevalidator } from "./background-revalidator.js";
import { resolveData } from "./cache-orchestrator.js";
import { createCachedResource } from "./create-cached-resource.js";
import {
  loadFromDisk,
  persist,
  removeFromDisk,
  resolveCacheDir,
} from "./disk-cache.js";
import type { DiskCacheFs } from "./disk-cache.js";
import { createMemoryCache } from "./memory-cache.js";
import type { MemoryCache } from "./memory-cache.js";
import type { CachedData, FetchOptions, CacheConfig } from "./types.js";
import {
  createMemFs as testingCreateMemFs,
  createMockCachedResource,
} from "./testing/index.js";

function createMemFs(files: Record<string, string> = {}): DiskCacheFs {
  const vol = Volume.fromJSON(files, "/");
  const fs = createFsFromVolume(vol).promises;
  return {
    readFile: (p: string, encoding: BufferEncoding) =>
      fs.readFile(p, encoding) as Promise<string>,
    writeFile: (p: string, data: string) =>
      fs.writeFile(p, data) as Promise<void>,
    mkdir: (p: string, options?: { recursive?: boolean }) =>
      fs.mkdir(p, options) as Promise<void>,
    unlink: (p: string) => fs.unlink(p) as Promise<void>,
  };
}

function createMockFetch(data: unknown) {
  return vi
    .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve(data),
    } as Response);
}

function createFailingFetch() {
  return vi
    .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
    .mockRejectedValue(new Error("Network error"));
}

function createMockMemoryCache<T>(): MemoryCache<T> {
  const store = new Map<string, CachedData<T>>();
  return {
    get: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value);
    },
    clear: () => store.clear(),
    get size() {
      return store.size;
    },
    get max() {
      return 100;
    },
  };
}

const defaultConfig: CacheConfig = {
  freshTtl: 60_000,
  staleTtl: 300_000,
  fetchTimeout: 5_000,
  apiEndpoint: "https://api.example.com/data",
  cacheDir: "/cache",
  cacheName: "test",
};

const bundledData = ["bundled-a", "bundled-b"];

// ---------------------------------------------------------------------------
// fetchFromApi
// ---------------------------------------------------------------------------
describe("fetchFromApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches JSON from the configured API endpoint", async () => {
    const data = { items: ["a", "b"] };
    const mockFetch = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(data),
      } as Response);

    const result = await fetchFromApi<{ items: string[] }>(
      { apiEndpoint: "https://api.example.com/data", fetchTimeout: 5000 },
      { fetch: mockFetch },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/data",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result).toEqual(data);
  });

  it("passes an AbortSignal to fetch", async () => {
    const mockFetch = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve({}),
      } as Response);

    await fetchFromApi(
      { apiEndpoint: "https://api.example.com/data", fetchTimeout: 5000 },
      { fetch: mockFetch },
    );

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws a descriptive error for non-OK HTTP responses", async () => {
    const mockFetch = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: () => Promise.resolve({}),
      } as Response);

    await expect(
      fetchFromApi(
        { apiEndpoint: "https://api.example.com/data", fetchTimeout: 5000 },
        { fetch: mockFetch },
      ),
    ).rejects.toThrow("HTTP 404: Not Found");
  });

  it("throws a timeout error when the request is aborted", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    const mockFetch = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValue(abortError);

    await expect(
      fetchFromApi(
        { apiEndpoint: "https://api.example.com/data", fetchTimeout: 1000 },
        { fetch: mockFetch },
      ),
    ).rejects.toThrow("Request timed out after 1000ms");
  });

  it("normalizes Error-shaped AbortError timeout failures", async () => {
    const mockFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted by signal"), { name: "AbortError" }));
        });
      })
    );

    await expect(
      fetchFromApi(
        { apiEndpoint: "https://api.example.com/data", fetchTimeout: 1 },
        { fetch: mockFetch },
      ),
    ).rejects.toThrow("Request timed out after 1ms");
  });

  it("rethrows non-abort errors as-is", async () => {
    const networkError = new Error("Network failure");
    const mockFetch = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValue(networkError);

    await expect(
      fetchFromApi(
        { apiEndpoint: "https://api.example.com/data", fetchTimeout: 5000 },
        { fetch: mockFetch },
      ),
    ).rejects.toThrow("Network failure");
  });
});

// ---------------------------------------------------------------------------
// createRevalidator
// ---------------------------------------------------------------------------
describe("createRevalidator", () => {
  it("executes the revalidation callback", async () => {
    const revalidator = createRevalidator();
    const callback = vi.fn().mockResolvedValue(undefined);

    revalidator.trigger("key", callback);
    await revalidator.waitForRevalidation("key");

    expect(callback).toHaveBeenCalledOnce();
  });

  it("deduplicates concurrent revalidation requests for the same key", async () => {
    const revalidator = createRevalidator();
    let resolveFirst!: () => void;
    const firstCallback = vi.fn(
      () => new Promise<void>((r) => (resolveFirst = r)),
    );
    const secondCallback = vi.fn().mockResolvedValue(undefined);

    revalidator.trigger("key", firstCallback);
    revalidator.trigger("key", secondCallback);

    resolveFirst();
    await revalidator.waitForRevalidation("key");

    expect(firstCallback).toHaveBeenCalledOnce();
    expect(secondCallback).not.toHaveBeenCalled();
  });

  it("allows new revalidation after previous one completes", async () => {
    const revalidator = createRevalidator();
    const firstCallback = vi.fn().mockResolvedValue(undefined);
    const secondCallback = vi.fn().mockResolvedValue(undefined);

    revalidator.trigger("key", firstCallback);
    await revalidator.waitForRevalidation("key");

    revalidator.trigger("key", secondCallback);
    await revalidator.waitForRevalidation("key");

    expect(firstCallback).toHaveBeenCalledOnce();
    expect(secondCallback).toHaveBeenCalledOnce();
  });

  it("silently catches revalidation failures", async () => {
    const revalidator = createRevalidator();
    const callback = vi.fn().mockRejectedValue(new Error("fetch failed"));

    revalidator.trigger("key", callback);
    await revalidator.waitForRevalidation("key");

    expect(callback).toHaveBeenCalledOnce();
  });

  it("tracks independent keys separately", async () => {
    const revalidator = createRevalidator();
    const callbackA = vi.fn().mockResolvedValue(undefined);
    const callbackB = vi.fn().mockResolvedValue(undefined);

    revalidator.trigger("a", callbackA);
    revalidator.trigger("b", callbackB);
    await revalidator.waitForRevalidation();

    expect(callbackA).toHaveBeenCalledOnce();
    expect(callbackB).toHaveBeenCalledOnce();
  });

  it("waitForRevalidation resolves immediately when no inflight requests", async () => {
    const revalidator = createRevalidator();

    await revalidator.waitForRevalidation();
    await revalidator.waitForRevalidation("nonexistent");
  });
});

// ---------------------------------------------------------------------------
// resolveData
// ---------------------------------------------------------------------------
describe("resolveData", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns memory-cached data if available", async () => {
    const memoryCache = createMockMemoryCache<string[]>();
    const cached: CachedData<string[]> = {
      data: ["mem-a"],
      timestamp: Date.now(),
    };
    memoryCache.set("test", cached);

    const result = await resolveData(bundledData, defaultConfig, {
      memoryCache,
      fs: createMemFs(),
    });

    expect(result).toEqual(cached);
  });

  it("falls back to filesystem cache, populating memory cache on hit", async () => {
    const memoryCache = createMockMemoryCache<string[]>();
    const cached: CachedData<string[]> = {
      data: ["disk-a"],
      timestamp: Date.now(),
    };
    const fs = createMemFs({
      "/cache/test.json": JSON.stringify(cached),
    });

    const result = await resolveData(bundledData, defaultConfig, {
      memoryCache,
      fs,
    });

    expect(result).toEqual(cached);
    expect(memoryCache.get("test")).toEqual(cached);
  });

  it("falls back to network fetch when no cache is available", async () => {
    const memoryCache = createMockMemoryCache<string[]>();
    const networkData = ["net-a", "net-b"];
    const mockFetch = createMockFetch(networkData);
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    const result = await resolveData(bundledData, defaultConfig, {
      memoryCache,
      fs: createMemFs(),
      fetch: mockFetch,
    });

    expect(result.data).toEqual(networkData);
    expect(result.timestamp).toBe(now);
    expect(memoryCache.get("test")?.data).toEqual(networkData);
  });

  it("falls back to bundled data when network fails", async () => {
    const memoryCache = createMockMemoryCache<string[]>();
    const mockFetch = createFailingFetch();

    const result = await resolveData(bundledData, defaultConfig, {
      memoryCache,
      fs: createMemFs(),
      fetch: mockFetch,
    });

    expect(result.data).toEqual(bundledData);
    expect(result.timestamp).toBe(0);
  });

  it("forceRefresh skips all caches and fetches from network", async () => {
    const memoryCache = createMockMemoryCache<string[]>();
    const cached: CachedData<string[]> = {
      data: ["mem-a"],
      timestamp: Date.now(),
    };
    memoryCache.set("test", cached);
    const diskFs = createMemFs({
      "/cache/test.json": JSON.stringify(cached),
    });
    const networkData = ["fresh-a"];
    const mockFetch = createMockFetch(networkData);

    const result = await resolveData(
      bundledData,
      defaultConfig,
      { memoryCache, fs: diskFs, fetch: mockFetch },
      { forceRefresh: true },
    );

    expect(result.data).toEqual(networkData);
    expect(mockFetch).toHaveBeenCalled();
  });

  it("offline option never hits network, returns cached data", async () => {
    const memoryCache = createMockMemoryCache<string[]>();
    const cached: CachedData<string[]> = {
      data: ["mem-a"],
      timestamp: Date.now(),
    };
    memoryCache.set("test", cached);
    const mockFetch = createMockFetch(["should-not-reach"]);

    const result = await resolveData(
      bundledData,
      defaultConfig,
      { memoryCache, fs: createMemFs(), fetch: mockFetch },
      { offline: true },
    );

    expect(result).toEqual(cached);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("offline option returns bundled data when no cache exists", async () => {
    const memoryCache = createMockMemoryCache<string[]>();
    const mockFetch = createMockFetch(["should-not-reach"]);

    const result = await resolveData(
      bundledData,
      defaultConfig,
      { memoryCache, fs: createMemFs(), fetch: mockFetch },
      { offline: true },
    );

    expect(result.data).toEqual(bundledData);
    expect(result.timestamp).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("preferOffline option returns bundled data instead of fetching when no cache exists", async () => {
    const memoryCache = createMockMemoryCache<string[]>();
    const mockFetch = createMockFetch(["should-not-reach"]);

    const result = await resolveData(
      bundledData,
      defaultConfig,
      { memoryCache, fs: createMemFs(), fetch: mockFetch },
      { preferOffline: true },
    );

    expect(result.data).toEqual(bundledData);
    expect(result.timestamp).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("preferOffline returns memory-cached data if available", async () => {
    const memoryCache = createMockMemoryCache<string[]>();
    const cached: CachedData<string[]> = {
      data: ["mem-a"],
      timestamp: Date.now(),
    };
    memoryCache.set("test", cached);

    const result = await resolveData(
      bundledData,
      defaultConfig,
      { memoryCache, fs: createMemFs() },
      { preferOffline: true },
    );

    expect(result).toEqual(cached);
  });

  it("preferOffline returns disk-cached data if available", async () => {
    const memoryCache = createMockMemoryCache<string[]>();
    const cached: CachedData<string[]> = {
      data: ["disk-a"],
      timestamp: Date.now(),
    };
    const fs = createMemFs({
      "/cache/test.json": JSON.stringify(cached),
    });

    const result = await resolveData(
      bundledData,
      defaultConfig,
      { memoryCache, fs },
      { preferOffline: true },
    );

    expect(result).toEqual(cached);
  });

  it("network fetch persists data to disk", async () => {
    const memoryCache = createMockMemoryCache<string[]>();
    const networkData = ["net-a"];
    const mockFetch = createMockFetch(networkData);
    const fs = createMemFs();
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    await resolveData(bundledData, defaultConfig, {
      memoryCache,
      fs,
      fetch: mockFetch,
    });

    const content = await fs.readFile("/cache/test.json", "utf8");
    expect(JSON.parse(content)).toEqual({
      data: networkData,
      timestamp: now,
    });
  });

  it("forceRefresh falls back to bundled data when network fails", async () => {
    const memoryCache = createMockMemoryCache<string[]>();
    const mockFetch = createFailingFetch();

    const result = await resolveData(
      bundledData,
      defaultConfig,
      { memoryCache, fs: createMemFs(), fetch: mockFetch },
      { forceRefresh: true },
    );

    expect(result.data).toEqual(bundledData);
    expect(result.timestamp).toBe(0);
  });

  describe("stale-while-revalidate", () => {
    it("stale disk data triggers background revalidation", async () => {
      const memoryCache = createMockMemoryCache<string[]>();
      const revalidator = createRevalidator();
      const staleTimestamp = Date.now() - defaultConfig.freshTtl - 1;
      const staleCached: CachedData<string[]> = {
        data: ["stale-a"],
        timestamp: staleTimestamp,
      };
      const fs = createMemFs({
        "/cache/test.json": JSON.stringify(staleCached),
      });
      const networkData = ["fresh-a"];
      const mockFetch = createMockFetch(networkData);

      const result = await resolveData(bundledData, defaultConfig, {
        memoryCache,
        fs,
        fetch: mockFetch,
        revalidator,
      });

      expect(result.data).toEqual(["stale-a"]);

      await revalidator.waitForRevalidation();

      expect(mockFetch).toHaveBeenCalled();
      expect(memoryCache.get("test")?.data).toEqual(networkData);
      const diskContent = await fs.readFile("/cache/test.json", "utf8");
      expect(JSON.parse(diskContent).data).toEqual(networkData);
    });

    it("fresh disk data does not trigger background revalidation", async () => {
      const memoryCache = createMockMemoryCache<string[]>();
      const revalidator = createRevalidator();
      const freshCached: CachedData<string[]> = {
        data: ["fresh-a"],
        timestamp: Date.now(),
      };
      const fs = createMemFs({
        "/cache/test.json": JSON.stringify(freshCached),
      });
      const mockFetch = createMockFetch(["should-not-reach"]);

      await resolveData(bundledData, defaultConfig, {
        memoryCache,
        fs,
        fetch: mockFetch,
        revalidator,
      });

      await revalidator.waitForRevalidation();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("concurrent revalidation requests are deduplicated", async () => {
      const memoryCache = createMockMemoryCache<string[]>();
      const revalidator = createRevalidator();
      const staleTimestamp = Date.now() - defaultConfig.freshTtl - 1;
      const staleCached: CachedData<string[]> = {
        data: ["stale-a"],
        timestamp: staleTimestamp,
      };
      const fs = createMemFs({
        "/cache/test.json": JSON.stringify(staleCached),
      });
      const mockFetch = createMockFetch(["fresh-a"]);

      await resolveData(bundledData, defaultConfig, {
        memoryCache,
        fs,
        fetch: mockFetch,
        revalidator,
      });

      memoryCache.clear();
      await resolveData(bundledData, defaultConfig, {
        memoryCache,
        fs,
        fetch: mockFetch,
        revalidator,
      });

      await revalidator.waitForRevalidation();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("background fetch failures are silent", async () => {
      const memoryCache = createMockMemoryCache<string[]>();
      const revalidator = createRevalidator();
      const staleTimestamp = Date.now() - defaultConfig.freshTtl - 1;
      const staleCached: CachedData<string[]> = {
        data: ["stale-a"],
        timestamp: staleTimestamp,
      };
      const fs = createMemFs({
        "/cache/test.json": JSON.stringify(staleCached),
      });
      const mockFetch = createFailingFetch();

      const result = await resolveData(bundledData, defaultConfig, {
        memoryCache,
        fs,
        fetch: mockFetch,
        revalidator,
      });

      await revalidator.waitForRevalidation();

      expect(result.data).toEqual(["stale-a"]);
    });

    it("does not trigger revalidation in offline mode", async () => {
      const memoryCache = createMockMemoryCache<string[]>();
      const revalidator = createRevalidator();
      const staleTimestamp = Date.now() - defaultConfig.freshTtl - 1;
      const staleCached: CachedData<string[]> = {
        data: ["stale-a"],
        timestamp: staleTimestamp,
      };
      const fs = createMemFs({
        "/cache/test.json": JSON.stringify(staleCached),
      });
      const mockFetch = createMockFetch(["should-not-reach"]);

      await resolveData(
        bundledData,
        defaultConfig,
        { memoryCache, fs, fetch: mockFetch, revalidator },
        { offline: true },
      );

      await revalidator.waitForRevalidation();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does not trigger revalidation in preferOffline mode", async () => {
      const memoryCache = createMockMemoryCache<string[]>();
      const revalidator = createRevalidator();
      const staleTimestamp = Date.now() - defaultConfig.freshTtl - 1;
      const staleCached: CachedData<string[]> = {
        data: ["stale-a"],
        timestamp: staleTimestamp,
      };
      const fs = createMemFs({
        "/cache/test.json": JSON.stringify(staleCached),
      });
      const mockFetch = createMockFetch(["should-not-reach"]);

      await resolveData(
        bundledData,
        defaultConfig,
        { memoryCache, fs, fetch: mockFetch, revalidator },
        { preferOffline: true },
      );

      await revalidator.waitForRevalidation();

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// createCachedResource
// ---------------------------------------------------------------------------
describe("createCachedResource", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an object with get, refresh, clear, and stats", () => {
    const resource = createCachedResource(bundledData, defaultConfig, {
      fs: createMemFs(),
    });

    expect(typeof resource.get).toBe("function");
    expect(typeof resource.refresh).toBe("function");
    expect(typeof resource.clear).toBe("function");
    expect(typeof resource.stats).toBe("function");
  });

  it("get resolves data through the cache orchestrator", async () => {
    const networkData = ["net-a"];
    const mockFetch = createMockFetch(networkData);
    const resource = createCachedResource(bundledData, defaultConfig, {
      fs: createMemFs(),
      fetch: mockFetch,
    });

    const result = await resource.get();

    expect(result.data).toEqual(networkData);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("get passes fetch options to the orchestrator", async () => {
    const resource = createCachedResource(bundledData, defaultConfig, {
      fs: createMemFs(),
    });

    const result = await resource.get({ offline: true });

    expect(result.data).toEqual(bundledData);
    expect(result.timestamp).toBe(0);
  });

  it("refresh bypasses caches and fetches from network", async () => {
    const mockFetch = createMockFetch(["net-a"]);
    const resource = createCachedResource(bundledData, defaultConfig, {
      fs: createMemFs(),
      fetch: mockFetch,
    });

    await resource.get();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await resource.refresh();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("each call creates an independent cache instance", async () => {
    const mockFetch1 = createMockFetch(["net-1"]);
    const mockFetch2 = createMockFetch(["net-2"]);

    const resource1 = createCachedResource(bundledData, defaultConfig, {
      fs: createMemFs(),
      fetch: mockFetch1,
    });
    const resource2 = createCachedResource(bundledData, defaultConfig, {
      fs: createMemFs(),
      fetch: mockFetch2,
    });

    const result1 = await resource1.get();
    const result2 = await resource2.get();

    expect(result1.data).toEqual(["net-1"]);
    expect(result2.data).toEqual(["net-2"]);
  });

  it("clear resets the memory cache", async () => {
    const mockFetch = createMockFetch(["net-a"]);
    const resource = createCachedResource(bundledData, defaultConfig, {
      fs: createMemFs(),
      fetch: mockFetch,
    });

    await resource.get();
    expect(resource.stats().memoryCacheSize).toBe(1);

    await resource.clear();
    expect(resource.stats().memoryCacheSize).toBe(0);
  });

  it("clear removes the filesystem cache file", async () => {
    const memFs = createMemFs();
    const mockFetch = createMockFetch(["net-a"]);
    const resource = createCachedResource(bundledData, defaultConfig, {
      fs: memFs,
      fetch: mockFetch,
    });

    await resource.get();

    await expect(
      memFs.readFile("/cache/test.json", "utf8"),
    ).resolves.toBeDefined();

    await resource.clear();

    await expect(
      memFs.readFile("/cache/test.json", "utf8"),
    ).rejects.toThrow();
  });

  it("clear silently ignores filesystem delete errors", async () => {
    const memFs = createMemFs();
    memFs.unlink = () => Promise.reject(new Error("permission denied"));
    const mockFetch = createMockFetch(["net-a"]);
    const resource = createCachedResource(bundledData, defaultConfig, {
      fs: memFs,
      fetch: mockFetch,
    });

    await resource.get();

    await expect(resource.clear()).resolves.not.toThrow();
    expect(resource.stats().memoryCacheSize).toBe(0);
  });

  it("stats returns memory cache size, max, and cache directory", async () => {
    const mockFetch = createMockFetch(["net-a"]);
    const resource = createCachedResource(bundledData, defaultConfig, {
      fs: createMemFs(),
      fetch: mockFetch,
    });

    const initialStats = resource.stats();
    expect(initialStats.memoryCacheSize).toBe(0);
    expect(initialStats.memoryCacheMax).toBe(100);
    expect(initialStats.cacheDir).toBe("/cache");

    await resource.get();

    expect(resource.stats().memoryCacheSize).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// loadFromDisk / persist / removeFromDisk / resolveCacheDir
// ---------------------------------------------------------------------------
describe("loadFromDisk", () => {
  it("returns cached data when file exists and is not expired", async () => {
    const cached: CachedData<string[]> = {
      data: ["a", "b"],
      timestamp: Date.now(),
    };
    const fs = createMemFs({
      "/cache/test.json": JSON.stringify(cached),
    });

    const result = await loadFromDisk<string[]>(
      { cacheDir: "/cache", cacheName: "test", staleTtl: 60_000 },
      { fs },
    );

    expect(result).toEqual(cached);
  });

  it("returns null when file is missing", async () => {
    const fs = createMemFs();

    const result = await loadFromDisk<string[]>(
      { cacheDir: "/cache", cacheName: "test", staleTtl: 60_000 },
      { fs },
    );

    expect(result).toBeNull();
  });

  it("returns null when data is expired beyond staleTtl", async () => {
    const cached: CachedData<string[]> = {
      data: ["a"],
      timestamp: Date.now() - 120_000,
    };
    const fs = createMemFs({
      "/cache/test.json": JSON.stringify(cached),
    });

    const result = await loadFromDisk<string[]>(
      { cacheDir: "/cache", cacheName: "test", staleTtl: 60_000 },
      { fs },
    );

    expect(result).toBeNull();
  });

  it("returns null when file contains invalid JSON", async () => {
    const fs = createMemFs({
      "/cache/test.json": "not json",
    });

    const result = await loadFromDisk<string[]>(
      { cacheDir: "/cache", cacheName: "test", staleTtl: 60_000 },
      { fs },
    );

    expect(result).toBeNull();
  });

  it("returns null on read errors", async () => {
    const fs = createMemFs();
    fs.readFile = () => Promise.reject(new Error("permission denied"));

    const result = await loadFromDisk<string[]>(
      { cacheDir: "/cache", cacheName: "test", staleTtl: 60_000 },
      { fs },
    );

    expect(result).toBeNull();
  });
});

describe("persist", () => {
  it("writes CachedData with timestamp to the cache directory", async () => {
    const fs = createMemFs();
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    await persist(["a", "b"], { cacheDir: "/cache", cacheName: "test" }, { fs });

    const content = await fs.readFile("/cache/test.json", "utf8");
    expect(JSON.parse(content)).toEqual({
      data: ["a", "b"],
      timestamp: now,
    });

    vi.restoreAllMocks();
  });

  it("creates cache directory with mkdir -p", async () => {
    const fs = createMemFs();
    const mkdirSpy = vi.fn(fs.mkdir.bind(fs));
    fs.mkdir = mkdirSpy;

    await persist("data", { cacheDir: "/deep/nested/cache", cacheName: "test" }, { fs });

    expect(mkdirSpy).toHaveBeenCalledWith("/deep/nested/cache", {
      recursive: true,
    });
  });

  it("silently fails on write errors", async () => {
    const fs = createMemFs();
    fs.writeFile = () => Promise.reject(new Error("disk full"));

    await expect(
      persist("data", { cacheDir: "/cache", cacheName: "test" }, { fs }),
    ).resolves.not.toThrow();
  });
});

describe("removeFromDisk", () => {
  it("deletes the cache file", async () => {
    const cached = JSON.stringify({ data: ["a"], timestamp: Date.now() });
    const fs = createMemFs({ "/cache/test.json": cached });

    await removeFromDisk({ cacheDir: "/cache", cacheName: "test" }, { fs });

    await expect(fs.readFile("/cache/test.json", "utf8")).rejects.toThrow();
  });

  it("silently ignores errors when file does not exist", async () => {
    const fs = createMemFs();

    await expect(
      removeFromDisk({ cacheDir: "/cache", cacheName: "test" }, { fs }),
    ).resolves.not.toThrow();
  });

  it("silently ignores unlink errors", async () => {
    const fs = createMemFs();
    fs.unlink = () => Promise.reject(new Error("permission denied"));

    await expect(
      removeFromDisk({ cacheDir: "/cache", cacheName: "test" }, { fs }),
    ).resolves.not.toThrow();
  });
});

describe("resolveCacheDir", () => {
  it("uses XDG_CACHE_HOME when set", () => {
    const result = resolveCacheDir("myapp", {
      env: { XDG_CACHE_HOME: "/custom/cache" },
      homedir: () => "/home/user",
    });

    expect(result).toBe("/custom/cache/myapp");
  });

  it("falls back to ~/.cache/<app-name> when XDG_CACHE_HOME is not set", () => {
    const result = resolveCacheDir("myapp", {
      env: {},
      homedir: () => "/home/user",
    });

    expect(result).toBe("/home/user/.cache/myapp");
  });
});

// ---------------------------------------------------------------------------
// createMemoryCache
// ---------------------------------------------------------------------------
describe("createMemoryCache", () => {
  it("returns undefined for missing keys", () => {
    const cache = createMemoryCache<string[]>({ max: 10, ttl: 60_000 });

    expect(cache.get("missing")).toBeUndefined();
  });

  it("stores and retrieves values", () => {
    const cache = createMemoryCache<string[]>({ max: 10, ttl: 60_000 });
    const entry: CachedData<string[]> = {
      data: ["a", "b"],
      timestamp: Date.now(),
    };

    cache.set("key", entry);

    expect(cache.get("key")).toEqual(entry);
  });

  it("respects max entries by evicting least recently used", () => {
    const cache = createMemoryCache<string>({ max: 2, ttl: 60_000 });

    cache.set("a", { data: "1", timestamp: Date.now() });
    cache.set("b", { data: "2", timestamp: Date.now() });
    cache.set("c", { data: "3", timestamp: Date.now() });

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeDefined();
    expect(cache.get("c")).toBeDefined();
  });

  it("returns stale entries when allowStale is enabled", () => {
    const cache = createMemoryCache<string>({ max: 10, ttl: 1 });
    cache.set("key", { data: "value", timestamp: Date.now() });

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const result = cache.get("key");
        expect(result).toBeDefined();
        expect(result?.data).toBe("value");
        resolve();
      }, 50);
    });
  });

  it("exposes cache size via size property", () => {
    const cache = createMemoryCache<string>({ max: 10, ttl: 60_000 });

    expect(cache.size).toBe(0);

    cache.set("a", { data: "1", timestamp: Date.now() });
    expect(cache.size).toBe(1);

    cache.set("b", { data: "2", timestamp: Date.now() });
    expect(cache.size).toBe(2);
  });

  it("exposes max capacity via max property", () => {
    const cache = createMemoryCache<string>({ max: 42, ttl: 60_000 });

    expect(cache.max).toBe(42);
  });

  it("clears all entries", () => {
    const cache = createMemoryCache<string>({ max: 10, ttl: 60_000 });

    cache.set("a", { data: "1", timestamp: Date.now() });
    cache.set("b", { data: "2", timestamp: Date.now() });
    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CachedData / FetchOptions / CacheConfig types
// ---------------------------------------------------------------------------
describe("CachedData", () => {
  it("holds generic data with a timestamp", () => {
    const cached: CachedData<string[]> = {
      data: ["a", "b"],
      timestamp: Date.now(),
    };
    expect(cached.data).toEqual(["a", "b"]);
    expect(typeof cached.timestamp).toBe("number");
  });
});

describe("FetchOptions", () => {
  it("has all optional boolean flags", () => {
    const empty: FetchOptions = {};
    expect(empty.forceRefresh).toBeUndefined();

    const full: FetchOptions = {
      forceRefresh: true,
      preferOffline: false,
      offline: true,
    };
    expect(full.forceRefresh).toBe(true);
    expect(full.preferOffline).toBe(false);
    expect(full.offline).toBe(true);
  });
});

describe("CacheConfig", () => {
  it("holds all required configuration fields", () => {
    const config: CacheConfig = {
      freshTtl: 60_000,
      staleTtl: 300_000,
      fetchTimeout: 5_000,
      apiEndpoint: "https://api.example.com/data",
      cacheDir: "/home/user/.cache/myapp",
      cacheName: "resources",
    };
    expect(config.freshTtl).toBe(60_000);
    expect(config.staleTtl).toBe(300_000);
    expect(config.fetchTimeout).toBe(5_000);
    expect(config.apiEndpoint).toBe("https://api.example.com/data");
    expect(config.cacheDir).toBe("/home/user/.cache/myapp");
    expect(config.cacheName).toBe("resources");
  });
});

// ---------------------------------------------------------------------------
// testing utilities (createMemFs, createMockCachedResource)
// ---------------------------------------------------------------------------
describe("createMemFs", () => {
  it("creates a DiskCacheFs from empty volume", async () => {
    const fs = testingCreateMemFs();

    await fs.mkdir("/cache", { recursive: true });
    await fs.writeFile("/cache/test.json", '{"data":"hello"}');
    const content = await fs.readFile("/cache/test.json", "utf8");

    expect(content).toBe('{"data":"hello"}');
  });

  it("creates a DiskCacheFs pre-populated with files", async () => {
    const fs = testingCreateMemFs({
      "/cache/test.json": '{"data":"preloaded"}',
    });

    const content = await fs.readFile("/cache/test.json", "utf8");

    expect(content).toBe('{"data":"preloaded"}');
  });

  it("unlink removes files", async () => {
    const fs = testingCreateMemFs({
      "/cache/test.json": "content",
    });

    await fs.unlink("/cache/test.json");

    await expect(fs.readFile("/cache/test.json", "utf8")).rejects.toThrow();
  });
});

describe("createMockCachedResource", () => {
  it("get returns bundled data by default", async () => {
    const resource = createMockCachedResource(["a", "b"]);

    const result = await resource.get();

    expect(result.data).toEqual(["a", "b"]);
    expect(result.timestamp).toBe(0);
  });

  it("refresh returns bundled data by default", async () => {
    const resource = createMockCachedResource({ key: "value" });

    const result = await resource.refresh();

    expect(result.data).toEqual({ key: "value" });
  });

  it("clear resolves without error", async () => {
    const resource = createMockCachedResource("data");

    await expect(resource.clear()).resolves.not.toThrow();
  });

  it("stats returns zeroed stats", () => {
    const resource = createMockCachedResource("data");

    const stats = resource.stats();

    expect(stats).toEqual({
      memoryCacheSize: 0,
      memoryCacheMax: 0,
      cacheDir: "",
    });
  });

  it("get is a spy that can be overridden", async () => {
    const resource = createMockCachedResource("default");

    resource.get.mockResolvedValueOnce({ data: "custom", timestamp: 999 });

    const result = await resource.get();

    expect(result.data).toBe("custom");
    expect(result.timestamp).toBe(999);
  });

  it("refresh is a spy that can be overridden", async () => {
    const resource = createMockCachedResource("default");

    resource.refresh.mockResolvedValueOnce({ data: "refreshed", timestamp: 1 });

    const result = await resource.refresh();

    expect(result.data).toBe("refreshed");
  });

  it("clear is a spy that can be overridden", async () => {
    const resource = createMockCachedResource("data");

    resource.clear.mockRejectedValueOnce(new Error("fail"));

    await expect(resource.clear()).rejects.toThrow("fail");
  });

  it("stats is a spy that can be overridden", () => {
    const resource = createMockCachedResource("data");

    resource.stats.mockReturnValueOnce({
      memoryCacheSize: 5,
      memoryCacheMax: 100,
      cacheDir: "/custom",
    });

    expect(resource.stats().memoryCacheSize).toBe(5);
  });
});
