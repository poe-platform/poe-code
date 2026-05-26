# Cached Resource `persist` Silently Corrupts Prior Disk Cache on Partial Write Failure

## Summary

The exported `@poe-code/cached-resource` `persist()` helper overwrites an existing JSON cache file directly and intentionally swallows all write errors. If a failed refresh truncates or partially writes the cache file before rejecting, `persist()` resolves successfully while destroying the previously valid cached value.

## Reproduction

Create a disposable Vitest probe at `packages/cached-resource/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { loadFromDisk, persist, type DiskCacheFs } from "./disk-cache.js";

describe("disk cache failed persistence", () => {
  it("silently corrupts a prior cache value when an overwrite partially fails", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const filePath = "/cache/models.json";
    const base = createFsFromVolume(Volume.fromJSON({
      [filePath]: JSON.stringify({ data: "old", timestamp: 999 }),
    })).promises as unknown as DiskCacheFs;
    const fs: DiskCacheFs = {
      ...base,
      async writeFile(path, data) {
        if (path === filePath) {
          await base.writeFile(path, "{");
          throw new Error("disk full");
        }
        await base.writeFile(path, data);
      },
    };
    const config = { cacheDir: "/cache", cacheName: "models", staleTtl: 10_000 };

    await expect(persist("new", config, { fs })).resolves.toBeUndefined();
    const raw = await base.readFile(filePath, "utf8");
    const loaded = await loadFromDisk<string>(config, { fs: base });
    console.log(JSON.stringify({ raw, loaded }));
    expect(raw).toBe("{");
    expect(loaded).toBeNull();
  });
});
```

Run:

```sh
npm exec -- vitest run packages/cached-resource/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"raw":"{","loaded":null}
✓ packages/cached-resource/src/__probe__.test.ts > disk cache failed persistence > silently corrupts a prior cache value when an overwrite partially fails
```

Remove the disposable probe after validation.

## Observed Behavior

`loadFromDisk()` parses a cache file and returns `null` for any parse or read error at `packages/cached-resource/src/disk-cache.ts:19`. `persist()` writes updated cached data directly to that same path at `packages/cached-resource/src/disk-cache.ts:41`, and its surrounding `catch` unconditionally suppresses the failure at `packages/cached-resource/src/disk-cache.ts:53`. In the probe, a refresh attempt replaces a valid `{ data: "old" }` cache with `"{"`, resolves without any error, and makes the old cache load as a miss.

## Expected Behavior

Best-effort cache persistence should not discard a previously valid disk entry when refreshing it fails. Updates should use atomic replacement or retain the original cache on write failure; if corruption cannot be avoided, callers should receive a failure signal rather than silent success.

## Impact

Transient storage failures during background or foreground cache refreshes can silently erase usable offline/stale data. Consumers may unexpectedly re-fetch resources, fail in offline mode, or behave as if no cache ever existed, with no surfaced diagnostic indicating that a successful-looking persistence call corrupted the stored entry.
