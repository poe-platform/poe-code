# File lock NaN stale window prevents reclaiming abandoned foreign lock

## Summary

`acquireFileLock()` accepts `staleMs: NaN`. For locks recorded as belonging to another host, the stale-age comparison then always evaluates false, so even an arbitrarily old abandoned lock cannot be reclaimed and acquisition immediately times out when retries are exhausted.

## Reproduction

Create a disposable Vitest probe at `packages/file-lock/src/__probe__.test.ts`:

```ts
import * as os from "node:os";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { acquireFileLock, LockTimeoutError, type FileLockFs } from "./lock.js";

describe("NaN staleMs", () => {
  it("fails to reclaim an arbitrarily old foreign lock", async () => {
    vi.setSystemTime(new Date("2026-05-25T12:00:00.000Z"));
    const volume = Volume.fromJSON({
      "/repo/workflow.md.lock": JSON.stringify({
        host: `${os.hostname()}-foreign`,
        pid: 1234,
      }),
    }, "/");
    volume.utimesSync(
      "/repo/workflow.md.lock",
      new Date("2000-01-01T00:00:00.000Z"),
      new Date("2000-01-01T00:00:00.000Z"),
    );
    const fs = createFsFromVolume(volume).promises as unknown as FileLockFs;

    await expect(acquireFileLock("/repo/workflow.md", {
      fs,
      staleMs: Number.NaN,
      retries: 0,
    })).rejects.toBeInstanceOf(LockTimeoutError);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/file-lock/src/__probe__.test.ts --reporter verbose
```

The probe passes: an abandoned foreign lock timestamped in the year 2000 remains unreclaimable under the accepted `NaN` option.

## Observed Behavior

`acquireFileLock()` forwards `options.staleMs` without validating that it is a finite duration. For a foreign lock, `shouldReclaimLock()` tests `Date.now() - stat.mtimeMs > options.staleMs`. When the configured threshold is `NaN`, the comparison is always false, regardless of how old the existing lock is. With `retries: 0`, acquisition throws `LockTimeoutError` while leaving the stale lock in place.

## Expected Behavior

`staleMs` should reject `NaN` and other invalid numeric values before attempting acquisition. An abandoned foreign lock whose age exceeds a valid configured stale interval should remain reclaimable.

## Impact

A malformed runtime option can permanently wedge workflows behind abandoned locks from other hosts or containers. Callers see lock timeouts and cannot recover through normal stale-lock reclamation until they manually delete the lockfile or restart with corrected configuration.
