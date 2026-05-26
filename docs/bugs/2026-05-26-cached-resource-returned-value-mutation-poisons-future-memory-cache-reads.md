# Cached resource returned value mutation poisons future memory cache reads

## Summary

The exported `@poe-code/cached-resource` `createCachedResource()` API returns the same mutable `CachedData<T>` object that it stores in its in-memory cache. A consumer can mutate data from one successful `get()` call and silently alter what later consumers receive for the same resource, without any refresh or network request.

## Reproduction

From the repository root, create and run this disposable Vitest probe, then remove it:

```sh
cat > packages/cached-resource/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { createCachedResource } from "./create-cached-resource.js";
import { createMemFs } from "./testing/index.js";

describe("cached-resource returned cache isolation", () => {
  it("lets one consumer mutate the value returned to later consumers", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ models: ["trusted"] }),
    } as Response);
    const resource = createCachedResource(
      { models: ["bundled"] },
      {
        freshTtl: 60_000,
        staleTtl: 300_000,
        fetchTimeout: 5_000,
        apiEndpoint: "https://api.example.com/models",
        cacheDir: "/cache",
        cacheName: "models",
      },
      { fs: createMemFs(), fetch },
    );

    const first = await resource.get();
    first.data.models[0] = "forged";

    const second = await resource.get();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(second.data.models).toEqual(["forged"]);
  });
});
EOF
npm exec -- vitest run packages/cached-resource/src/__probe__.test.ts --reporter verbose
rm -f packages/cached-resource/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/cached-resource/src/__probe__.test.ts > cached-resource returned cache isolation > lets one consumer mutate the value returned to later consumers
Test Files  1 passed (1)
Tests       1 passed (1)
```

## Observed Behavior

The first `get()` fetches `{ models: ["trusted"] }`, caches that object, and returns it. Mutating `first.data.models[0]` to `"forged"` changes the object held by the in-memory cache. A second `get()` performs no network request and returns the mutated cached value `{ models: ["forged"] }`.

`createCachedResource()` wires every read through a shared memory cache in `packages/cached-resource/src/create-cached-resource.ts:39`. Fresh network results are stored and returned as the same `cached` object in `packages/cached-resource/src/cache-orchestrator.ts:54`, while memory hits return the cached object directly in `packages/cached-resource/src/cache-orchestrator.ts:26`. The memory cache itself stores and retrieves object references without cloning or immutability protection in `packages/cached-resource/src/memory-cache.ts:17`.

## Expected Behavior

Values returned to one cache consumer should not let that consumer mutate the authoritative cached value observed by later callers. The API should return isolated data or otherwise prevent mutation of stored cache entries.

## Impact

Any caller that enriches, sorts, filters, redacts, or accidentally modifies a returned resource object can poison later reads for all consumers sharing that cache instance. For model lists, policy metadata, feature configuration, or other remotely fetched resources, one component can silently replace trusted cached content with altered values until a refresh or clear occurs.
