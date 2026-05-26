# Process launcher remove state failure leaves runtime artifacts already deleted

## Summary

`removeManagedProcess()` removes external runtime artifacts before deleting its managed-process state directory. If the subsequent state deletion fails, the public removal call rejects even though the runtime-specific cleanup has already committed, leaving the retained record out of sync with the deleted runtime resources.

## Reproduction

Create the disposable probe `packages/process-launcher/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { removeManagedProcess } from "./launcher.js";
import type { LauncherFileSystem, ProcessSpec, ProcessState } from "./types.js";

describe("managed process failed removal", () => {
  it("removes runtime artifacts before a state deletion failure rejects", async () => {
    const volume = Volume.fromJSON({
      "/state/api/spec.json": JSON.stringify({ id: "api", command: "run", restart: "never", docker: { image: "node" } } satisfies ProcessSpec),
      "/state/api/state.json": JSON.stringify({ id: "api", pid: null, status: "stopped", runtime: "docker", restartCount: 0, lastExitCode: 0, lastStartedAt: null, lastStoppedAt: null, command: "run", args: [] } satisfies ProcessState),
      "/state/api/meta.json": JSON.stringify({ daemonPid: null }),
    });
    const base = createFsFromVolume(volume).promises as unknown as LauncherFileSystem;
    const fs = {
      ...base,
      rm: vi.fn(async () => { throw new Error("state deletion failed"); }),
    } as unknown as LauncherFileSystem;
    const removeRuntimeArtifacts = vi.fn().mockResolvedValue(undefined);

    await expect(removeManagedProcess({ baseDir: "/state", fs, id: "api", removeRuntimeArtifacts }))
      .rejects.toThrow("state deletion failed");
    expect(removeRuntimeArtifacts).toHaveBeenCalledOnce();
  });
});
```

Run:

```sh
npm exec -- vitest run packages/process-launcher/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/process-launcher/src/__probe__.test.ts > managed process failed removal > removes runtime artifacts before a state deletion failure rejects
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

For a stopped managed process with a persisted spec, `removeManagedProcess()` first awaits the injected `removeRuntimeArtifacts({ record })` callback at `packages/process-launcher/src/launcher.ts:284` through `packages/process-launcher/src/launcher.ts:299`, and only afterward calls `stateStore.remove(options.id)` at `packages/process-launcher/src/launcher.ts:301` through `packages/process-launcher/src/launcher.ts:302`. The state store performs directory deletion through `removeDirectory()` and its `remove()` entry point at `packages/process-launcher/src/state/state-store.ts:8` through `packages/process-launcher/src/state/state-store.ts:39` and `packages/process-launcher/src/state/state-store.ts:113` through `packages/process-launcher/src/state/state-store.ts:115`. In the probe, runtime artifact removal resolves and the state-directory delete throws `state deletion failed`, so the overall operation rejects after the external cleanup has already run.

## Expected Behavior

Removal should either complete atomically from the caller's perspective or explicitly represent partial cleanup when one component fails. If state removal cannot succeed, the implementation should not leave a normal-looking persisted process record referring to runtime artifacts that were already irreversibly removed without surfacing that partial state distinctly.

## Impact

Docker/container cleanup or other runtime-specific deletion can succeed while a transient local state-storage error makes `removeManagedProcess()` appear wholly failed. Subsequent listings or retries may retain stale process metadata for resources that no longer exist, confusing operators and automation and complicating recovery from failed removals.
