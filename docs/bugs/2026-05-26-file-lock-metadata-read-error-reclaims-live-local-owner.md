# File lock metadata read error reclaims live local owner

## Summary

`@poe-code/file-lock` uses lock metadata to preserve an aged local lock when its owning PID is still running, but any non-`ENOENT` failure while reading that metadata is silently converted into “no metadata.” Once the lockfile becomes older than `staleMs`, a contender therefore deletes and replaces a still-live local owner's lock solely because its metadata could not be read.

## Reproduction

Create a disposable Vitest probe at `packages/file-lock/src/__probe__.test.ts`:

```ts
import * as os from "node:os";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { acquireFileLock, type FileLockFs } from "./lock.js";

describe("stale live lock with unreadable metadata", () => {
  it("reclaims a local lock even though its recorded owner is running", async () => {
    vi.setSystemTime(new Date("2026-05-26T12:00:00.000Z"));
    const volume = Volume.fromJSON({
      "/repo/workflow.md": "# workflow\n",
      "/repo/workflow.md.lock": JSON.stringify({
        pid: 123,
        host: os.hostname(),
        acquiredAt: "2026-05-26T11:58:00.000Z"
      })
    }, "/");
    const rawFs = createFsFromVolume(volume).promises;
    volume.utimesSync(
      "/repo/workflow.md.lock",
      new Date("2026-05-26T11:58:00.000Z"),
      new Date("2026-05-26T11:58:00.000Z")
    );
    const fs: FileLockFs = {
      ...(rawFs as unknown as FileLockFs),
      readFile: async () => {
        const error = new Error("permission denied") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
    };
    const pidProbe = vi.fn(() => true);

    const release = await acquireFileLock("/repo/workflow.md", {
      fs,
      staleMs: 30_000,
      retries: 0,
      isPidRunning: pidProbe
    });

    expect(pidProbe).not.toHaveBeenCalled();
    await expect(rawFs.readFile("/repo/workflow.md.lock", "utf8")).resolves.toContain(
      `"pid":${process.pid}`
    );
    await release();
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/file-lock/src/__probe__.test.ts --reporter verbose
rm -f packages/file-lock/src/__probe__.test.ts
```

The probe passes, demonstrating that the contender acquires the lock despite the preexisting metadata identifying a running local owner:

```text
✓ packages/file-lock/src/__probe__.test.ts > stale live lock with unreadable metadata > reclaims a local lock even though its recorded owner is running
```

## Observed Behavior

`readLockMetadata()` in `packages/file-lock/src/lock.ts:162` returns `undefined` for every metadata-read error except `ENOENT`, including permission and transient I/O failures. `shouldReclaimLock()` in `packages/file-lock/src/lock.ts:181` only checks `isPidRunning()` when metadata was successfully read and names the local hostname; with `undefined` metadata, it instead applies age-based reclamation. In the probe, the existing lock contains valid local metadata for PID `123`, the supplied liveness callback would report that PID as running, but an `EACCES` read causes the callback never to be consulted and the lock is overwritten with the contender's PID.

## Expected Behavior

A transient or permission-related failure to inspect an existing lock's ownership metadata should not be treated as proof that PID protection is absent. The acquisition should fail or retry without deleting the lock unless stale reclamation can be established without discarding potentially valid live-owner evidence.

## Impact

Filesystem access changes, antivirus/file-indexer interference, network-volume read faults, or injected filesystem adapters can turn an aged but actively held local lock into a stealable lock. Two processes may then believe they exclusively own the same workflow or state file, enabling concurrent mutations, lost updates, and corrupted orchestration state.
