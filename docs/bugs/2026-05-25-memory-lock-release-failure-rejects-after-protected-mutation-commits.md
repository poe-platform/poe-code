# Memory lock release failure rejects after protected mutation commits

## Summary

The `memory` package's exported `withLock()` helper runs a protected mutation and then releases its lock file in a `finally` block. If lock-file deletion fails after the callback has already committed its change, `withLock()` rejects and leaves the lock behind, making successful memory operations look failed and blocking follow-up work.

## Reproduction

Create the disposable probe `packages/memory/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { withLock } from "./lock.js";

describe("memory lock failed release", () => {
  it("rejects after the protected mutation commits when lock removal fails", async () => {
    let storedLock = "";
    let committed = false;
    const fs = {
      writeFile: vi.fn(async (_path: string, value: string) => { storedLock = value; }),
      readFile: vi.fn(async () => storedLock),
      unlink: vi.fn(async () => { throw new Error("lock removal failed"); }),
    };

    await expect(withLock("/memory", async () => {
      committed = true;
      return "done";
    }, { fs, pid: 123 })).rejects.toThrow("lock removal failed");

    expect(committed).toBe(true);
    expect(storedLock).toContain("123");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/memory/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/memory/src/__probe__.test.ts > memory lock failed release > rejects after the protected mutation commits when lock removal fails
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`withLock()` acquires its lock file, returns the callback result, and performs `await removeLockFile(fs, lockPath)` from its `finally` block at `packages/memory/src/lock.ts:104` through `packages/memory/src/lock.ts:143`. `removeLockFile()` propagates non-`ENOENT` deletion failures at `packages/memory/src/lock.ts:77` through `packages/memory/src/lock.ts:85`. In the probe, the callback sets its committed side effect and completes successfully, but the failing `unlink()` causes the public operation to reject while the lock content remains present.

## Expected Behavior

Memory operations must distinguish a committed mutation followed by cleanup failure from a mutation that did not occur, and must avoid leaving a lock that makes the successfully updated memory unavailable. Cleanup failure should be handled or reported as an explicit partial-success condition with a recovery path.

## Impact

Any memory write, append, or clear path wrapped by `withLock()` can persist user-visible changes and then reject because lock cleanup failed. Callers may retry operations that already committed, causing duplicated edits or conflicting state, while the retained lock blocks other memory commands until manually repaired or reclaimed.
