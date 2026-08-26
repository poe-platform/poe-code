import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCachedResource } from "./create-cached-resource.js";
import type { CachedResource } from "./create-cached-resource.js";
import type { DiskCacheFs } from "./disk-cache.js";
import { createMemFs } from "./testing/index.js";
import type { CacheConfig } from "./types.js";

const config: CacheConfig = {
  freshTtl: 60_000,
  staleTtl: 300_000,
  fetchTimeout: 5_000,
  apiEndpoint: "https://api.example.com/data",
  cacheDir: "/cache",
  cacheName: "test"
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function gatedFetch() {
  const started = deferred<void>();
  const response = deferred<Response>();
  const fetch = vi.fn(() => {
    started.resolve();
    return response.promise;
  });
  return { fetch, started, response };
}

function gateDiskRead(fs: DiskCacheFs) {
  const started = deferred<void>();
  const release = deferred<void>();
  const readFile = fs.readFile;
  vi.spyOn(fs, "readFile").mockImplementationOnce(async (path, encoding) => {
    const content = await readFile(path, encoding);
    started.resolve();
    await release.promise;
    return content;
  });
  return { started, release };
}

async function expectEmpty(resource: CachedResource<string[]>, fs: DiskCacheFs) {
  expect.soft(resource.stats().memoryCacheSize).toBe(0);
  await expect.soft(fs.readFile("/cache/test.json", "utf8")).rejects.toMatchObject({
    code: "ENOENT"
  });
  await expect.soft(resource.get({ offline: true })).resolves.toEqual({
    data: ["bundled"],
    timestamp: 0
  });
}

describe("clear concurrency", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(["get", "refresh"] as const)(
    "drains a foreground %s registered immediately before clear",
    async (operation) => {
      const fs = createMemFs();
      const pending = gatedFetch();
      const resource = createCachedResource(["bundled"], config, {
        fs,
        fetch: pending.fetch
      });
      const getting = resource[operation]();
      const cleared = vi.fn();
      const clearing = resource.clear().then(cleared);
      await pending.started.promise;
      await vi.advanceTimersByTimeAsync(0);
      const clearedBeforeFetch = cleared.mock.calls.length;

      pending.response.resolve(Response.json(["fresh"]));
      await expect(getting).resolves.toMatchObject({ data: ["fresh"] });
      await clearing;

      expect.soft(clearedBeforeFetch).toBe(0);
      await expectEmpty(resource, fs);
    }
  );

  it("drains a delayed fresh offline disk read before clearing memory", async () => {
    const cached = { data: ["disk"], timestamp: Date.now() };
    const fs = createMemFs({ "/cache/test.json": JSON.stringify(cached) });
    const diskRead = gateDiskRead(fs);
    const fetch = vi.fn();
    const resource = createCachedResource(["bundled"], config, { fs, fetch });
    const getting = resource.get({ offline: true });
    await diskRead.started.promise;
    const cleared = vi.fn();
    const clearing = resource.clear().then(cleared);
    await vi.advanceTimersByTimeAsync(0);
    const clearedBeforeRead = cleared.mock.calls.length;

    diskRead.release.resolve();
    await expect(getting).resolves.toEqual(cached);
    await clearing;

    expect.soft(clearedBeforeRead).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    await expectEmpty(resource, fs);
  });

  it("drains revalidation spawned by a delayed stale disk read without delaying stale returns or duplicating fetches", async () => {
    const cached = {
      data: ["stale"],
      timestamp: Date.now() - config.freshTtl - 1
    };
    const fs = createMemFs({ "/cache/test.json": JSON.stringify(cached) });
    const diskRead = gateDiskRead(fs);
    const pending = gatedFetch();
    const resource = createCachedResource(["bundled"], config, {
      fs,
      fetch: pending.fetch
    });
    const getting = resource.get();
    await diskRead.started.promise;
    const cleared = vi.fn();
    const clearing = resource.clear().then(cleared);
    await vi.advanceTimersByTimeAsync(0);
    const clearedBeforeRead = cleared.mock.calls.length;

    diskRead.release.resolve();
    await expect(getting).resolves.toEqual(cached);
    await pending.started.promise;
    await expect(resource.get()).resolves.toEqual(cached);
    await vi.advanceTimersByTimeAsync(0);
    const clearedBeforeRevalidation = cleared.mock.calls.length;

    pending.response.resolve(Response.json(["fresh"]));
    await clearing;
    await vi.advanceTimersByTimeAsync(0);

    expect.soft(clearedBeforeRead).toBe(0);
    expect.soft(clearedBeforeRevalidation).toBe(0);
    expect(pending.fetch).toHaveBeenCalledTimes(1);
    await expectEmpty(resource, fs);
  });

  it("drains foreground persistence through its final rename", async () => {
    const fs = createMemFs();
    const renameStarted = deferred<void>();
    const releaseRename = deferred<void>();
    const rename = fs.rename;
    vi.spyOn(fs, "rename").mockImplementationOnce(async (from, to) => {
      renameStarted.resolve();
      await releaseRename.promise;
      await rename(from, to);
    });
    const resource = createCachedResource(["bundled"], config, {
      fs,
      fetch: vi.fn().mockResolvedValue(Response.json(["fresh"]))
    });
    const getting = resource.refresh();
    await renameStarted.promise;
    const cleared = vi.fn();
    const clearing = resource.clear().then(cleared);
    await vi.advanceTimersByTimeAsync(0);
    const clearedBeforeRename = cleared.mock.calls.length;

    releaseRename.resolve();
    await getting;
    await clearing;

    expect.soft(clearedBeforeRename).toBe(0);
    await expectEmpty(resource, fs);
  });

  it("makes concurrent clears drain the same foreground operation", async () => {
    const fs = createMemFs();
    const pending = gatedFetch();
    const resource = createCachedResource(["bundled"], config, {
      fs,
      fetch: pending.fetch
    });
    const getting = resource.get();
    const cleared = vi.fn();
    const firstClear = resource.clear().then(cleared);
    const secondClear = resource.clear().then(cleared);
    await pending.started.promise;
    await vi.advanceTimersByTimeAsync(0);
    const clearedBeforeFetch = cleared.mock.calls.length;

    pending.response.resolve(Response.json(["fresh"]));
    await Promise.all([getting, firstClear, secondClear]);

    expect.soft(clearedBeforeFetch).toBe(0);
    expect(cleared).toHaveBeenCalledTimes(2);
    await expectEmpty(resource, fs);
  });

  it("drains a rejected disk get without rejecting clear", async () => {
    const fs = createMemFs({ "/cache/test.json": "null" });
    const diskRead = gateDiskRead(fs);
    const fetch = vi.fn();
    const resource = createCachedResource(
      ["bundled"],
      { ...config, apiEndpoint: "invalid" },
      { fs, fetch }
    );
    const getting = expect(resource.get()).rejects.toThrow("apiEndpoint must be a valid URL");
    await diskRead.started.promise;
    const cleared = vi.fn();
    const clearing = resource.clear().then(cleared);
    await vi.advanceTimersByTimeAsync(0);
    const clearedBeforeRejection = cleared.mock.calls.length;

    diskRead.release.resolve();
    await Promise.all([getting, clearing]);

    expect.soft(clearedBeforeRejection).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    await expectEmpty(resource, fs);
    await expect(resource.clear()).resolves.toBeUndefined();
  });

  it("handles immediately rejected gets without unhandled tracking rejections", async () => {
    const resource = createCachedResource(
      ["bundled"],
      { ...config, freshTtl: -1 },
      { fs: createMemFs(), fetch: vi.fn() }
    );
    const getting = expect(resource.get()).rejects.toThrow(
      "freshTtl must be a finite non-negative number"
    );
    await Promise.all([getting, resource.clear()]);
    await vi.advanceTimersByTimeAsync(0);
    await expect(resource.clear()).resolves.toBeUndefined();
  });

  it("preserves disk deletion errors after draining foreground work", async () => {
    const fs = createMemFs({
      "/cache/test.json": JSON.stringify({ data: ["old"], timestamp: Date.now() })
    });
    const deletionError = new Error("permission denied");
    vi.spyOn(fs, "unlink").mockRejectedValue(deletionError);
    const pending = gatedFetch();
    const resource = createCachedResource(["bundled"], config, {
      fs,
      fetch: pending.fetch
    });
    const getting = resource.refresh();
    const clearing = resource.clear().then(
      () => undefined,
      (error: unknown) => error
    );
    await pending.started.promise;
    await vi.advanceTimersByTimeAsync(0);

    pending.response.resolve(Response.json(["fresh"]));
    const [, clearError] = await Promise.all([getting, clearing]);

    expect(clearError).toBe(deletionError);
    expect(resource.stats().memoryCacheSize).toBe(0);
    await expect(fs.readFile("/cache/test.json", "utf8")).resolves.toBeDefined();
  });

  it("allows later operations to run without extending the clear snapshot", async () => {
    const fs = createMemFs();
    const first = gatedFetch();
    const later = gatedFetch();
    const fetch = vi
      .fn()
      .mockImplementationOnce(first.fetch)
      .mockImplementationOnce(later.fetch)
      .mockResolvedValue(Response.json(["after-clear"]));
    const resource = createCachedResource(["bundled"], config, { fs, fetch });
    const firstGet = resource.refresh();
    const cleared = vi.fn();
    const clearing = resource.clear().then(cleared);
    const laterGet = resource.refresh();
    await first.started.promise;
    await later.started.promise;

    first.response.resolve(Response.json(["first"]));
    await firstGet;
    await vi.advanceTimersByTimeAsync(0);
    const clearedBeforeLaterFetch = cleared.mock.calls.length;
    const memoryBeforeLaterFetch = resource.stats().memoryCacheSize;

    later.response.resolve(Response.json(["later"]));
    await Promise.all([laterGet, clearing]);

    expect(clearedBeforeLaterFetch).toBe(1);
    expect(memoryBeforeLaterFetch).toBe(0);
    await expect(resource.get({ offline: true })).resolves.toMatchObject({
      data: ["later"]
    });
    await expect(resource.refresh()).resolves.toMatchObject({
      data: ["after-clear"]
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    await resource.clear();
    await expectEmpty(resource, fs);
  });

  it("does not drain another instance sharing the same cache path", async () => {
    const fs = createMemFs();
    const pending = gatedFetch();
    const resource = createCachedResource(["bundled"], config, {
      fs,
      fetch: vi.fn()
    });
    const other = createCachedResource(["bundled"], config, {
      fs,
      fetch: pending.fetch
    });
    const getting = other.refresh();
    const cleared = vi.fn();
    const clearing = resource.clear().then(cleared);
    await pending.started.promise;
    await vi.advanceTimersByTimeAsync(0);
    const clearedBeforeOtherFetch = cleared.mock.calls.length;

    pending.response.resolve(Response.json(["other"]));
    await Promise.all([getting, clearing]);

    expect(clearedBeforeOtherFetch).toBe(1);
    expect(resource.stats().memoryCacheSize).toBe(0);
    expect(other.stats().memoryCacheSize).toBe(1);
    expect(JSON.parse(await fs.readFile("/cache/test.json", "utf8"))).toMatchObject({
      data: ["other"]
    });
  });
});
