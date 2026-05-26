# File lock reclaims lock before inflight metadata publication completes

## Summary

`@poe-code/file-lock` creates the lock file with `open(..., "wx")` and then writes owner metadata asynchronously. A contender observing the lock during this publication window can see empty/invalid metadata, apply age-based stale reclamation, remove the live lock, and acquire the same resource before the original acquisition resolves.

## Reproduction

From the repository root, run a disposable Vitest probe that pauses the first metadata write after exclusive lockfile creation and ages the still-empty file before a second acquisition:

```sh
cat > /tmp/file-lock-inflight-metadata-publication-probe.test.ts <<'EOF'
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { acquireFileLock, type FileLockFs } from "./lock.js";
function deferred<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>((res) => { resolve = res; }); return { promise, resolve }; }
describe("file lock metadata publication race", () => {
  it("reclaims a live lock before its metadata write completes", async () => {
    vi.setSystemTime(new Date("2026-05-24T18:30:00.000Z"));
    const volume = Volume.fromJSON({ "/repo/workflow.md": "# workflow\n" }, "/");
    const rawFs = createFsFromVolume(volume).promises;
    const lockOpened = deferred();
    const letMetadataFinish = deferred();
    let pauseFirstMetadata = true;
    const publishingFs: FileLockFs = {
      ...(rawFs as any),
      open: async (filePath, flags) => {
        const handle = await rawFs.open(filePath, flags as any);
        return {
          close: () => handle.close(),
          writeFile: async (data, options) => {
            if (pauseFirstMetadata) {
              pauseFirstMetadata = false;
              lockOpened.resolve();
              await letMetadataFinish.promise;
            }
            await handle.writeFile(data, options as any);
          },
        };
      },
    };
    const firstPromise = acquireFileLock("/repo/workflow.md", { fs: publishingFs, staleMs: 1000 });
    await lockOpened.promise;
    const emptyWhilePublishing = await rawFs.readFile("/repo/workflow.md.lock", "utf8");
    volume.utimesSync(
      "/repo/workflow.md.lock",
      new Date("2026-05-24T18:29:00.000Z"),
      new Date("2026-05-24T18:29:00.000Z"),
    );
    const secondRelease = await acquireFileLock("/repo/workflow.md", { fs: rawFs as any, staleMs: 1000 });
    letMetadataFinish.resolve();
    const firstRelease = await firstPromise;
    console.log(JSON.stringify({ emptyWhilePublishing, firstAcquired: true, secondAcquired: true }));
    expect(emptyWhilePublishing).toBe("");
    await firstRelease();
    await secondRelease();
  });
});
EOF
cp /tmp/file-lock-inflight-metadata-publication-probe.test.ts packages/file-lock/src/__probe__.test.ts
trap 'rm -f packages/file-lock/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-file-lock-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/file-lock/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-file-lock-probe.config.mjs --reporter verbose
nl -ba packages/file-lock/src/lock.ts | sed -n '162,289p'
```

## Observed Behavior

The lock file is empty while the first owner is still publishing metadata; the second acquisition reclaims it, and both acquisition promises subsequently succeed:

```text
{"emptyWhilePublishing":"","firstAcquired":true,"secondAcquired":true}
✓ packages/file-lock/src/__probe__.test.ts > file lock metadata publication race > reclaims a live lock before its metadata write completes
```

`writeLockMetadata()` writes contents only after the exclusive `open()` has created the lock file in `packages/file-lock/src/lock.ts:200` through `packages/file-lock/src/lock.ts:214`, and `acquireFileLock()` awaits this second operation in `packages/file-lock/src/lock.ts:230` through `packages/file-lock/src/lock.ts:245`. During that gap, `shouldReclaimLock()` treats absent valid owner metadata by age in `packages/file-lock/src/lock.ts:162` through `packages/file-lock/src/lock.ts:197`, allowing removal in `packages/file-lock/src/lock.ts:252` through `packages/file-lock/src/lock.ts:276`.

## Expected Behavior

A lockfile created by an in-progress acquisition should not be eligible for stale reclamation before ownership metadata publication has completed.

## Impact

Ordinary scheduling delays between exclusive creation and metadata writing can permit overlapping pipeline, experiment, superintendent, or maestro operations to acquire the same protected document simultaneously, even without a crashed prior owner.
