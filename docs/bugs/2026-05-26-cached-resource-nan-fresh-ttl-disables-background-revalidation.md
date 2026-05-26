# Cached resource NaN fresh TTL disables background revalidation

## Summary

`@poe-code/cached-resource` accepts `freshTtl: Number.NaN` through its public `CacheConfig` shape and then treats aged filesystem data as not stale. A disk-cached entry that should trigger stale-while-revalidate is returned and promoted into memory without starting the background fetch that would repair it.

## Reproduction

Create a disposable Vitest probe at `packages/cached-resource/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { createRevalidator } from "./background-revalidator.js";
import { resolveData } from "./cache-orchestrator.js";
import type { DiskCacheFs } from "./disk-cache.js";
import type { CacheConfig, CachedData } from "./types.js";
import type { MemoryCache } from "./memory-cache.js";

describe("NaN fresh TTL", () => {
  it("serves an aged disk entry without triggering background refresh", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const volume = Volume.fromJSON({
      "/cache/items.json": JSON.stringify({ data: ["stale"], timestamp: now - 60_000 })
    }, "/");
    const rawFs = createFsFromVolume(volume).promises;
    const fs: DiskCacheFs = {
      readFile: (filePath, encoding) => rawFs.readFile(filePath, encoding) as Promise<string>,
      writeFile: (filePath, content) => rawFs.writeFile(filePath, content) as Promise<void>,
      mkdir: (filePath, options) => rawFs.mkdir(filePath, options) as Promise<void>,
      unlink: (filePath) => rawFs.unlink(filePath) as Promise<void>
    };
    const values = new Map<string, CachedData<string[]>>();
    const memoryCache: MemoryCache<string[]> = {
      get: (key) => values.get(key),
      set: (key, value) => { values.set(key, value); },
      clear: () => values.clear(),
      get size() { return values.size; },
      get max() { return 100; }
    };
    const config: CacheConfig = {
      freshTtl: Number.NaN,
      staleTtl: 300_000,
      fetchTimeout: 100,
      apiEndpoint: "https://example.test/items",
      cacheDir: "/cache",
      cacheName: "items"
    };
    const fetch = vi.fn(async () => new Response(JSON.stringify(["fresh"]), { status: 200 }));
    const revalidator = createRevalidator();

    const result = await resolveData(["bundled"], config, { memoryCache, fs, fetch, revalidator });
    await revalidator.waitForRevalidation();

    expect(result.data).toEqual(["stale"]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
```

Run the probe and delete it after confirmation:

```sh
npm exec -- vitest run packages/cached-resource/src/__probe__.test.ts --reporter verbose
rm -f packages/cached-resource/src/__probe__.test.ts
```

The probe passes and confirms that an entry aged well beyond any normal freshness interval is served without a network revalidation attempt:

```text
✓ packages/cached-resource/src/__probe__.test.ts > NaN fresh TTL > serves an aged disk entry without triggering background refresh
```

## Observed Behavior

The public `CacheConfig` type exposes `freshTtl` only as `number` in `packages/cached-resource/src/types.ts:12`, with no finite/non-negative validation at construction or use. In `packages/cached-resource/src/cache-orchestrator.ts:32`, a valid disk cache record is loaded and copied into memory; its revalidation decision at `packages/cached-resource/src/cache-orchestrator.ts:36` computes `Date.now() - diskCached.timestamp > config.freshTtl`. With `freshTtl: Number.NaN`, this comparison is always false, so the aged entry is returned and no `revalidator.trigger()` call occurs.

## Expected Behavior

Invalid freshness durations such as `NaN` should be rejected before cache operations begin, or otherwise handled so they cannot disable required stale-data refresh. A disk record older than the configured freshness policy must not be indefinitely treated as fresh due to an invalid numeric option.

## Impact

SDK consumers can accidentally disable background cache repair with a malformed calculated or decoded configuration value. Stale persisted data is then promoted to in-process memory and repeatedly served without network refresh, leaving users with obsolete resource definitions or API metadata while the cache appears to be operating normally.
