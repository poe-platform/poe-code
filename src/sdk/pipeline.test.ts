import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineRunResult } from "@poe-code/pipeline";

const workspaceRunPipelineHarnessMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/pipeline")>();
  return {
    ...actual,
    runPipelineHarness: workspaceRunPipelineHarnessMock
  };
});

const { runPipeline } = await import("./pipeline.js");

const workspaceResult: PipelineRunResult = {
  stopReason: "completed",
  planPath: "docs/plans/feature.md",
  runsCompleted: 1,
  totalDurationMs: 100,
  metrics: {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedTokens: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    stepsCompleted: 0
  }
};

describe("SDK pipeline", () => {
  beforeEach(() => {
    workspaceRunPipelineHarnessMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("delegates pipeline runs to the workspace harness wrapper", async () => {
    workspaceRunPipelineHarnessMock.mockResolvedValueOnce(workspaceResult);

    const result = await runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "docs/plans/feature.md"
    });

    expect(result).toEqual(workspaceResult);
    expect(workspaceRunPipelineHarnessMock).toHaveBeenCalledWith({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "docs/plans/feature.md"
    });
  });

  it("passes reset through to the workspace harness wrapper", async () => {
    workspaceRunPipelineHarnessMock.mockResolvedValueOnce(workspaceResult);

    await runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "docs/plans/feature.md",
      reset: true
    });

    expect(workspaceRunPipelineHarnessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reset: true
      })
    );
  });
});
