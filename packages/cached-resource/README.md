# @poe-code/cached-resource

A generic three-tier caching library for JSON resources. Data is always available — even offline or on cold start — thanks to bundled fallback data shipped with your package.

## How it works

The cache resolves data through three tiers, in order:

1. **Memory** — In-process LRU cache (`lru-cache`) for sub-millisecond reads.
2. **Filesystem** — XDG-compliant disk cache (`$XDG_CACHE_HOME` or `~/.cache`) for persistence across restarts.
3. **Bundled fallback** — Static data shipped with the package, always available.

When the filesystem cache holds data that is **stale** (older than `freshTtl`) but **not expired** (within `staleTtl`), the stale data is returned immediately while a background fetch refreshes both memory and disk caches. This is the **stale-while-revalidate** pattern — callers are never blocked waiting for a network request when cached data exists.

If all caches miss and the network fetch fails, the bundled fallback is returned with `timestamp: 0`.

## Usage

### Basic

```ts
import { createCachedResource, resolveCacheDir } from "@poe-code/cached-resource";

const bundledModels = [{ id: "gpt-4", name: "GPT-4" }];

const cache = createCachedResource(bundledModels, {
  freshTtl: 60_000, // data is "fresh" for 60 seconds
  staleTtl: 86_400_000, // data is usable for 24 hours
  fetchTimeout: 5_000, // abort network request after 5 seconds
  apiEndpoint: "https://api.example.com/models",
  cacheDir: resolveCacheDir("my-app"),
  cacheName: "models"
});

const { data, timestamp } = await cache.get();
```

### Offline mode

Return cached or bundled data without ever hitting the network:

```ts
const result = await cache.get({ offline: true });
```

### Prefer offline

Use cached or bundled data when available, only fetch from network when no cache exists:

```ts
const result = await cache.get({ preferOffline: true });
```

### Force refresh

Skip all caches and fetch fresh data from the API:

```ts
const result = await cache.get({ forceRefresh: true });
```

### Cache management

```ts
// Clear both memory and filesystem caches
await cache.clear();

// Inspect cache state
const { memoryCacheSize, memoryCacheMax, cacheDir } = cache.stats();
```

## Environment Variables

This package does not read public environment variables directly. Use `resolveCacheDir(appName)` to follow platform cache directory conventions.

## Configuration Options

Pass a `CacheConfig` object to `createCachedResource(...)`. It controls freshness windows, fetch timeout, remote endpoint, cache directory, and cache file name. Per-call behavior is controlled by `FetchOptions`.

## API

### `createCachedResource<T>(bundledData, config, deps?)`

Factory function that creates a cache instance.

**Parameters:**

| Parameter     | Type                 | Description                                        |
| ------------- | -------------------- | -------------------------------------------------- |
| `bundledData` | `T`                  | Static fallback data, always available             |
| `config`      | `CacheConfig`        | Cache configuration (see below)                    |
| `deps`        | `CachedResourceDeps` | Optional dependency injection for `fs` and `fetch` |

**Returns:** `CachedResource<T>`

| Method    | Signature                                            | Description                                             |
| --------- | ---------------------------------------------------- | ------------------------------------------------------- |
| `get`     | `(options?: FetchOptions) => Promise<CachedData<T>>` | Resolve data through the three-tier cache               |
| `refresh` | `() => Promise<CachedData<T>>`                       | Shorthand for `get({ forceRefresh: true })`             |
| `clear`   | `() => Promise<void>`                                | Clear memory and filesystem caches                      |
| `stats`   | `() => CacheStats`                                   | Return memory cache size, max, and cache directory path |

### `resolveCacheDir(appName)`

Returns an XDG-compliant cache directory path: `$XDG_CACHE_HOME/<appName>` or `~/.cache/<appName>`.

### `CacheConfig`

| Property       | Type     | Description                                                                            |
| -------------- | -------- | -------------------------------------------------------------------------------------- |
| `freshTtl`     | `number` | Milliseconds before cached data is considered stale (triggers background revalidation) |
| `staleTtl`     | `number` | Milliseconds before cached data is expired and discarded                               |
| `fetchTimeout` | `number` | Milliseconds before a network request is aborted                                       |
| `apiEndpoint`  | `string` | URL to fetch fresh data from                                                           |
| `cacheDir`     | `string` | Directory for filesystem cache files                                                   |
| `cacheName`    | `string` | Base name for the cache file (`<cacheName>.json`)                                      |

### `FetchOptions`

| Property        | Type      | Default | Description                                               |
| --------------- | --------- | ------- | --------------------------------------------------------- |
| `forceRefresh`  | `boolean` | `false` | Skip all caches, fetch from network                       |
| `preferOffline` | `boolean` | `false` | Return cached/bundled data, only fetch if no cache exists |
| `offline`       | `boolean` | `false` | Never hit the network, return cached or bundled data      |

### `CachedData<T>`

| Property    | Type     | Description                                                                  |
| ----------- | -------- | ---------------------------------------------------------------------------- |
| `data`      | `T`      | The cached resource data                                                     |
| `timestamp` | `number` | Unix timestamp (ms) when the data was fetched. `0` for bundled fallback data |

## Testing

The package provides a `@poe-code/cached-resource/testing` subexport with utilities for mocking in consumer tests.

### `createMockCachedResource<T>(bundledData)`

Creates a mock `CachedResource<T>` where every method is a `vi.fn()`. The mocks return sensible defaults (bundled data with `timestamp: 0`).

```ts
import { createMockCachedResource } from "@poe-code/cached-resource/testing";

const mockCache = createMockCachedResource([{ id: "gpt-4" }]);

// Use in tests
mockCache.get.mockResolvedValue({
  data: [{ id: "gpt-4" }],
  timestamp: Date.now()
});

// Inject into the code under test
const result = await myService(mockCache);

expect(mockCache.get).toHaveBeenCalledWith({ offline: true });
```

### `createMemFs(files?)`

Creates an in-memory filesystem (`DiskCacheFs`) backed by `memfs`. Useful for testing lower-level cache functions directly.

```ts
import { createMemFs } from "@poe-code/cached-resource/testing";
import { loadFromDisk, persist } from "@poe-code/cached-resource";

const fs = createMemFs();

await persist({ id: 1 }, config, { fs });
const result = await loadFromDisk(config, { fs });
```
