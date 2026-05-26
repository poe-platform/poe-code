# File lock reclaimed owner release deletes successor lock

## Summary

The release callback returned by `acquireFileLock()` removes the current lock path without confirming that it still contains the releasing owner's lock. If a lock is reclaimed as stale and acquired by a successor while the original holder is still running, the original holder can later call its release callback and delete the successor's active lock.

## Reproduction

From the repository root, run a disposable Vitest probe that simulates a stale-reclaimed lock, acquires a successor lock, and then invokes the old owner's release callback:

```sh
cat > /tmp/file-lock-stale-successor-release-probe.test.ts <<'EOF'
import os from "node:os";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { acquireFileLock } from "./lock.js";

describe("reclaimed owner release", () => {
  it("lets an old owner delete the replacement owner's lock", async () => {
    vi.setSystemTime(new Date("2026-05-24T18:30:00.000Z"));
    const volume = Volume.fromJSON({ "/repo/workflow.md": "# workflow\n" }, "/");
    const fs = createFsFromVolume(volume).promises as any;
    const releaseFirst = await acquireFileLock("/repo/workflow.md", { fs, staleMs: 1000 });
    await fs.writeFile(
      "/repo/workflow.md.lock",
      JSON.stringify({ pid: 99999, host: `${os.hostname()}-remote`, acquiredAt: "2026-05-24T18:00:00.000Z" }),
      "utf8",
    );
    volume.utimesSync(
      "/repo/workflow.md.lock",
      new Date("2026-05-24T18:29:00.000Z"),
      new Date("2026-05-24T18:29:00.000Z"),
    );
    const releaseSecond = await acquireFileLock("/repo/workflow.md", { fs, staleMs: 1000 });
    const successorBefore = await fs.readFile("/repo/workflow.md.lock", "utf8");
    await releaseFirst();
    let successorStillExists = true;
    try { await fs.readFile("/repo/workflow.md.lock", "utf8"); } catch { successorStillExists = false; }
    console.log(JSON.stringify({ successorAcquired: successorBefore.includes("pid"), successorStillExists }));
    expect(successorStillExists).toBe(false);
    await releaseSecond();
  });
});
EOF
cp /tmp/file-lock-stale-successor-release-probe.test.ts packages/file-lock/src/__probe__.test.ts
trap 'rm -f packages/file-lock/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-file-lock-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/file-lock/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-file-lock-probe.config.mjs --reporter verbose
nl -ba packages/file-lock/src/lock.ts | sed -n '181,279p'
```

## Observed Behavior

After the successor acquires the lock, invoking the first owner's release callback deletes the successor's lock file:

```text
{"successorAcquired":true,"successorStillExists":false}
✓ packages/file-lock/src/__probe__.test.ts > reclaimed owner release > lets an old owner delete the replacement owner's lock
```

Stale-lock recovery removes an existing lock and continues to acquisition in `packages/file-lock/src/lock.ts:181` through `packages/file-lock/src/lock.ts:197` and `packages/file-lock/src/lock.ts:252` through `packages/file-lock/src/lock.ts:276`. However, each returned release callback only tracks a local `released` boolean and unconditionally unlinks the shared path in `packages/file-lock/src/lock.ts:236` through `packages/file-lock/src/lock.ts:245`; it does not verify stored ownership metadata before deletion.

## Expected Behavior

Each acquired lock should carry a unique ownership token, and release should remove the lock file only if the on-disk lock still belongs to that releasing owner.

## Impact

After any stale-lock reclaim, a delayed cleanup from the prior holder can erase a live successor's exclusion protection. A third process can then acquire the same workflow lock while the successor is actively operating, allowing overlapping document mutations and corrupted orchestration state.
