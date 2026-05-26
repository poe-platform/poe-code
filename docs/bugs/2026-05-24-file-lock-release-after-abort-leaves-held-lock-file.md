# File lock release after abort leaves held lock file

## Summary

`acquireFileLock()` uses its acquisition `AbortSignal` again when executing the returned release callback. If that signal is aborted after the lock has already been acquired, the release callback throws before unlinking its own lock file, leaving the resource locked until stale-lock recovery later removes it.

## Reproduction

From the repository root, run a disposable Vitest probe that acquires a lock, aborts the signal, and then tries to release the acquired lock:

```sh
cat > /tmp/file-lock-aborted-release-probe.test.ts <<'EOF'
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { acquireFileLock } from "./lock.js";

describe("release after abort", () => {
  it("refuses to remove its held lock after the acquisition signal aborts", async () => {
    const rawFs = createFsFromVolume(Volume.fromJSON({ "/repo/workflow.md": "# workflow\n" }, "/")).promises;
    const fs = rawFs as any;
    const controller = new AbortController();
    const release = await acquireFileLock("/repo/workflow.md", { fs, signal: controller.signal });
    controller.abort();
    let releaseError: string | undefined;
    try { await release(); } catch (error) { releaseError = (error as Error).name; }
    const remaining = await rawFs.readFile("/repo/workflow.md.lock", "utf8");
    console.log(JSON.stringify({ releaseError, lockStillExists: remaining.includes("pid") }));
    expect(releaseError).toBe("AbortError");
    expect(remaining).toContain("pid");
  });
});
EOF
cp /tmp/file-lock-aborted-release-probe.test.ts packages/file-lock/src/__probe__.test.ts
trap 'rm -f packages/file-lock/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-file-lock-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/file-lock/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-file-lock-probe.config.mjs --reporter verbose
nl -ba packages/file-lock/src/lock.ts | sed -n '105,245p'
```

## Observed Behavior

The release function rejects with `AbortError` and the acquired lock file remains present:

```text
{"releaseError":"AbortError","lockStillExists":true}
✓ packages/file-lock/src/__probe__.test.ts > release after abort > refuses to remove its held lock after the acquisition signal aborts
```

`removeLockFile()` invokes `throwIfAborted(signal)` before attempting removal in `packages/file-lock/src/lock.ts:111` through `packages/file-lock/src/lock.ts:133`. `acquireFileLock()` captures the caller's acquisition signal and passes that same signal into release cleanup in `packages/file-lock/src/lock.ts:216` through `packages/file-lock/src/lock.ts:245`, even though releasing an acquired lock is required cleanup rather than cancellable waiting.

## Expected Behavior

Once a lock is acquired, invoking its release callback should attempt to remove the owned lock file regardless of whether the earlier acquisition/wait signal has since been aborted.

## Impact

Any abort-driven workflow that acquires a file lock and then aborts before its `finally` cleanup runs can leave a stale lock behind. Subsequent pipeline, experiment, superintendent, or maestro operations may be delayed or fail with lock contention even though the owning operation has already stopped.
