# Cached resource clear allows inflight revalidation to repopulate cleared cache

## Summary

`@poe-code/cached-resource` advertises `clear()` as clearing both memory and filesystem caches, but it does not cancel or await an already-triggered stale-while-revalidate fetch. If a background revalidation completes after `clear()` resolves, it recreates the disk cache and repopulates memory with data the caller believed had been removed.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/cached-resource/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { createCachedResource } from "./create-cached-resource.js";
import { createMemFs } from "./testing/index.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

describe("clear during background revalidation", () => {
  it("recreates disk cache after clear resolves", async () => {
    const fs = createMemFs();
    const pending = deferred<Response>();
    const config = {
      freshTtl: 1,
      staleTtl: 60_000,
      fetchTimeout: 10_000,
      apiEndpoint: "https://example.test/resource",
      cacheDir: "/cache",
      cacheName: "demo"
    };
    await fs.mkdir("/cache", { recursive: true });
    await fs.writeFile("/cache/demo.json", JSON.stringify({ data: { source: "stale" }, timestamp: Date.now() - 1000 }));
    const resource = createCachedResource({ source: "bundled" }, config, { fs, fetch: async () => pending.promise });

    const initial = await resource.get();
    await resource.clear();
    await expect(fs.readFile("/cache/demo.json", "utf8")).rejects.toThrow();
    pending.resolve(new Response(JSON.stringify({ source: "revalidated" }), { status: 200 }));
    await new Promise((settle) => setTimeout(settle, 0));
    const recreated = await fs.readFile("/cache/demo.json", "utf8");
    console.log(JSON.stringify({ initial, recreated: JSON.parse(recreated) }));
    expect(JSON.parse(recreated).data.source).toBe("revalidated");
  });
});
PROBE
npm exec -- vitest run packages/cached-resource/src/__probe__.test.ts --reporter verbose
rm packages/cached-resource/src/__probe__.test.ts
```

Output:

```text
{"initial":{"data":{"source":"stale"},"timestamp":1779670342682},"recreated":{"data":{"source":"revalidated"},"timestamp":1779670343686}}
✓ packages/cached-resource/src/__probe__.test.ts > clear during background revalidation > recreates disk cache after clear resolves
```

## Observed Behavior

Reading stale disk data triggers a background callback that later updates memory and calls `persist()` at `packages/cached-resource/src/cache-orchestrator.ts:32` through `packages/cached-resource/src/cache-orchestrator.ts:46`. The resource retains its `revalidator` internally at `packages/cached-resource/src/create-cached-resource.ts:46` through `packages/cached-resource/src/create-cached-resource.ts:60`, but `clear()` only clears memory and removes the current disk file at `packages/cached-resource/src/create-cached-resource.ts:67` through `packages/cached-resource/src/create-cached-resource.ts:70`. It neither cancels nor waits for pending background callbacks, which can write the cache again after `clear()` has resolved.

## Expected Behavior

After `clear()` resolves, previously scheduled revalidation work should no longer repopulate the cleared cache. The operation should cancel pending writes, invalidate their results, or await and then remove any output before promising that both cache tiers are clear.

## Impact

Applications cannot reliably purge stale or sensitive cached remote data while a revalidation is in progress. Logout, credential rotation, cache-reset controls, and tests can appear to clear local data only for a background request to silently restore it immediately afterward, violating caller expectations and potentially retaining data that was intentionally removed.
