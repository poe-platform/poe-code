import { describe, it, expect, vi, beforeEach } from "bun:test";
import { Volume, createFsFromVolume } from "memfs";
import { createCachedResource } from "./create-cached-resource.js";
import type { CacheConfig } from "./types.js";
import type { DiskCacheFs } from "./disk-cache.js";

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

const defaultConfig: CacheConfig = {
  freshTtl: 60_000,
  staleTtl: 300_000,
  fetchTimeout: 5_000,
  apiEndpoint: "https://api.example.com/data",
  cacheDir: "/cache",
  cacheName: "test",
};

const bundledData = ["bundled-a", "bundled-b"];

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

    await expect(resource.clear()).resolves.toBeUndefined();
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
