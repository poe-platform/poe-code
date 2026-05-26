# Process launcher string daemon metadata is forwarded to signal handler

## Summary

The exported `@poe-code/process-launcher` `stopManagedProcess()` API reads `daemonPid` from persisted `meta.json` without validating its type. A syntactically valid metadata document containing a string daemon identifier reaches the process-signaling callback as though it were a numeric PID.

## Reproduction

Create a disposable Vitest probe at `packages/process-launcher/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { stopManagedProcess } from "./launcher.js";
import type { LauncherFileSystem } from "./types.js";

describe("process launcher string daemon metadata", () => {
  it("signals a nonnumeric daemon id loaded from meta.json", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/launch/api/spec.json": JSON.stringify({ id: "api", command: "npm", restart: "never" }),
        "/launch/api/state.json": JSON.stringify({
          id: "api",
          pid: null,
          status: "running",
          runtime: "host",
          restartCount: 0,
          lastExitCode: null,
          lastStartedAt: null,
          lastStoppedAt: null,
          command: "npm",
          args: []
        }),
        "/launch/api/meta.json": JSON.stringify({ daemonPid: "not-a-pid" })
      }, "/")
    ).promises as unknown as LauncherFileSystem;
    let running = true;
    const signalProcess = vi.fn(() => {
      running = false;
    });

    await stopManagedProcess({
      baseDir: "/launch",
      id: "api",
      fs,
      pollIntervalMs: 1,
      isPidRunning: () => running,
      signalProcess
    });

    expect(signalProcess).toHaveBeenCalledWith("not-a-pid", "SIGTERM");
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/process-launcher/src/__probe__.test.ts --reporter verbose
rm -f packages/process-launcher/src/__probe__.test.ts
```

## Observed Behavior

Stopping a managed process with malformed persisted metadata invokes the configured termination callback using the string from disk:

```text
✓ packages/process-launcher/src/__probe__.test.ts > process launcher string daemon metadata > signals a nonnumeric daemon id loaded from meta.json
```

The observed call is:

```json
{"pid":"not-a-pid","signal":"SIGTERM"}
```

`readMeta()` in `packages/process-launcher/src/launcher.ts` delegates to `readJsonFile<ManagedProcessMeta>()`, which parses JSON and casts it without runtime field validation. `readManagedProcess()` copies `meta?.daemonPid` into its record, `normalizeRecord()` supplies that value to `isProcessRunning()`, and `stopManagedProcess()` subsequently forwards the same value to `signalProcess()` when it is treated as live. The public callback type promises a numeric PID, but persisted string data reaches it unchanged.

## Expected Behavior

Launcher metadata should be validated when read from disk. A `daemonPid` value must be either `null` or a valid numeric process identifier; malformed metadata should produce an explicit corruption error before any liveness check or signal action is attempted.

## Impact

Corrupted or tampered managed-process metadata can direct stop operations at invalid process identifiers while the API reports ordinary lifecycle handling. With the default process signaling path this can cause platform-dependent errors or unintended targeting behavior; with integrations or mocks it can trigger arbitrary control logic from untrusted persisted values instead of safely refusing malformed state.
