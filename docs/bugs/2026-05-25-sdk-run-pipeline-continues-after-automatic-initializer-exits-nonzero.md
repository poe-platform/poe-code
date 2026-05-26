# SDK `runPipeline` Continues After Automatic Initializer Exits Nonzero

## Summary

When the public SDK `runPipeline()` detects a source document that needs pipeline initialization, it runs an initializer agent but ignores that agent's nonzero exit code. If initialization fails without throwing, the SDK still invokes the workspace pipeline on the unchanged uninitialized document and can resolve with a normal pipeline result.

## Reproduction

Create a disposable Vitest probe at `src/sdk/__probe__.test.ts`:

```ts
import { fs, vol } from "memfs";
import { describe, expect, it, vi } from "vitest";
import type { PipelineRunResult } from "@poe-code/pipeline";

const workspaceRunPipelineMock = vi.hoisted(() => vi.fn());

vi.mock("./spawn.js", () => ({
  spawn: { autonomous: vi.fn() }
}));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

vi.mock("@poe-code/pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/pipeline")>();
  return { ...actual, runPipeline: workspaceRunPipelineMock };
});

import { runPipeline } from "./pipeline.js";

describe("SDK automatic pipeline initialization failure", () => {
  it("continues to the workspace pipeline after the initializer exits nonzero", async () => {
    vol.reset();
    vol.fromJSON({ "/repo/feature.md": "# Feature\nShip it.\n" }, "/");
    const result: PipelineRunResult = {
      stopReason: "nothing_to_run",
      planPath: "feature.md",
      runsCompleted: 0,
      totalDurationMs: 1,
      metrics: {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCachedTokens: 0,
        tasksCompleted: 0,
        tasksFailed: 0,
        stepsCompleted: 0
      }
    };
    workspaceRunPipelineMock.mockResolvedValueOnce(result);
    const runAgent = vi.fn().mockResolvedValue({ stdout: "", stderr: "init failed", exitCode: 1 });

    await expect(runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "feature.md",
      runAgent
    })).resolves.toEqual(result);

    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(workspaceRunPipelineMock).toHaveBeenCalledTimes(1);
    await expect(fs.promises.readFile("/repo/feature.md", "utf8")).resolves.toBe("# Feature\nShip it.\n");
  });
});
```

Run:

```sh
npm exec -- vitest run src/sdk/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ src/sdk/__probe__.test.ts > SDK automatic pipeline initialization failure > continues to the workspace pipeline after the initializer exits nonzero
```

## Observed Behavior

`runPipeline()` decides whether automatic initialization is needed in `src/sdk/pipeline.ts:115` through `src/sdk/pipeline.ts:124`, then invokes `userRunAgent()` inside `runWithRetry()` at `src/sdk/pipeline.ts:125` through `src/sdk/pipeline.ts:138`. That call is awaited only for promise rejection or activity timeout; its `AgentRunResult.exitCode` is never inspected. The adapter then unconditionally calls `runWorkspacePipeline()` at `src/sdk/pipeline.ts:144` through `src/sdk/pipeline.ts:147`. In the reproduction, the initializer returns exit code `1`, leaves the source unchanged, and the workspace pipeline is still called and its resolved result returned.

## Expected Behavior

Automatic initialization should stop and surface failure when its initializer agent returns a nonzero exit code, matching the explicit `runPipelineInit()` workflow's failure semantics. The workspace pipeline should only execute after initialization has successfully produced a usable pipeline document.

## Impact

SDK callers can receive misleading downstream pipeline results after the prerequisite initialization step failed. Diagnostics from the initializer are discarded, invalid or uninitialized files are passed into later processing, and automation may report no work or unrelated parse failures instead of the actual initialization failure.
