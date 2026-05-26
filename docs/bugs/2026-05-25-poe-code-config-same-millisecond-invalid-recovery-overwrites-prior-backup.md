# Poe Code Config Same Millisecond Invalid Recovery Overwrites Prior Backup

## Summary

The exported `@poe-code/poe-code-config` `readDocument()` recovery path saves malformed configuration content to a timestamped `.invalid-*` backup before rewriting the live document. Because the backup filename has only millisecond precision, two recoveries of the same file within one millisecond use the same backup path, and the later invalid input silently overwrites the earlier recovery evidence.

## Reproduction

Create a disposable Vitest probe at `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockFs } from "@poe-code/config-mutations/testing";
import { readDocument } from "./store.js";

describe("config invalid recovery timestamp collision", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("overwrites an earlier invalid backup when recovery repeats in one millisecond", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T12:34:56.789Z"));

    const target = "/home/test/.poe-code/config.json";
    const backup = `${target}.invalid-2026-05-25T12-34-56-789Z.json`;
    const fs = createMockFs({ [target]: "{ first" }, "/home/test");

    await expect(readDocument(fs, target)).resolves.toEqual({});
    await fs.writeFile(target, "{ second", { encoding: "utf8" });
    await expect(readDocument(fs, target)).resolves.toEqual({});

    expect(fs.getContent(backup)).toBe("{ second");
    expect(Object.keys(fs.files).filter((filePath) => filePath.includes(".invalid-"))).toEqual([
      backup
    ]);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-code-config/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/poe-code-config/src/__probe__.test.ts > config invalid recovery timestamp collision > overwrites an earlier invalid backup when recovery repeats in one millisecond
```

Remove the disposable probe after validation.

## Observed Behavior

`readDocument()` is publicly exported at `packages/poe-code-config/src/index.ts:63` through `packages/poe-code-config/src/index.ts:70`. When parsing fails, `parseStoredDocument()` calls `recoverInvalidDocument()` at `packages/poe-code-config/src/store.ts:80` through `packages/poe-code-config/src/store.ts:99`. The recovery function creates a backup name from the target basename and `createTimestamp()`, writes the raw invalid contents to that backup, and rewrites the live document at `packages/poe-code-config/src/store.ts:149` through `packages/poe-code-config/src/store.ts:180`. In the probe, two distinct malformed inputs recovered at the same mocked millisecond leave only one backup, containing the second malformed value.

## Expected Behavior

Each successful invalid-document recovery should retain the exact malformed input it recovered, including when multiple recoveries occur within one clock millisecond. Recovery backup creation should use collision-safe names or refuse to overwrite a previously preserved snapshot.

## Impact

Rapid repeated reads, concurrent consumers, or deterministic-clock automation can erase the first malformed configuration contents during automatic recovery. Debugging and manual restoration lose evidence while both reads return normally after destructive recovery, making the loss silent and difficult to detect.
