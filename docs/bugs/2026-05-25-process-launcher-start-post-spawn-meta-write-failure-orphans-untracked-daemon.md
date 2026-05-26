# `startManagedProcess()` can orphan a spawned daemon when PID persistence fails

## Summary

The exported `@poe-code/process-launcher` `startManagedProcess()` API calls `spawnDaemon()` before it persists the returned daemon PID to `meta.json`. If that second metadata write fails, the start request rejects after the daemon has already been launched, while the persisted record still stores `daemonPid: null` and a bootstrap `restarting` state.

## Reproduction

From the repository root, add a disposable probe at `packages/process-launcher/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { startManagedProcess, type LauncherFileSystem } from "@poe-code/process-launcher";

describe("process launcher post-spawn metadata failure repro", () => {
  it("rejects after launching a daemon whose pid was never persisted", async () => {
    const rawFs = createFsFromVolume(new Volume()).promises as unknown as LauncherFileSystem;
    let metaWrites = 0;
    const fs: LauncherFileSystem = {
      ...rawFs,
      writeFile: async (targetPath, content) => {
        if (targetPath.endsWith("/meta.json")) {
          metaWrites += 1;
          if (metaWrites === 2) {
            throw new Error("failed to record spawned daemon pid");
          }
        }
        await rawFs.writeFile(targetPath, content);
      }
    };
    const spawnDaemon = vi.fn(async () => 4321);

    await expect(
      startManagedProcess({
        baseDir: "/launch",
        fs,
        spec: { id: "api", command: "npm", restart: "never" },
        spawnDaemon
      })
    ).rejects.toThrow("failed to record spawned daemon pid");

    expect(spawnDaemon).toHaveBeenCalledOnce();
    expect(await rawFs.readFile("/launch/api/state.json", "utf8")).toContain('"status": "restarting"');
    expect(await rawFs.readFile("/launch/api/meta.json", "utf8")).toContain('"daemonPid": null');
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/process-launcher/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/process-launcher/src/__probe__.test.ts > process launcher post-spawn metadata failure repro > rejects after launching a daemon whose pid was never persisted
```

Remove the disposable probe after validation.

## Observed Behavior

`startManagedProcess()` writes initial `spec.json`, `state.json`, and `meta.json` files, successfully invokes `spawnDaemon()` and receives PID `4321`, then rejects when persisting that PID fails. After rejection, `state.json` remains in its bootstrap `restarting` state and `meta.json` still contains `"daemonPid": null`, even though a daemon has already been started.

## Expected Behavior

Starting a managed process should not leave a successfully spawned daemon untracked when persistence fails. The operation should either make daemon startup and PID persistence atomic from the caller's perspective, or terminate/clean up the newly spawned daemon before rejecting.

## Impact

A transient metadata write failure can turn a reported failed start into a live orphan daemon that later stop or remove operations cannot target through the stored daemon PID. This can leak background processes, leave misleading launcher state on disk, and allow a retry to start an additional instance because the original daemon is no longer tracked.
