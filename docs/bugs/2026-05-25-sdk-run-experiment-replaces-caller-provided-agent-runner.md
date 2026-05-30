---
name: "SDK `runExperiment` Replaces Caller-Provided Agent Runner"
---

# SDK `runExperiment` Replaces Caller-Provided Agent Runner

## Summary

The public SDK `runExperiment()` API accepts `ExperimentRunOptions.runAgent`, but unconditionally replaces it with its own `spawn.autonomous()` adapter. Callers cannot supply a custom experiment agent executor through the documented/exported options contract, unlike the corresponding SDK Ralph entry point.

## Reproduction

Create a disposable Vitest probe at `src/sdk/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ExperimentRunOptions } from "@poe-code/experiment-loop";

const runExperimentLoopMock = vi.hoisted(() => vi.fn());
const spawnAutonomousMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/experiment-loop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/experiment-loop")>();
  return { ...actual, runExperimentLoop: runExperimentLoopMock };
});

vi.mock("./spawn.js", () => ({
  spawn: Object.assign(vi.fn(), { autonomous: spawnAutonomousMock })
}));

import { runExperiment } from "./experiment.js";

describe("SDK experiment custom agent runner", () => {
  it("replaces a caller-provided runAgent with autonomous spawn", async () => {
    const callerRunAgent = vi.fn().mockResolvedValue({ stdout: "custom", stderr: "", exitCode: 0 });

    runExperimentLoopMock.mockImplementationOnce(async (options: ExperimentRunOptions) => {
      expect(options.runAgent).not.toBe(callerRunAgent);
      await options.runAgent?.({ agent: "codex", prompt: "try", cwd: "/repo" });
      return {
        stopReason: "max_experiments",
        docPath: "/repo/plan.md",
        experimentsCompleted: 1,
        experimentsKept: 0,
        totalDurationMs: 1
      };
    });
    spawnAutonomousMock.mockResolvedValue({ stdout: "sdk", stderr: "", exitCode: 0 });

    await runExperiment({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "/repo/plan.md",
      runAgent: callerRunAgent
    });

    expect(callerRunAgent).not.toHaveBeenCalled();
    expect(spawnAutonomousMock).toHaveBeenCalledTimes(1);
  });
});
```

Run:

```sh
npm exec -- vitest run src/sdk/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ src/sdk/__probe__.test.ts > SDK experiment custom agent runner > replaces a caller-provided runAgent with autonomous spawn
```

## Observed Behavior

`ExperimentRunOptions` exposes an optional `runAgent` callback in `packages/experiment-loop/src/types.ts:75`. `src/sdk/experiment.ts:69` through `src/sdk/experiment.ts:87` spreads caller options into `runWorkspaceExperimentLoop()` and then always sets a new `runAgent`, overwriting any supplied callback. In the reproduction, the underlying loop receives a different function, invoking that function calls `spawn.autonomous()`, and the caller's `runAgent` is never called.

## Expected Behavior

When `runExperiment()` receives `options.runAgent`, it should pass that callback through unchanged and only construct its default autonomous adapter when no runner was supplied. This preserves dependency injection, testability, custom execution environments, and parity with `runRalph()`, which explicitly preserves a caller-provided `runAgent`.

## Impact

SDK consumers cannot use custom sandboxing, observability, mocks, authentication handling, retries, or alternate agent transports for experiments despite the public option type advertising that capability. Code that passes a runner can silently execute real autonomous spawns instead of its intended controlled implementation.
