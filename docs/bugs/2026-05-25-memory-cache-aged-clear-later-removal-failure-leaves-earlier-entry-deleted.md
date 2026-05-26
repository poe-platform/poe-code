# Memory Cache Aged Clear Later Removal Failure Leaves Earlier Entry Deleted

## Summary

The exported `@poe-code/memory` `clearCache()` API removes expired ingest-cache files sequentially when an age filter is supplied. If removal of a later expired entry fails, the operation rejects after earlier eligible entries have already been deleted, leaving a partially cleared cache despite the failed result.

## Reproduction

Create a disposable probe at `packages/memory/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { clearCache } = await import("./cache.js");

const entry = (key: string) => JSON.stringify({
  key,
  ingestedAt: "2026-05-24T00:00:00.000Z",
  sourceLabel: "docs/source.md",
  diff: { created: [], updated: [], deleted: [] },
  exitCode: 0,
  durationMs: 1,
  memoryTokens: 1,
  sourceTokens: 1,
  promptTemplateVersion: "v1",
  agentId: "claude-code"
});

describe("memory cache partial clear probe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vol.reset();
  });

  it("leaves the first expired entry removed when deleting the second rejects", async () => {
    const root = "/repo/.poe-code/memory";
    vol.fromJSON({
      [`${root}/.cache/ingest/a.json`]: entry("a"),
      [`${root}/.cache/ingest/b.json`]: entry("b")
    });
    vi.setSystemTime(new Date("2026-05-25T00:00:00.000Z"));
    const originalRm = vol.promises.rm.bind(vol.promises);
    vi.spyOn(vol.promises, "rm").mockImplementation(async (filePath, options) => {
      if (String(filePath).endsWith("/b.json")) {
        throw new Error("injected second removal failure");
      }
      return originalRm(filePath, options);
    });

    await expect(clearCache(root, { olderThanMs: 1 })).rejects.toThrow(
      "injected second removal failure"
    );
    await expect(vol.promises.readFile(`${root}/.cache/ingest/a.json`, "utf8")).rejects.toThrow();
    await expect(vol.promises.readFile(`${root}/.cache/ingest/b.json`, "utf8")).resolves.toContain(
      '"key":"b"'
    );
  });
});
```

Run:

```sh
npm exec -- vitest run packages/memory/src/__probe__.test.ts --reporter verbose
```

The probe passes, proving that an earlier eligible entry is removed before a later deletion failure aborts the request. Remove the disposable probe afterward.

## Observed Behavior

`clearCache(root, { olderThanMs: 1 })` rejects with `injected second removal failure`, but the sorted first expired entry `a.json` has already been deleted while `b.json` remains in place. The function does not return a removal count or rollback the entry removed before the error.

## Expected Behavior

An age-filtered cache clear should either complete the selected removal set, retain the original cache on failure, or return an explicit partial-removal result. A rejected cleanup request should not silently delete only a prefix of eligible cache entries.

## Impact

Permission changes, filesystem faults, or transient removal errors can make a failed cleanup command alter the cache unpredictably. Callers cannot know which entries were removed from the rejected operation, and retries or diagnostics may observe a partially pruned ingest cache with lost reusable results.
