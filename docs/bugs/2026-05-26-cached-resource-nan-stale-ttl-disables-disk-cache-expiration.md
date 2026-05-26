# Cached resource NaN stale TTL disables disk cache expiration

## Summary

The exported `@poe-code/cached-resource` disk-cache API accepts `staleTtl: NaN` and then treats every valid on-disk cache entry as unexpired. Even a cache record whose timestamp is effectively ancient is returned successfully instead of being discarded, because its expiration comparison evaluates to false with a non-finite TTL.

## Reproduction

Create this disposable Vitest probe at `packages/cached-resource/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { loadFromDisk } from "./disk-cache.js";

describe("cached-resource NaN stale TTL", () => {
  it("treats an old disk cache entry as valid forever when staleTtl is NaN", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({
      "/cache/models.json": JSON.stringify({ data: ["old"], timestamp: 1 }),
    }, "/")).promises as never;

    await expect(loadFromDisk({
      cacheDir: "/cache",
      cacheName: "models",
      staleTtl: Number.NaN,
    }, { fs })).resolves.toEqual({ data: ["old"], timestamp: 1 });
  });
});
```

Run the probe, then remove it:

```sh
npm exec -- vitest run packages/cached-resource/src/__probe__.test.ts --reporter verbose
rm -f packages/cached-resource/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/cached-resource/src/__probe__.test.ts > cached-resource NaN stale TTL > treats an old disk cache entry as valid forever when staleTtl is NaN
```

## Observed Behavior

A well-formed cache document containing `{ data: ["old"], timestamp: 1 }` is returned by `loadFromDisk()` despite using `staleTtl: Number.NaN`. With any ordinary finite expiration window, a timestamp of `1` milliseconds after the Unix epoch is far beyond expiry on May 26, 2026 and should be rejected.

The documented `CacheConfig.staleTtl` setting is the number of milliseconds before cached data is expired and discarded in `packages/cached-resource/README.md`. `loadFromDisk()` parses a cache document and applies its entire expiration decision through `Date.now() - cached.timestamp > config.staleTtl` at `packages/cached-resource/src/disk-cache.ts:21` through `packages/cached-resource/src/disk-cache.ts:37`. When `config.staleTtl` is `NaN`, that comparison is always false, so no valid timestamp can age out through this API.

This is separate from `docs/bugs/2026-05-24-cached-resource-missing-disk-timestamp-is-treated-as-valid-nonexpiring-cache.md`, which relies on malformed persisted cache data. The present defect uses a correctly shaped stale cache record and a malformed public cache configuration value.

## Expected Behavior

Cache configuration should reject non-finite expiration durations such as `NaN`, or otherwise handle them without disabling expiry. A valid cached entry whose age exceeds any meaningful configured stale lifetime must not be returned indefinitely because its TTL is invalid.

## Impact

Configuration values produced by arithmetic, environment parsing, or failed numeric conversion can silently disable filesystem cache expiration. Consumers may continue using obsolete model lists, metadata, or other cached API resources indefinitely while believing the configured stale-time policy is enforced.
