# File lock negative retries time out before free lock attempt

## Summary

`acquireFileLock()` accepts a negative `retries` value. With `retries: -1`, the acquisition loop never performs its initial exclusive-open attempt, so requesting a completely free lock immediately rejects with `LockTimeoutError` while no lockfile exists.

## Reproduction

Create a disposable Vitest probe at `packages/file-lock/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import { acquireFileLock, LockTimeoutError, type FileLockFs } from "./lock.js";

describe("negative retries", () => {
  it("times out without attempting to create a free lock", async () => {
    const rawFs = createFsFromVolume(Volume.fromJSON({}, "/")).promises;
    const fs = rawFs as unknown as FileLockFs;

    await expect(acquireFileLock("/repo/workflow.md", {
      fs,
      retries: -1,
    })).rejects.toBeInstanceOf(LockTimeoutError);

    await expect(rawFs.stat("/repo/workflow.md.lock"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/file-lock/src/__probe__.test.ts --reporter verbose
```

The probe passes: acquisition times out while the target lock is free and no lockfile is ever created.

## Observed Behavior

`acquireFileLock()` copies `options.retries` without validation, initializes `attempt` to zero, and gates the entire acquisition loop on `while (attempt <= retries)`. For `retries: -1`, `0 <= -1` is false before the initial attempt, so the function skips `fs.open(lockPath, "wx")` entirely and falls through to `LockTimeoutError`.

## Expected Behavior

`retries` should reject negative values, or at minimum represent additional retries only after one mandatory initial lock acquisition attempt. A free lock must not time out solely because a malformed retry count prevented any attempt to claim it.

## Impact

Callers can configure locking to fail deterministically even when there is no contention, producing misleading timeout errors and blocking workflows that should proceed immediately. The behavior is especially confusing because `retries` sounds like a wait/retry policy rather than a switch that suppresses the first acquisition attempt.
