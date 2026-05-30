---
name: "runPoeCommand close failure leaves a successful job recorded as running"
---

# runPoeCommand close failure leaves a successful job recorded as running

## Summary

The exported `runPoeCommand()` synchronous execution path waits for a successful command result and downloads its workspace, then closes the execution environment inside `runSync()` before updating persisted job state to `exited`. If `env.close()` rejects after the command completed, `runPoeCommand()` rejects and leaves the already successful job recorded as `running`.

## Reproduction

1. Add this disposable probe as `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { createStateManager, type StateFileSystem } from "@poe-code/poe-code-config";
import type { RunHandle } from "@poe-code/process-runner";
import type { ExecutionEnvFactory, OpenedEnv, OpenSpec } from "./execution-env.js";
import { runPoeCommand } from "./run-poe-command.js";

describe("runPoeCommand close failure probe", () => {
  it("rejects after successful execution while leaving the job recorded as running", async () => {
    const stateFs = createFsFromVolume(new Volume()).promises as unknown as StateFileSystem;
    const state = createStateManager("/home/test", stateFs);
    const env: OpenedEnv = {
      id: "env-1",
      job: null,
      async uploadWorkspace() {
        return { files: 0, bytes: 0, skipped: [] };
      },
      async downloadWorkspace() {
        return { files: 1, bytes: 10, conflicts: [] };
      },
      exec(): RunHandle {
        return {
          pid: 123,
          stdout: null,
          stderr: null,
          stdin: null,
          result: Promise.resolve({ exitCode: 0 }),
          kill() {}
        };
      },
      async detach() {
        throw new Error("unused");
      },
      shell() {
        throw new Error("unused");
      },
      async close() {
        throw new Error("environment close denied");
      }
    };
    const factory: ExecutionEnvFactory = {
      type: "host",
      async open() {
        return env;
      },
      async attach() {
        return env;
      }
    };
    const openSpec: OpenSpec = {
      cwd: "/repo",
      runtime: { type: "host", build_args: {}, mounts: [] },
      runner: { detach: false, upload_max_file_mb: 100, download_conflict: "refuse" },
      env: {},
      uploadIgnoreFiles: [],
      jobLabel: { tool: "poe-code", argv: ["poe-code", "--help"] },
      execution: { wrapForLogTee: false }
    };

    await expect(runPoeCommand({ factory, openSpec, detach: false, state })).rejects.toThrow(
      "environment close denied"
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    await expect(state.jobs.list()).resolves.toEqual([
      expect.objectContaining({ status: "running", env_id: "env-1" })
    ]);
  });
});
```

2. Run the focused probe:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
```

3. Remove the disposable probe after validation.

The probe passes on the current implementation:

```text
✓ packages/agent-harness-tools/src/__probe__.test.ts > runPoeCommand close failure probe > rejects after successful execution while leaving the job recorded as running
```

## Observed Behavior

The command handle resolves with exit code `0` and the environment successfully returns a downloaded workspace result. `runSync()` then invokes `env.close()` before the outer function updates the job record to terminal status. When close rejects, the exported call rejects with `environment close denied`, and the persisted job remains `status: "running"` with its environment ID even though command execution already succeeded.

## Expected Behavior

Once synchronous command execution has completed and its workspace has been downloaded, terminal job state should be persisted regardless of whether later environment disposal succeeds. A close failure should be surfaced separately from the command result or recorded as cleanup trouble without leaving the completed job falsely running.

## Impact

Runtime close failures cause successfully completed jobs to remain selectable and displayed as actively running while callers receive a failed operation. Status commands, attachment workflows, and automated recovery can treat dead environments as live work, while users may rerun commands whose outputs and workspace downloads already completed successfully.
