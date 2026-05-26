# File lock negative stale window reclaims fresh foreign lock

## Summary

`acquireFileLock()` accepts a negative `staleMs` value. With `staleMs: -1`, a lock belonging to another host is treated as stale immediately, even when its lockfile was just created, allowing a second owner to delete and replace a fresh lock.

## Reproduction

Create a disposable Vitest probe at `packages/file-lock/src/__probe__.test.ts`:

```ts
import * as os from "node:os";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import { acquireFileLock, type FileLockFs } from "./lock.js";

describe("negative staleMs", () => {
  it("reclaims a freshly created foreign lock immediately", async () => {
    const volume = Volume.fromJSON({
      "/repo/workflow.md.lock": JSON.stringify({
        host: `${os.hostname()}-foreign`,
        pid: 1234,
      }),
    }, "/");
    const rawFs = createFsFromVolume(volume).promises;
    const fs = rawFs as unknown as FileLockFs;

    const release = await acquireFileLock("/repo/workflow.md", {
      fs,
      staleMs: -1,
      retries: 0,
    });

    await expect(rawFs.readFile("/repo/workflow.md.lock", "utf8"))
      .resolves.toContain(`"pid":${process.pid}`);
    await release();
  });
});
```

Run:

```sh
npm exec -- vitest run packages/file-lock/src/__probe__.test.ts --reporter verbose
```

The probe passes, demonstrating that acquisition replaces a freshly existing lock owned by a foreign host instead of timing out or waiting.

## Observed Behavior

`acquireFileLock()` copies `options.staleMs` without validation. When an existing lock contains metadata for a different host, `shouldReclaimLock()` decides staleness using `Date.now() - stat.mtimeMs > staleMs`. For a just-created lock, its age is approximately zero; with `staleMs: -1`, that comparison is already true. The lockfile is unlinked and replaced with current-process metadata on the first acquisition attempt.

## Expected Behavior

`staleMs` should reject negative or otherwise invalid durations. A lock whose age has not exceeded a non-negative stale interval must remain owned by its current holder, especially when host-local liveness cannot be checked.

## Impact

Callers can accidentally disable inter-process exclusion by supplying a negative stale interval. Fresh locks from another host or environment are immediately stolen, allowing simultaneous writers to operate on the same protected workflow or state file and causing corruption or lost updates.
