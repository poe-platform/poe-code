# File lock negative backoff timeouts exhaust retries without waiting

## Summary

`acquireFileLock()` accepts negative `minTimeout` and `maxTimeout` values. During contention, those options produce negative delays that Node schedules immediately, causing all configured retries to be consumed without any passage of time instead of waiting for the current owner to release the lock.

## Reproduction

Create a disposable Vitest probe at `packages/file-lock/src/__probe__.test.ts`:

```ts
import * as os from "node:os";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { acquireFileLock, LockTimeoutError, type FileLockFs } from "./lock.js";

describe("negative retry backoff", () => {
  it("exhausts retries without advancing time while a live lock is held", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const volume = Volume.fromJSON({
      "/repo/workflow.md.lock": JSON.stringify({
        host: os.hostname(),
        pid: process.pid,
      }),
    }, "/");
    const fs = createFsFromVolume(volume).promises as unknown as FileLockFs;
    const acquisition = acquireFileLock("/repo/workflow.md", {
      fs,
      retries: 2,
      minTimeout: -10,
      maxTimeout: -10,
    });
    const rejected = expect(acquisition).rejects.toBeInstanceOf(LockTimeoutError);

    await vi.runAllTimersAsync();

    await rejected;
    expect(Date.now()).toBe(0);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/file-lock/src/__probe__.test.ts --reporter verbose
```

The probe passes: the lock remains live and all retries expire while the fake clock stays at exactly zero milliseconds.

## Observed Behavior

`acquireFileLock()` copies `minTimeout` and `maxTimeout` without validating duration ranges. When acquisition encounters an owned lock, `backoff()` evaluates `Math.min(-10, -10 * 2 ** attempt)` and returns a negative timeout. `sleep()` forwards that number directly to `setTimeout()`, which executes as an immediate timer. Consequently, the loop makes its retry attempts and raises `LockTimeoutError` without waiting at all.

## Expected Behavior

Retry timeout options should accept only finite non-negative durations and preserve actual waiting between contended attempts. Invalid negative timeout configuration should fail immediately rather than silently changing lock acquisition into a zero-delay polling loop.

## Impact

Under contention, callers can unexpectedly fail before a current owner has any opportunity to release a lock, while rapidly repeating filesystem inspection and acquisition attempts. This defeats the documented bounded-backoff behavior and can amplify contention or generate spurious lock timeouts in workflows configured with malformed retry intervals.
