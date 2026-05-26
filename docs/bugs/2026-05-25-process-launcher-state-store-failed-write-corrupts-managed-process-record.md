# Process Launcher State Store Failed Write Corrupts Managed Process Record

## Summary

The exported `@poe-code/process-launcher` state store persists each managed process by overwriting its live `state.json` record directly. If a status update partially overwrites the file and then rejects, the prior valid running-process state is destroyed and subsequent state reads fail to parse the managed record.

## Reproduction

Create a disposable Vitest probe at `packages/process-launcher/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createStateStore } from "./state/state-store.js";
import type { LauncherFileSystem, ProcessState } from "./types.js";

describe("process state interrupted overwrite", () => {
  it("leaves an existing managed-process state unreadable after write rejects", async () => {
    const statePath = "/state/api/state.json";
    const initial: ProcessState = {
      id: "api", pid: 100, status: "running", runtime: "host", restartCount: 0,
      lastExitCode: null, lastStartedAt: "2026-05-25T00:00:00.000Z", lastStoppedAt: null,
      command: "node", args: ["server.js"],
    };
    const base = createFsFromVolume(Volume.fromJSON({ [statePath]: `${JSON.stringify(initial)}\n` })).promises as unknown as LauncherFileSystem;
    const fs: LauncherFileSystem = {
      ...base,
      async writeFile(filePath, data) {
        if (filePath === statePath) {
          await base.writeFile(filePath, "{");
          throw new Error("state disk full");
        }
        await base.writeFile(filePath, data);
      },
    };
    const store = createStateStore("/state", fs);
    const updated = { ...initial, pid: null, status: "crashed" as const, lastExitCode: 1 };

    await expect(store.write("api", updated)).rejects.toThrow("state disk full");
    const raw = await base.readFile(statePath, "utf8");
    console.log(JSON.stringify({ raw }));
    expect(raw).toBe("{");
    await expect(createStateStore("/state", base).read("api")).rejects.toBeInstanceOf(SyntaxError);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/process-launcher/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"raw":"{"}
✓ packages/process-launcher/src/__probe__.test.ts > process state interrupted overwrite > leaves an existing managed-process state unreadable after write rejects
```

Remove the disposable probe after validation.

## Observed Behavior

`createStateStore().read()` loads each process state from its live JSON record at `packages/process-launcher/src/state/state-store.ts:47`. The corresponding `write()` path creates the process directory and immediately overwrites `state.json` at `packages/process-launcher/src/state/state-store.ts:65`, without staging, rename-based replacement, or recovery of the old record. In the probe, a failed status update changes the previously valid record to `"{"`, and the next public read throws `SyntaxError`.

## Expected Behavior

Managed-process state transitions should be durably atomic: if an updated state cannot be persisted completely, the previously valid state record should remain readable, or the store should retain an explicit recoverable journal/backup instead of leaving malformed JSON.

## Impact

A disk-full event or interrupted write during any supervisor status transition can corrupt the only persisted record for a managed process. Subsequent `launch` inspection, stopping, restart, or cleanup workflows cannot determine the recorded PID or status from the store, impairing safe control of a process that may still be running.
