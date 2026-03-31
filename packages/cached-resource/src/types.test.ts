import { describe, it, expect } from "bun:test";
import type { CachedData, FetchOptions, CacheConfig } from "./types.js";

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
