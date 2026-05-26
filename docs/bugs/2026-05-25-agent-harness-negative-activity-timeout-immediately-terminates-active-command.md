# Agent harness negative activity timeout immediately terminates an active command

## Summary

The exported `@poe-code/agent-harness-tools` `runPoeCommand()` API accepts a negative `openSpec.execution.activityTimeoutMs` value and treats it as an enabled inactivity timer. Instead of rejecting invalid configuration, it schedules an immediate timeout, sends `SIGTERM` to a newly running command, and rejects with a nonsensical negative-duration timeout message. The same value is reachable through CLI-agent SDK spawning because `src/sdk/spawn.ts` and `@poe-code/agent-spawn` forward `activityTimeoutMs` without validation.

## Reproduction

Create a disposable Vitest probe at `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { PassThrough } from "node:stream";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { createStateManager, type RuntimeConfig, type StateFileSystem } from "@poe-code/poe-code-config";
import type { RunHandle } from "@poe-code/process-runner";
import type { ExecutionEnvFactory, OpenedEnv, OpenSpec } from "./execution-env.js";
import { runPoeCommand } from "./run-poe-command.js";

describe("negative activity timeout", () => {
  it("kills an active command immediately instead of rejecting invalid configuration", async () => {
    const state = createStateManager(
      "/home/tester",
      createFsFromVolume(new Volume()).promises as unknown as StateFileSystem
    );
    let killed = false;
    let resolveResult!: (value: { exitCode: number }) => void;
    const resultPromise = new Promise<{ exitCode: number }>((resolve) => { resolveResult = resolve; });
    const env: OpenedEnv = {
      id: "env-1",
      job: null,
      fs: createFsFromVolume(new Volume()) as never,
      async uploadWorkspace() { return { files: 0, bytes: 0, skipped: [] }; },
      async downloadWorkspace() { return { files: 0, bytes: 0, conflicts: [] }; },
      exec(): RunHandle {
        return {
          pid: 123,
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          stdin: null,
          result: resultPromise,
          kill() {
            killed = true;
            resolveResult({ exitCode: 143 });
          }
        };
      },
      shell() { throw new Error("unused"); },
      async detach() { throw new Error("unused"); },
      async close() {}
    };
    const factory: ExecutionEnvFactory = { type: "host", open: () => env };
    const openSpec: OpenSpec = {
      cwd: "/repo",
      runtime: { type: "host", build_args: {}, mounts: [] } satisfies RuntimeConfig,
      runner: { detach: false, upload_max_file_mb: 100, download_conflict: "refuse" },
      env: {},
      uploadIgnoreFiles: [],
      jobLabel: { tool: "codex", argv: ["codex"] },
      execution: {
        wrapForLogTee: false,
        stdout: "pipe",
        stderr: "pipe",
        captureOutput: true,
        activityTimeoutMs: -1
      }
    };

    await expect(runPoeCommand({ factory, openSpec, detach: false, state })).rejects.toThrow(
      "Agent spawn timed out after -0.001s of inactivity"
    );
    expect(killed).toBe(true);
  });
});
```

Run the targeted probe, then remove it:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-harness-tools/src/__probe__.test.ts
```

The observed run is:

```text
✓ packages/agent-harness-tools/src/__probe__.test.ts > negative activity timeout > kills an active command immediately instead of rejecting invalid configuration
```

## Observed Behavior

With `activityTimeoutMs: -1`, the command is successfully opened and begins execution, but `runPoeCommand()` immediately invokes `handle.kill("SIGTERM")` and rejects with `Agent spawn timed out after -0.001s of inactivity`. In `packages/agent-harness-tools/src/run-poe-command.ts`, `runSync()` forwards `execution?.activityTimeoutMs` into `createAbortSync()`, whose truthiness check accepts `-1` and passes it directly to `setTimeout(...)`; Node clamps the negative delay into immediate timer execution, after which `createActivityTimeoutError()` includes the negative value in its user-facing message. `runPoeCommand()` is exported from the package entrypoint, while the CLI-spawn path passes `options.activityTimeoutMs` into this execution spec and the SDK forwards the option unchanged.

## Expected Behavior

Public spawn and command-execution APIs should reject non-positive or non-finite activity-timeout inputs before launching or terminating any command. A negative timeout must not be interpreted as an immediate inactivity failure, and user-facing timeout errors must never report negative elapsed limits.

## Impact

SDK callers, plugin integrations, or workflow code that pass an invalid negative timeout can start an otherwise valid agent process only to have it killed immediately, losing its work and reporting a misleading timeout instead of a configuration error. Because the SDK-visible CLI-agent path forwards the same value, one bad timeout option can cause autonomous or scripted agent launches to fail deterministically while appearing to be runtime inactivity failures.
