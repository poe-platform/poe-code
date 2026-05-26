# File lock stale reclamation deletes newly acquired successor lock

## Summary

Stale-lock reclamation determines that a lock is stale and then deletes the lock path in a separate filesystem operation without validating that the same stale file is still present. If another caller replaces the stale file with a newly acquired lock between the check and deletion, the stale reclaimer deletes the new owner's lock and then acquires concurrently.

## Reproduction

From the repository root, run a disposable Vitest probe whose reclaiming filesystem hook inserts a valid successor lock immediately before the stale reclaimer performs its unlink:

```sh
cat > /tmp/file-lock-stale-reclaim-race-probe.test.ts <<'EOF'
import os from "node:os";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { acquireFileLock, type FileLockFs } from "./lock.js";

describe("stale reclaim race", () => {
  it("deletes a successor lock acquired after stale detection and then acquires concurrently", async () => {
    vi.setSystemTime(new Date("2026-05-24T18:30:00.000Z"));
    const volume = Volume.fromJSON({
      "/repo/workflow.md": "# workflow\n",
      "/repo/workflow.md.lock": JSON.stringify({ pid: 99, host: `${os.hostname()}-remote` }),
    }, "/");
    volume.utimesSync(
      "/repo/workflow.md.lock",
      new Date("2026-05-24T18:29:00.000Z"),
      new Date("2026-05-24T18:29:00.000Z"),
    );
    const rawFs = createFsFromVolume(volume).promises;
    let injectedSuccessor = false;
    let releaseSuccessor: (() => Promise<void>) | undefined;
    let successorContents = "";
    const racingFs: FileLockFs = {
      ...(rawFs as any),
      unlink: async (filePath) => {
        if (!injectedSuccessor) {
          injectedSuccessor = true;
          await rawFs.unlink(filePath);
          releaseSuccessor = await acquireFileLock("/repo/workflow.md", { fs: rawFs as any });
          successorContents = await rawFs.readFile(filePath, "utf8");
        }
        await rawFs.unlink(filePath);
      },
    };

    const releaseContender = await acquireFileLock("/repo/workflow.md", { fs: racingFs, staleMs: 1000 });
    const finalContents = await rawFs.readFile("/repo/workflow.md.lock", "utf8");
    console.log(JSON.stringify({ successorAcquired: successorContents.includes("pid"), contenderAcquired: finalContents.includes("pid") }));
    expect(successorContents).toContain("pid");
    expect(finalContents).toContain("pid");
    await releaseContender();
    await releaseSuccessor?.();
  });
});
EOF
cp /tmp/file-lock-stale-reclaim-race-probe.test.ts packages/file-lock/src/__probe__.test.ts
trap 'rm -f packages/file-lock/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-file-lock-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/file-lock/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-file-lock-probe.config.mjs --reporter verbose
nl -ba packages/file-lock/src/lock.ts | sed -n '162,289p'
```

## Observed Behavior

A successor successfully creates a live lock file, but the stale reclaimer then deletes that successor lock and acquires its own lock on the same protected file:

```text
{"successorAcquired":true,"contenderAcquired":true}
✓ packages/file-lock/src/__probe__.test.ts > stale reclaim race > deletes a successor lock acquired after stale detection and then acquires concurrently
```

The implementation reads lock metadata and evaluates staleness in `packages/file-lock/src/lock.ts:162` through `packages/file-lock/src/lock.ts:197`, then later removes `lockPath` unconditionally when `reclaimLock` is true in `packages/file-lock/src/lock.ts:252` through `packages/file-lock/src/lock.ts:276`. No owner token, file identity, metadata re-check, or atomic compare-and-remove operation links the deletion to the specific stale lock previously examined.

## Expected Behavior

Stale-lock cleanup should remove only the exact lock instance that was validated as stale and must not delete a replacement lock acquired after the staleness check.

## Impact

Under ordinary contention around stale-lock recovery, two live operations can simultaneously receive exclusive-lock ownership. This can allow concurrent mutations of plans, experiment documents, superintendent state, or maestro workflows precisely when recovery is intended to restore safe serialization.
