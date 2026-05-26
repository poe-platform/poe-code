# Process launcher NaN startup timeout spawns daemon before immediate failure

## Summary

The exported `@poe-code/process-launcher` `startManagedProcess()` API accepts `startupTimeoutMs: Number.NaN`. It writes a new managed-process record and invokes the daemon launcher before its readiness wait immediately fails, leaving persisted `restarting` state and a recorded daemon PID behind for a request that should have been rejected before startup side effects.

## Reproduction

Create a disposable Vitest probe at `packages/process-launcher/src/__probe__.test.ts`:

```ts
import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { startManagedProcess } from "./launcher.js";
import type { LauncherFileSystem, ProcessSpec } from "./types.js";

describe("process launcher NaN startup timeout", () => {
  it("spawns a daemon and persists restarting state before timing out", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({}, "/")).promises as unknown as LauncherFileSystem;
    const baseDir = "/state/launch";
    const spec: ProcessSpec = { id: "api", command: "npm", restart: "never" };
    const spawnDaemon = vi.fn(async () => 321);

    await expect(
      startManagedProcess({
        baseDir,
        fs,
        spec,
        startupTimeoutMs: Number.NaN,
        pollIntervalMs: 1,
        spawnDaemon
      })
    ).rejects.toThrow('Timed out waiting for managed process "api".');

    expect(spawnDaemon).toHaveBeenCalledWith("api");
    await expect(fs.readFile(path.join(baseDir, "api", "state.json"), "utf8")).resolves.toContain(
      '"status": "restarting"'
    );
    await expect(fs.readFile(path.join(baseDir, "api", "meta.json"), "utf8")).resolves.toContain(
      '"daemonPid": 321'
    );
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/process-launcher/src/__probe__.test.ts --reporter verbose
rm -f packages/process-launcher/src/__probe__.test.ts
```

## Observed Behavior

The start request rejects as timed out while retaining evidence that daemon startup already occurred:

```text
✓ packages/process-launcher/src/__probe__.test.ts > process launcher NaN startup timeout > spawns a daemon and persists restarting state before timing out
```

The passing assertions observe one daemon launch plus persisted bootstrap metadata equivalent to:

```json
{"spawnDaemon":["api"],"state":{"status":"restarting"},"meta":{"daemonPid":321}}
```

`startManagedProcess()` in `packages/process-launcher/src/launcher.ts` writes the normalized spec, bootstrap state, and initial metadata, invokes `options.spawnDaemon(spec.id)`, and persists the returned daemon PID before calling `waitForRecord()`. That wait computes `deadline = Date.now() + (options.timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS)`. With `Number.NaN`, its `while (Date.now() <= deadline)` condition is false immediately, so it throws the timeout error without inspecting or cleaning up the just-started managed process.

## Expected Behavior

Managed-process startup should validate that `startupTimeoutMs`, when supplied, is a finite non-negative duration before persisting records or spawning a daemon. If startup fails after daemon creation, it should terminate or otherwise reconcile the launched process and its persisted state before rejecting.

## Impact

Malformed startup configuration can cause a caller to receive a failure while a newly launched daemon remains recorded as restarting and may continue running independently. Repeated invalid requests can create orphaned or confusing managed-process state, launch unintended background work, and require manual cleanup even though startup never successfully returned.
