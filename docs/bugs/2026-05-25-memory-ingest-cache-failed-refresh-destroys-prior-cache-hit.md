# Memory Ingest Cache Failed Refresh Destroys Prior Cache Hit

## Summary

The exported `@poe-code/memory` ingest cache writer replaces each existing cache-entry JSON file directly. If a refresh partially overwrites a previously valid entry and then rejects, the prior cached ingest result is lost; subsequent reads warn about malformed state and return a cache miss.

## Reproduction

Create a disposable Vitest probe at `packages/memory/src/__probe__.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fs as memfs, vol } from "memfs";

vi.mock("node:fs/promises", () => ({
  ...memfs.promises,
  async writeFile(filePath: string, data: string, encoding: string) {
    if (filePath.endsWith("/entry.json")) {
      await memfs.promises.writeFile(filePath, "{", encoding as BufferEncoding);
      throw new Error("cache disk full");
    }
    return memfs.promises.writeFile(filePath, data, encoding as BufferEncoding);
  },
}));

const { readCacheEntry, writeCacheEntry } = await import("./cache.js");

describe("memory ingest cache interrupted refresh", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("makes an existing cache hit unreadable after a rejected replacement write", async () => {
    const root = "/repo/.poe-code/memory";
    const entry = {
      key: "entry", ingestedAt: "2026-05-25T00:00:00.000Z", sourceLabel: "old",
      diff: { created: [], updated: [], deleted: [] }, exitCode: 0, durationMs: 1,
      memoryTokens: 2, sourceTokens: 3, promptTemplateVersion: "v1", agentId: "codex",
    };
    vol.fromJSON({ [`${root}/.cache/ingest/entry.json`]: `${JSON.stringify(entry)}\n` });

    await expect(writeCacheEntry(root, { ...entry, sourceLabel: "new" })).rejects.toThrow("cache disk full");
    const raw = await memfs.promises.readFile(`${root}/.cache/ingest/entry.json`, "utf8");
    const loaded = await readCacheEntry(root, "entry");
    console.log(JSON.stringify({ raw, loaded }));
    expect(raw).toBe("{");
    expect(loaded).toBeNull();
  });
});
```

Run:

```sh
npm exec -- vitest run packages/memory/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
Ignoring ingest cache entry "entry": Expected property name or '}' in JSON at position 1 (line 1 column 2)
{"raw":"{","loaded":null}
✓ packages/memory/src/__probe__.test.ts > memory ingest cache interrupted refresh > makes an existing cache hit unreadable after a rejected replacement write
```

Remove the disposable probe after validation.

## Observed Behavior

`readCacheEntry()` parses persisted ingest cache entries and converts invalid data into a warning plus `null` at `packages/memory/src/cache.ts:41`. `writeCacheEntry()` writes replacement JSON directly to the live entry path at `packages/memory/src/cache.ts:50`, without staging or rollback. In the probe, a refresh attempt rejects after truncating the file to `"{"`; the next read no longer returns the prior cached ingest result and instead reports a malformed-entry warning and cache miss.

## Expected Behavior

Refreshing an ingest cache entry should preserve the last valid cache result when persistence fails. Replacement writes should be atomic or recoverable so a rejected cache update cannot discard usable stored ingest output.

## Impact

Transient storage failures during memory ingestion can erase reusable results and force later commands to re-run expensive agent ingestion work or operate without a previously available cache hit. The read path treats the resulting corruption as an ignorable miss, obscuring that a failed refresh destroyed valid cached state.
