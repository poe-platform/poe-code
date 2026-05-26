# Cached resource future disk timestamp suppresses expiry and revalidation

## Summary

`@poe-code/cached-resource` trusts the `timestamp` stored in its disk cache without checking whether it is plausibly in the past. A cache file dated far into the future is treated as fresh until local time reaches that value, bypassing both `staleTtl` expiration and normal stale-while-revalidate refresh behavior.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/cached-resource/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it, vi } from "vitest";
import { createCachedResource } from "./create-cached-resource.js";
import { createMemFs } from "./testing/index.js";

describe("future dated disk cache", () => {
  it("serves a cache entry far in the future without refresh", async () => {
    const fs = createMemFs({
      "/cache/demo.json": JSON.stringify({
        data: { source: "future-cache" },
        timestamp: Date.now() + 31_536_000_000,
      }),
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ source: "fresh-network" }), { status: 200 }));
    const resource = createCachedResource(
      { source: "bundled" },
      {
        freshTtl: 1,
        staleTtl: 1,
        fetchTimeout: 1000,
        apiEndpoint: "https://example.test/resource",
        cacheDir: "/cache",
        cacheName: "demo"
      },
      { fs, fetch }
    );

    const result = await resource.get();
    console.log(JSON.stringify({ result, fetchCalls: fetch.mock.calls.length }));
    expect(result.data).toEqual({ source: "future-cache" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
PROBE
npm exec -- vitest run packages/cached-resource/src/__probe__.test.ts --reporter verbose
rm packages/cached-resource/src/__probe__.test.ts
```

Output:

```text
{"result":{"data":{"source":"future-cache"},"timestamp":<future-timestamp>},"fetchCalls":0}
✓ packages/cached-resource/src/__probe__.test.ts > future dated disk cache > serves a cache entry far in the future without refresh
```

## Observed Behavior

The cache contract documents `timestamp` as the time when data was fetched and states that `staleTtl` defines when cached data is expired and discarded in `packages/cached-resource/README.md`. `loadFromDisk()` only checks `Date.now() - cached.timestamp > config.staleTtl` at `packages/cached-resource/src/disk-cache.ts:30`. If `timestamp` is one year in the future, that age is negative and therefore never expired under small TTLs. `resolveData()` repeats the same age pattern for `freshTtl` at `packages/cached-resource/src/cache-orchestrator.ts:36`, so it returns the future-dated entry without launching network revalidation.

## Expected Behavior

An on-disk timestamp that is later than the current time beyond an explicitly tolerated clock-skew allowance should be rejected as invalid cache metadata, or at minimum should not disable freshness and expiration safeguards. Ordinary online reads should recover by requesting valid current data.

## Impact

A corrupted, manually edited, or tampered cache entry can pin stale or attacker-supplied data for an arbitrarily long period simply by setting a future timestamp. Callers lose the freshness guarantees implied by `freshTtl` and `staleTtl`, and normal application usage cannot automatically repair the cache.
