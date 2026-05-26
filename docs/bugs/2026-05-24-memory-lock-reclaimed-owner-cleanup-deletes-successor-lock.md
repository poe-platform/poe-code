# Memory lock reclaimed owner cleanup deletes successor lock

## Summary

`@poe-code/memory` removes `.lock` in the `finally` block of every holder without verifying that the lock still belongs to that holder. If another operation reclaims the lock while an earlier callback is still executing, the earlier callback's later cleanup removes the newer owner's active lock.

## Reproduction

From the repository root, run a disposable Vitest probe that allows a second holder to reclaim the first lock and then completes the first callback while the second is still running:

```sh
cat > /tmp/memory-lock-old-owner-release-probe.test.ts <<'EOF'
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { withLock } from "./lock.js";
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
describe("memory reclaimed owner cleanup", () => {
  it("lets an older running callback delete the replacement owner's lock", async () => {
    const root = "/repo/.poe-code/memory";
    const rawFs = createFsFromVolume(Volume.fromJSON({ [`${root}/INDEX.md`]: "# Index\n" }, "/")).promises as any;
    const firstEntered = deferred();
    const finishFirst = deferred();
    const secondEntered = deferred();
    const finishSecond = deferred();
    const first = withLock(root, async () => {
      firstEntered.resolve();
      await finishFirst.promise;
      return "first";
    }, { fs: rawFs, pid: 111 });
    await firstEntered.promise;
    const second = withLock(root, async () => {
      secondEntered.resolve();
      await finishSecond.promise;
      return "second";
    }, { fs: rawFs, pid: 222, isPidRunning: () => false });
    await secondEntered.promise;
    finishFirst.resolve();
    await first;
    let secondLockExists = true;
    try { await rawFs.readFile(`${root}/.lock`, "utf8"); } catch { secondLockExists = false; }
    console.log(JSON.stringify({ secondRunning: true, secondLockExists }));
    expect(secondLockExists).toBe(false);
    finishSecond.resolve();
    await second;
  });
});
EOF
cp /tmp/memory-lock-old-owner-release-probe.test.ts packages/memory/src/__probe__.test.ts
trap 'rm -f packages/memory/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-memory-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/memory/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-memory-probe.config.mjs --reporter verbose
nl -ba packages/memory/src/lock.ts | sed -n '78,147p'
```

## Observed Behavior

While the second protected callback is still running, completing the first callback removes the second holder's active lock:

```text
{"secondRunning":true,"secondLockExists":false}
✓ packages/memory/src/__probe__.test.ts > memory reclaimed owner cleanup > lets an older running callback delete the replacement owner's lock
```

Every successful acquisition enters the callback and unconditionally invokes `removeLockFile(fs, lockPath)` from its `finally` block in `packages/memory/src/lock.ts:113` through `packages/memory/src/lock.ts:121`. Reclamation can replace a prior holder's lock in `packages/memory/src/lock.ts:128` through `packages/memory/src/lock.ts:135`, but cleanup does not compare an ownership token or current PID content before deletion.

## Expected Behavior

The cleanup for one memory-lock holder should delete the lock only when the on-disk lock still represents that holder, leaving any replacement owner's lock intact.

## Impact

Once a memory lock is reclaimed, delayed completion by the original operation can expose the successor to a third concurrent writer. This undermines serialization for memory edits and can cause lost updates or inconsistent `INDEX.md` and `LOG.md` output.
