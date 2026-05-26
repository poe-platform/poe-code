# Cached resource missing disk data is returned as valid cache hit

## Summary

`@poe-code/cached-resource` accepts a disk cache document that has a valid-looking `timestamp` but omits the required `data` payload. The normal online read returns that malformed object as a cache hit and never attempts the configured network fetch, violating the published `CachedData<T>` shape.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/cached-resource/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it, vi } from "vitest";
import { createCachedResource } from "./create-cached-resource.js";
import { createMemFs } from "./testing/index.js";

describe("missing disk cache data", () => {
  it("returns a cache record with no required data and never fetches", async () => {
    const fs = createMemFs({ "/cache/demo.json": JSON.stringify({ timestamp: Date.now() }) });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ source: "network" }), { status: 200 }));
    const resource = createCachedResource(
      { source: "bundled" },
      {
        freshTtl: 1000,
        staleTtl: 5000,
        fetchTimeout: 1000,
        apiEndpoint: "https://example.test/resource",
        cacheDir: "/cache",
        cacheName: "demo"
      },
      { fs, fetch }
    );

    const result = await resource.get();
    console.log(JSON.stringify({ keys: Object.keys(result), timestampType: typeof result.timestamp, fetchCalls: fetch.mock.calls.length }));
    expect(Object.hasOwn(result, "data")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
PROBE
npm exec -- vitest run packages/cached-resource/src/__probe__.test.ts --reporter verbose
rm packages/cached-resource/src/__probe__.test.ts
```

Output:

```text
{"keys":["timestamp"],"timestampType":"number","fetchCalls":0}
✓ packages/cached-resource/src/__probe__.test.ts > missing disk cache data > returns a cache record with no required data and never fetches
```

## Observed Behavior

The README specifies `CachedData<T>` as having both a `data` value and numeric `timestamp` in `packages/cached-resource/README.md`. `loadFromDisk()` in `packages/cached-resource/src/disk-cache.ts:21` through `packages/cached-resource/src/disk-cache.ts:37` simply parses JSON and casts it to `CachedData<T>` without verifying that `data` exists. When `timestamp` is recent, expiry passes and `resolveData()` stores and returns the malformed object as a disk-cache hit at `packages/cached-resource/src/cache-orchestrator.ts:29` through `packages/cached-resource/src/cache-orchestrator.ts:47`, skipping the configured network source entirely.

## Expected Behavior

Disk cache documents that omit the required `data` field should be rejected as invalid cache state. A normal online read should fall through to the network request, persist valid fetched data, and return an object conforming to the documented `CachedData<T>` contract.

## Impact

A corrupted or edited cache file can cause callers to receive an object without their required resource payload while the API presents it as a successful cache result. Consumers may crash or make decisions from `undefined`, and the cache will not automatically recover because ordinary reads never fetch replacement data.
