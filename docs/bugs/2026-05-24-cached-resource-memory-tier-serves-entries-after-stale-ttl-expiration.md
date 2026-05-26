# Cached resource memory tier serves entries after stale TTL expiration

## Summary

`@poe-code/cached-resource` defines `staleTtl` as the age after which cached data is expired and discarded, but the in-memory cache is configured to return entries after that TTL and `resolveData()` accepts memory hits without checking their age. Once data is resident in memory, an entry older than `staleTtl` can continue to be returned instead of being discarded and refreshed.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/cached-resource/src/__probe__.test.ts <<'PROBE'
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveData } from "./cache-orchestrator.js";
import { createMemoryCache } from "./memory-cache.js";
import { createMemFs } from "./testing/index.js";

describe("memory expiration", () => {
  afterEach(() => vi.useRealTimers());

  it("serves memory data after staleTtl instead of discarding it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T00:00:00Z"));
    const memoryCache = createMemoryCache<{ source: string }>({ max: 10, ttl: 1_000 });
    memoryCache.set("demo", { data: { source: "expired-memory" }, timestamp: Date.now() });
    vi.advanceTimersByTime(1_001);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ source: "fresh-network" }), { status: 200 }));
    const result = await resolveData(
      { source: "bundled" },
      { freshTtl: 100, staleTtl: 1_000, fetchTimeout: 1_000, apiEndpoint: "https://example.test/resource", cacheDir: "/cache", cacheName: "demo" },
      { memoryCache, fs: createMemFs(), fetch }
    );
    console.log(JSON.stringify({ result, fetchCalls: fetch.mock.calls.length }));
    expect(result.data.source).toBe("expired-memory");
    expect(fetch).not.toHaveBeenCalled();
  });
});
PROBE
npm exec -- vitest run packages/cached-resource/src/__probe__.test.ts --reporter verbose
rm packages/cached-resource/src/__probe__.test.ts
```

Output:

```text
{"result":{"data":{"source":"expired-memory"},"timestamp":1779580800000},"fetchCalls":0}
✓ packages/cached-resource/src/__probe__.test.ts > memory expiration > serves memory data after staleTtl instead of discarding it
```

## Observed Behavior

The README describes `staleTtl` as the interval before cached data “is expired and discarded” in `packages/cached-resource/README.md`. Disk reads enforce that limit at `packages/cached-resource/src/disk-cache.ts:21` through `packages/cached-resource/src/disk-cache.ts:37`. By contrast, the factory gives the memory cache `ttl: config.staleTtl` at `packages/cached-resource/src/create-cached-resource.ts:46` through `packages/cached-resource/src/create-cached-resource.ts:49`, while `createMemoryCache()` sets `allowStale: true` at `packages/cached-resource/src/memory-cache.ts:17` through `packages/cached-resource/src/memory-cache.ts:24`. `resolveData()` immediately returns any memory result at `packages/cached-resource/src/cache-orchestrator.ts:26` through `packages/cached-resource/src/cache-orchestrator.ts:30`, without checking its timestamp or attempting a replacement fetch.

## Expected Behavior

Memory entries beyond `staleTtl` should be treated as expired just like disk entries: they should not be returned as valid cached data, and an online lookup should fetch fresh content or fall back only if that fetch fails.

## Impact

A long-lived process that has read a resource once can continue serving obsolete in-memory data past the configured maximum usable lifetime, while a freshly started process reading the same disk cache would correctly reject it. Consumers cannot rely on `staleTtl` to bound data age, causing stale provider lists, metadata, or remote resource snapshots to persist unpredictably until process restart or manual cache clearing.
