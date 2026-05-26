# File lock release unlink failure cannot be retried

## Summary

The release callback returned by `acquireFileLock()` marks itself released before it attempts to remove the lock file. If unlinking fails with a non-retried filesystem error such as `EACCES`, a later retry of the same release callback returns immediately and leaves the owned lock file permanently behind until stale recovery.

## Reproduction

From the repository root, run a disposable Vitest probe whose first release unlink fails once with `EACCES`, then calls the release function again after the filesystem would permit cleanup:

```sh
cat > /tmp/file-lock-release-failure-no-retry-probe.test.ts <<'EOF'
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { acquireFileLock, type FileLockFs } from "./lock.js";
describe("release retry after failure", () => {
  it("marks release complete before unlink succeeds and cannot retry cleanup", async () => {
    const rawFs = createFsFromVolume(Volume.fromJSON({ "/repo/workflow.md": "# workflow\n" }, "/")).promises;
    let failFirstUnlink = true;
    const fs: FileLockFs = {
      ...(rawFs as any),
      unlink: async (filePath) => {
        if (failFirstUnlink) {
          failFirstUnlink = false;
          const error = Object.assign(new Error("permission denied"), { code: "EACCES" });
          throw error;
        }
        await rawFs.unlink(filePath);
      },
    };
    const release = await acquireFileLock("/repo/workflow.md", { fs });
    let firstError = "";
    try { await release(); } catch (error) { firstError = (error as any).code; }
    await release();
    const remaining = await rawFs.readFile("/repo/workflow.md.lock", "utf8");
    console.log(JSON.stringify({ firstError, secondReleaseReturned: true, lockStillExists: remaining.includes("pid") }));
    expect(firstError).toBe("EACCES");
    expect(remaining).toContain("pid");
  });
});
EOF
cp /tmp/file-lock-release-failure-no-retry-probe.test.ts packages/file-lock/src/__probe__.test.ts
trap 'rm -f packages/file-lock/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-file-lock-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/file-lock/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-file-lock-probe.config.mjs --reporter verbose
nl -ba packages/file-lock/src/lock.ts | sed -n '111,133p;230,245p'
```

## Observed Behavior

The first cleanup attempt rejects, the second release call returns without attempting the now-possible unlink, and the owned lock file remains on disk:

```text
{"firstError":"EACCES","secondReleaseReturned":true,"lockStillExists":true}
✓ packages/file-lock/src/__probe__.test.ts > release retry after failure > marks release complete before unlink succeeds and cannot retry cleanup
```

`removeLockFile()` propagates unhandled unlink failures in `packages/file-lock/src/lock.ts:111` through `packages/file-lock/src/lock.ts:133`. The returned release closure assigns `released = true` before awaiting removal in `packages/file-lock/src/lock.ts:236` through `packages/file-lock/src/lock.ts:245`, so a failed cleanup cannot subsequently be retried through the API.

## Expected Behavior

A release callback should become idempotently complete only after its owned lock has actually been removed, allowing callers or `finally` recovery paths to retry transient cleanup failures safely.

## Impact

A transient permission, filesystem, or antivirus interference during release can strand workflow lock files even after the condition clears. Subsequent operations can block or time out while the original holder has no usable cleanup retry path.
