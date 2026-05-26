# Cached resource missing disk timestamp is treated as valid nonexpiring cache

## Summary

`@poe-code/cached-resource` accepts a disk cache entry that omits the required numeric `timestamp` field. Because expiry and stale checks perform arithmetic against `undefined`, both comparisons evaluate to false and the malformed disk value is returned as usable cache data without network revalidation or replacement.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/cached-resource/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it, vi } from "vitest";
import { createCachedResource } from "./create-cached-resource.js";
import { createMemFs } from "./testing/index.js";

describe("invalid disk cache timestamp", () => {
  it("accepts a missing timestamp forever and suppresses network refresh", async () => {
    const fs = createMemFs({ "/cache/demo.json": JSON.stringify({ data: { source: "untrusted-cache" } }) });
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
    expect(result).toEqual({ data: { source: "untrusted-cache" } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
PROBE
npm exec -- vitest run packages/cached-resource/src/__probe__.test.ts --reporter verbose
rm packages/cached-resource/src/__probe__.test.ts
```

Output:

```text
{"result":{"data":{"source":"untrusted-cache"}},"fetchCalls":0}
✓ packages/cached-resource/src/__probe__.test.ts > invalid disk cache timestamp > accepts a missing timestamp forever and suppresses network refresh
```

## Observed Behavior

The documented cache contract requires `CachedData.timestamp` to be a numeric Unix timestamp and states that `staleTtl` is the lifetime after which cached data is expired and discarded in `packages/cached-resource/README.md`. `loadFromDisk()` parses the on-disk JSON directly as `CachedData<T>` without runtime validation in `packages/cached-resource/src/disk-cache.ts:26`, then computes `Date.now() - cached.timestamp > config.staleTtl` in `packages/cached-resource/src/disk-cache.ts:30`. For a missing timestamp, the expression becomes `NaN > staleTtl`, which is false, so malformed data is accepted. `resolveData()` then stores and returns that data, and its staleness check at `packages/cached-resource/src/cache-orchestrator.ts:36` also evaluates false, suppressing background refresh.

## Expected Behavior

Disk cache files whose shape does not include a valid numeric `timestamp` should be rejected as cache misses or removed as invalid. A normal online read should then fetch current resource data and populate a valid cache entry rather than serving malformed disk content indefinitely.

## Impact

A corrupted or tampered cache file can permanently pin arbitrary stored data for ordinary callers, bypassing both expiration and stale-while-revalidate behavior. This prevents automatic recovery from malformed cache state and can cause consumers to rely on obsolete or attacker-controlled resource data until the cache is explicitly cleared or force-refreshed.
