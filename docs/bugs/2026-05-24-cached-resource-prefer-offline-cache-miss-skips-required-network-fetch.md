# Cached resource prefer offline cache miss skips required network fetch

## Summary

`@poe-code/cached-resource` documents `preferOffline` as using cached or bundled data when available and fetching from the network when no cache exists. On a cold cache, `get({ preferOffline: true })` instead returns bundled fallback data immediately and never attempts the configured API request.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/cached-resource/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it, vi } from "vitest";
import { createCachedResource } from "./create-cached-resource.js";
import { createMemFs } from "./testing/index.js";

describe("preferOffline cache miss", () => {
  it("returns bundled data without fetching even though no cache exists", async () => {
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
      { fs: createMemFs(), fetch }
    );

    const result = await resource.get({ preferOffline: true });
    console.log(JSON.stringify({ result, fetchCalls: fetch.mock.calls.length }));
    expect(result).toEqual({ data: { source: "bundled" }, timestamp: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
PROBE
npm exec -- vitest run packages/cached-resource/src/__probe__.test.ts --reporter verbose
rm packages/cached-resource/src/__probe__.test.ts
```

Output:

```text
{"result":{"data":{"source":"bundled"},"timestamp":0},"fetchCalls":0}
✓ packages/cached-resource/src/__probe__.test.ts > preferOffline cache miss > returns bundled data without fetching even though no cache exists
```

## Observed Behavior

The README defines `preferOffline` as: “Use cached or bundled data when available, only fetch from network when no cache exists,” and the API table repeats that definition in `packages/cached-resource/README.md`. However, after cache lookup misses, `resolveData()` handles `offline || preferOffline` together and returns bundled fallback at `packages/cached-resource/src/cache-orchestrator.ts:50` through `packages/cached-resource/src/cache-orchestrator.ts:52`. It can only reach the network fetch at `packages/cached-resource/src/cache-orchestrator.ts:54` through `packages/cached-resource/src/cache-orchestrator.ts:62` when `preferOffline` is false.

## Expected Behavior

`preferOffline: true` should use memory or disk cache when one exists, but on a cache miss it should attempt the configured network fetch before falling back to bundled data if that fetch fails. `offline: true` should remain the mode that never performs network requests.

## Impact

Callers following the published API cannot populate a cold cache or obtain current server data while opting into cache-first behavior. They silently receive bundled snapshots indefinitely on cold starts, making `preferOffline` functionally indistinguishable from offline mode until another code path independently warms the cache.
