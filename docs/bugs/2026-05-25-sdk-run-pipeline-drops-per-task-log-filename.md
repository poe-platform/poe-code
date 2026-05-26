# SDK `runPipeline` Drops Per-Task Log Filename

## Summary

The public SDK `runPipeline()` adapter forwards a pipeline task's generated `logDir` to `spawn.autonomous()`, but discards its generated `logFileName`. Pipeline executions through the SDK therefore cannot retain the core runner's deterministic per-task log filename routing.

## Reproduction

Create a disposable Vitest probe at `src/sdk/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { PipelineRunOptions } from "@poe-code/pipeline";

const workspaceRunPipelineMock = vi.hoisted(() => vi.fn());
const spawnAutonomousMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/pipeline")>();
  return { ...actual, runPipeline: workspaceRunPipelineMock };
});

vi.mock("./spawn.js", () => ({
  spawn: { autonomous: spawnAutonomousMock }
}));

import { runPipeline } from "./pipeline.js";

describe("SDK pipeline per-task log routing", () => {
  it("drops a log filename supplied by the pipeline core", async () => {
    workspaceRunPipelineMock.mockImplementationOnce(async (options: PipelineRunOptions) => {
      await options.runAgent?.({
        agent: "codex",
        prompt: "Implement task",
        mode: "yolo",
        cwd: "/repo",
        logDir: "/repo/.poe-code/logs/pipeline/plan",
        logFileName: "20260525-013000-000-task-implement.jsonl"
      });
      return {
        stopReason: "completed",
        planPath: "docs/plans/plan.md",
        runsCompleted: 1,
        totalDurationMs: 1,
        metrics: {
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCachedTokens: 0,
          tasksCompleted: 1,
          tasksFailed: 0,
          stepsCompleted: 1
        }
      };
    });
    spawnAutonomousMock.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    await runPipeline({ agent: "codex", cwd: "/repo", homeDir: "/home/test" });

    expect(spawnAutonomousMock).toHaveBeenCalledWith("codex", {
      prompt: "Implement task",
      cwd: "/repo",
      logDir: "/repo/.poe-code/logs/pipeline/plan",
      model: undefined,
      mode: "yolo"
    });
  });
});
```

Run:

```sh
npm exec -- vitest run src/sdk/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ src/sdk/__probe__.test.ts > SDK pipeline per-task log routing > drops a log filename supplied by the pipeline core
```

## Observed Behavior

The pipeline core includes `logDir` and `logFileName` on `AgentRunInput` in `packages/pipeline/src/types.ts:83` through `packages/pipeline/src/types.ts:94` and generates both for setup, teardown, and task agent invocations in `packages/pipeline/src/run/pipeline.ts:283` through `packages/pipeline/src/run/pipeline.ts:300` and `packages/pipeline/src/run/pipeline.ts:494` through `packages/pipeline/src/run/pipeline.ts:505`. The default SDK runner in `src/sdk/pipeline.ts:100` through `src/sdk/pipeline.ts:114` passes `input.logDir` but does not include `input.logFileName` when calling `sdkSpawn.autonomous()`. The reproduction observes the supplied directory without its supplied per-task filename.

## Expected Behavior

`runPipeline()` should forward both `input.logDir` and `input.logFileName` into `spawn.autonomous()` so SDK-run pipeline tasks retain the core's generated task-specific log locations.

## Impact

SDK consumers lose deterministic task-to-log-file mapping even though pipeline core generated it. Logs may be assigned generic/default filenames, complicating trace correlation, per-step troubleshooting, observability tooling, and automated retrieval of task execution records.
