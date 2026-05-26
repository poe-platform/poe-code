# Process launcher stop signals stale host PID from stopped state

## Summary

The exported `@poe-code/process-launcher` `stopManagedProcess()` API sends a signal to a persisted host `pid` whenever it currently resolves as running, even if the persisted process state is already explicitly `stopped`. A stale stopped record whose PID has since been reused can therefore terminate an unrelated live process.

## Reproduction

From the repository root, create and execute this disposable in-memory Vitest probe, then remove it:

```sh
cat > packages/process-launcher/src/__probe__.test.ts <<'EOF'
import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { expect, it, vi } from "vitest";
import { stopManagedProcess, type LauncherFileSystem } from "@poe-code/process-launcher";

it("signals a stale host pid even when persisted state is already stopped", async () => {
  const baseDir = "/launch";
  const rawFs = createFsFromVolume(
    Volume.fromJSON({
      [path.join(baseDir, "job", "spec.json")]: JSON.stringify({
        id: "job",
        command: "server",
        restart: "never"
      }),
      [path.join(baseDir, "job", "state.json")]: JSON.stringify({
        id: "job",
        command: "server",
        args: [],
        runtime: "host",
        pid: 4321,
        status: "stopped",
        restartCount: 0,
        lastExitCode: 0,
        lastStartedAt: null,
        lastStoppedAt: "2026-05-26T00:00:00.000Z"
      }),
      [path.join(baseDir, "job", "meta.json")]: JSON.stringify({ daemonPid: null })
    }, "/")
  ).promises;
  const fs = rawFs as unknown as LauncherFileSystem;
  const signalProcess = vi.fn();

  const result = await stopManagedProcess({
    baseDir,
    fs,
    id: "job",
    isPidRunning: pid => pid === 4321,
    signalProcess
  });

  expect(signalProcess).toHaveBeenCalledWith(4321, "SIGTERM");
  expect(result?.state?.status).toBe("stopped");
  expect(result?.state?.pid).toBe(4321);
});
EOF
npm exec -- vitest run packages/process-launcher/src/__probe__.test.ts --reporter verbose
rm packages/process-launcher/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/process-launcher/src/__probe__.test.ts > signals a stale host pid even when persisted state is already stopped
Test Files  1 passed (1)
Tests       1 passed (1)
```

## Observed Behavior

With a valid managed-process record whose state is `{ "status": "stopped", "runtime": "host", "pid": 4321 }`, and an `isPidRunning()` callback reporting that PID as live, `stopManagedProcess()` calls `signalProcess(4321, "SIGTERM")`. It then returns the same stopped state still containing PID `4321`.

`stopManagedProcess()` obtains the record at `packages/process-launcher/src/launcher.ts:119` through `packages/process-launcher/src/launcher.ts:127`, but its host-PID signaling branch at `packages/process-launcher/src/launcher.ts:137` through `packages/process-launcher/src/launcher.ts:141` checks only `record.state.runtime === "host"` and non-null PID; it does not require an active lifecycle status. As `normalizeRecord()` at `packages/process-launcher/src/launcher.ts:407` through `packages/process-launcher/src/launcher.ts:414` preserves non-active states unchanged, stale PIDs from an already stopped state reach the signal path.

## Expected Behavior

Stopping a record already marked `stopped` should not signal its stored host PID. Host child signaling should be limited to states that claim an active managed process, or otherwise require stronger identity/liveness validation before terminating any OS process.

## Impact

Persisted stopped state commonly outlives the original operating-system process. If its old PID is later reused by an unrelated service, an operator invoking stop again can terminate that unrelated process based solely on stale launcher metadata. The operation also continues to display a stopped record with the dangerous stale PID intact, allowing repeated accidental signals.
