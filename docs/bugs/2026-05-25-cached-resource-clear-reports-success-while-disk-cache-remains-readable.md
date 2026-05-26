# Cached resource clear reports success while disk cache remains readable

## Summary

`CachedResource.clear()` promises to clear both cache tiers, but filesystem deletion errors are silently swallowed. When disk cache removal fails, `clear()` resolves successfully after clearing only memory, and the next cache lookup immediately returns the supposedly cleared disk entry again.

## Reproduction

Create the disposable probe `packages/cached-resource/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createCachedResource } from "./create-cached-resource.js";

describe("cached resource failed clear", () => {
  it("reports success while an undeleted disk entry becomes visible again", async () => {
    const cached = JSON.stringify({ data: ["stale-disk"], timestamp: Date.now() });
    const resource = createCachedResource(["bundled"], {
      apiEndpoint: "https://unused.test/data",
      cacheDir: "/cache",
      cacheName: "items",
      freshTtl: 60_000,
      staleTtl: 60_000,
      fetchTimeout: 100,
    }, {
      fs: {
        readFile: async () => cached,
        writeFile: async () => undefined,
        mkdir: async () => undefined,
        unlink: async () => { throw new Error("permission denied"); },
      },
    });

    expect((await resource.get({ offline: true })).data).toEqual(["stale-disk"]);
    await expect(resource.clear()).resolves.toBeUndefined();
    expect((await resource.get({ offline: true })).data).toEqual(["stale-disk"]);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/cached-resource/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/cached-resource/src/__probe__.test.ts > cached resource failed clear > reports success while an undeleted disk entry becomes visible again
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

The public resource's `clear()` method clears its in-memory tier and awaits `removeFromDisk()` at `packages/cached-resource/src/create-cached-resource.ts:67` through `packages/cached-resource/src/create-cached-resource.ts:70`. `removeFromDisk()` catches every `unlink()` error and resolves normally at `packages/cached-resource/src/disk-cache.ts:56` through `packages/cached-resource/src/disk-cache.ts:64`, even for permission failures rather than only a missing file. In the probe, `clear()` resolves, but the subsequent offline `get()` loads and returns the unchanged `stale-disk` entry from the filesystem tier.

## Expected Behavior

If clearing the filesystem cache fails for a reason other than an already-absent file, `clear()` should reject or otherwise report that the cache is still present. A successfully resolved clear operation must not make the same stored entry immediately observable again.

## Impact

Applications using `clear()` to invalidate stale, sensitive, corrupted, or unauthorized resource data receive false assurance that persistent cache state has been removed. Permission or filesystem failures can cause old data to reappear on the very next request while callers continue under the assumption that invalidation succeeded.
