import { describe, it, expect, vi } from "bun:test";
import { Volume, createFsFromVolume } from "memfs";
import { loadFromDisk, persist, removeFromDisk, resolveCacheDir } from "./disk-cache.js";
import type { CachedData } from "./types.js";

interface MemFs {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  unlink(path: string): Promise<void>;
}

function createMemFs(files: Record<string, string> = {}): MemFs {
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
    ).resolves.toBeUndefined();
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
    ).resolves.toBeUndefined();
  });

  it("silently ignores unlink errors", async () => {
    const fs = createMemFs();
    fs.unlink = () => Promise.reject(new Error("permission denied"));

    await expect(
      removeFromDisk({ cacheDir: "/cache", cacheName: "test" }, { fs }),
    ).resolves.toBeUndefined();
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
