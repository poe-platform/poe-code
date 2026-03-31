import { describe, it, expect } from "bun:test";
import { createMemoryCache } from "./memory-cache.js";
import type { CachedData } from "./types.js";

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
