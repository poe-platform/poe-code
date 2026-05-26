# Memory lock stale reclamation deletes new successor lock

## Summary

The independent lock implementation in `@poe-code/memory` reads a lock PID, decides that the lock can be reclaimed, and then unlinks the shared `.lock` path without checking that the same lock is still present. If another memory writer acquires the lock between stale detection and deletion, the reclaimer removes that live successor lock and executes concurrently.

## Reproduction

From the repository root, run a disposable Vitest probe that inserts a valid successor lock during stale-lock unlinking:

```sh
cat > /tmp/memory-lock-stale-reclaim-race-probe.test.ts <<'EOF'
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { withLock, type LockOptions } from "./lock.js";
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
describe("memory stale lock reclaim race", () => {
  it("deletes a successor lock acquired during stale cleanup and runs concurrently", async () => {
    const root = "/repo/.poe-code/memory";
    const volume = Volume.fromJSON({
      [`${root}/INDEX.md`]: "# Index\n",
      [`${root}/.lock`]: "999\n",
    }, "/");
    const rawFs = createFsFromVolume(volume).promises as any;
    const successorEntered = deferred();
    const releaseSuccessor = deferred();
    let successorPromise: Promise<string> | undefined;
    let injected = false;
    const racingFs: NonNullable<LockOptions["fs"]> = {
      ...rawFs,
      unlink: async (filePath) => {
        if (!injected) {
          injected = true;
          await rawFs.unlink(filePath);
          successorPromise = withLock(root, async () => {
            successorEntered.resolve();
            await releaseSuccessor.promise;
            return "successor";
          }, { fs: rawFs, pid: 222 });
          await successorEntered.promise;
        }
        await rawFs.unlink(filePath);
      },
    };
    let contenderEntered = false;
    const contenderPromise = withLock(root, async () => {
      contenderEntered = true;
      return "contender";
    }, { fs: racingFs, pid: 333, isPidRunning: () => false });
    await contenderPromise;
    let lockExistsWhileSuccessorRunning = true;
    try { await rawFs.readFile(`${root}/.lock`, "utf8"); } catch { lockExistsWhileSuccessorRunning = false; }
    console.log(JSON.stringify({ contenderEntered, lockExistsWhileSuccessorRunning }));
    expect(contenderEntered).toBe(true);
    expect(lockExistsWhileSuccessorRunning).toBe(false);
    releaseSuccessor.resolve();
    await successorPromise;
  });
});
EOF
cp /tmp/memory-lock-stale-reclaim-race-probe.test.ts packages/memory/src/__probe__.test.ts
trap 'rm -f packages/memory/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-memory-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/memory/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-memory-probe.config.mjs --reporter verbose
nl -ba packages/memory/src/lock.ts | sed -n '56,147p'
```

## Observed Behavior

The contender enters its protected callback while the successor callback is still active, and no `.lock` file remains to protect the successor:

```text
{"contenderEntered":true,"lockExistsWhileSuccessorRunning":false}
✓ packages/memory/src/__probe__.test.ts > memory stale lock reclaim race > deletes a successor lock acquired during stale cleanup and runs concurrently
```

`withLock()` reads and evaluates the existing lock PID in `packages/memory/src/lock.ts:88` through `packages/memory/src/lock.ts:98` and `packages/memory/src/lock.ts:128` through `packages/memory/src/lock.ts:135`. It then deletes the shared path using `removeLockFile()` in `packages/memory/src/lock.ts:78` through `packages/memory/src/lock.ts:86`, with no owner token or identity check tying that unlink to the stale lock it examined.

## Expected Behavior

Stale-lock reclamation should delete only the stale lock instance that was evaluated and must preserve a successor lock acquired before deletion occurs.

## Impact

Concurrent memory writes can proceed without mutual exclusion during stale-lock recovery, allowing `writePage()`, `appendToPage()`, `clearMemory()`, or reconciliation updates to interleave and corrupt generated memory pages, indexes, or logs.
