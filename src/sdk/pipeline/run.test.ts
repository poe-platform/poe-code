import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PipelineDefinition } from "./types.js";

vi.mock("../spawn.js", () => ({
  spawn: vi.fn()
}));

vi.mock("@poe-code/agent-spawn", () => ({
  renderAcpStream: vi.fn(async (events: AsyncIterable<unknown>) => {
    for await (const ignoredEvent of events) {
      // drain
    }
  })
}));

import { runPipeline } from "./run.js";
import { spawn } from "../spawn.js";
import { renderAcpStream } from "@poe-code/agent-spawn";

function emptyAsyncIterable<T>(): AsyncIterable<T> {
  return (async function* () {})();
}

function mockSpawnSuccess(output: string) {
  return {
    events: (async function* () {
      yield { event: "agent_message", text: output };
    })(),
    result: Promise.resolve({
      stdout: output,
      stderr: "",
      exitCode: 0
    })
  };
}

function mockSpawnFailure(exitCode: number, stderr = "") {
  return {
    events: emptyAsyncIterable(),
    result: Promise.resolve({
      stdout: "",
      stderr,
      exitCode
    })
  };
}

beforeEach(() => {
  vi.mocked(spawn).mockReset();
  vi.mocked(renderAcpStream).mockReset();
  vi.mocked(renderAcpStream).mockImplementation(async (events) => {
    for await (const ignoredEvent of events) {
      // drain
    }
  });
});

describe("runPipeline", () => {
  it("runs a single sequential step", async () => {
    vi.mocked(spawn).mockReturnValueOnce(mockSpawnSuccess("review output"));

    const pipeline: PipelineDefinition = {
      name: "test",
      steps: [
        { name: "review", agent: "claude-code", prompt: "Review this code" }
      ]
    };

    const result = await runPipeline(pipeline, { cwd: "/project" });

    expect(result.steps.review.output).toBe("review output");
    expect(result.steps.review.exitCode).toBe(0);
    expect(result.summary.totalSteps).toBe(1);
    expect(result.summary.completedSteps).toBe(1);
    expect(result.summary.success).toBe(true);
    expect(spawn).toHaveBeenCalledWith("claude-code", {
      prompt: "Review this code",
      cwd: "/project",
      mode: "yolo"
    });
  });

  it("runs sequential steps with interpolation", async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(mockSpawnSuccess("Found 3 bugs"))
      .mockReturnValueOnce(mockSpawnSuccess("Fixed 3 bugs"));

    const pipeline: PipelineDefinition = {
      name: "fix-flow",
      steps: [
        { name: "research", agent: "claude-code", prompt: "Find bugs" },
        {
          name: "fix",
          agent: "codex",
          prompt: "Fix: {{steps.research.output}}"
        }
      ]
    };

    const result = await runPipeline(pipeline, { cwd: "/project" });

    expect(result.steps.research.output).toBe("Found 3 bugs");
    expect(result.steps.fix.output).toBe("Fixed 3 bugs");
    expect(result.summary.completedSteps).toBe(2);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenNthCalledWith(2, "codex", {
      prompt: "Fix: Found 3 bugs",
      cwd: "/project",
      mode: "yolo"
    });
  });

  it("aborts on step failure", async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(mockSpawnSuccess("ok"))
      .mockReturnValueOnce(mockSpawnFailure(1, "rate limit exceeded"));

    const pipeline: PipelineDefinition = {
      name: "test",
      steps: [
        { name: "step1", agent: "claude-code", prompt: "First" },
        { name: "step2", agent: "codex", prompt: "Second" },
        { name: "step3", agent: "claude-code", prompt: "Third" }
      ]
    };

    const result = await runPipeline(pipeline, { cwd: "/project" });

    expect(result.summary.success).toBe(false);
    expect(result.summary.completedSteps).toBe(1);
    expect(result.summary.totalSteps).toBe(3);
    expect(result.steps.step1.exitCode).toBe(0);
    expect(result.steps.step2.exitCode).toBe(1);
    expect(result.steps.step3).toBeUndefined();
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("runs parallel steps concurrently", async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(mockSpawnSuccess("research output"))
      .mockReturnValueOnce(mockSpawnSuccess("fix-a output"))
      .mockReturnValueOnce(mockSpawnSuccess("fix-b output"));

    const pipeline: PipelineDefinition = {
      name: "parallel-test",
      steps: [
        { name: "research", agent: "claude-code", prompt: "Research" },
        {
          parallel: [
            {
              name: "fix-a",
              agent: "codex",
              prompt: "Fix A: {{steps.research.output}}"
            },
            {
              name: "fix-b",
              agent: "claude-code",
              prompt: "Fix B: {{steps.research.output}}"
            }
          ]
        }
      ]
    };

    const result = await runPipeline(pipeline, { cwd: "/project" });

    expect(result.steps.research.output).toBe("research output");
    expect(result.steps["fix-a"].output).toBe("fix-a output");
    expect(result.steps["fix-b"].output).toBe("fix-b output");
    expect(result.summary.completedSteps).toBe(3);
    expect(result.summary.success).toBe(true);
  });

  it("uses pipeline defaults for agent and mode", () => {
    vi.mocked(spawn).mockReturnValueOnce(mockSpawnSuccess("output"));

    const pipeline: PipelineDefinition = {
      name: "test",
      defaults: { agent: "claude-code", mode: "read", model: "sonnet" },
      steps: [{ name: "step1", prompt: "Do it" }]
    };

    runPipeline(pipeline, { cwd: "/project" });

    expect(spawn).toHaveBeenCalledWith("claude-code", {
      prompt: "Do it",
      cwd: "/project",
      mode: "read",
      model: "sonnet"
    });
  });

  it("step overrides pipeline defaults", () => {
    vi.mocked(spawn).mockReturnValueOnce(mockSpawnSuccess("output"));

    const pipeline: PipelineDefinition = {
      name: "test",
      defaults: { agent: "claude-code", mode: "read" },
      steps: [
        {
          name: "step1",
          agent: "codex",
          mode: "edit",
          model: "o3-pro",
          prompt: "Do it"
        }
      ]
    };

    runPipeline(pipeline, { cwd: "/project" });

    expect(spawn).toHaveBeenCalledWith("codex", {
      prompt: "Do it",
      cwd: "/project",
      mode: "edit",
      model: "o3-pro"
    });
  });

  it("forwards step args", () => {
    vi.mocked(spawn).mockReturnValueOnce(mockSpawnSuccess("output"));

    const pipeline: PipelineDefinition = {
      name: "test",
      steps: [
        {
          name: "step1",
          agent: "claude-code",
          prompt: "Do it",
          args: ["--flag", "value"]
        }
      ]
    };

    runPipeline(pipeline, { cwd: "/project" });

    expect(spawn).toHaveBeenCalledWith("claude-code", {
      prompt: "Do it",
      cwd: "/project",
      mode: "yolo",
      args: ["--flag", "value"]
    });
  });

  it("uses step cwd when specified", () => {
    vi.mocked(spawn).mockReturnValueOnce(mockSpawnSuccess("output"));

    const pipeline: PipelineDefinition = {
      name: "test",
      steps: [
        {
          name: "step1",
          agent: "claude-code",
          prompt: "Do it",
          cwd: "/other/dir"
        }
      ]
    };

    runPipeline(pipeline, { cwd: "/project" });

    expect(spawn).toHaveBeenCalledWith("claude-code", {
      prompt: "Do it",
      cwd: "/other/dir",
      mode: "yolo"
    });
  });

  it("aborts parallel group on any failure", async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(mockSpawnSuccess("ok"))
      .mockReturnValueOnce(mockSpawnFailure(1, "error"))
      .mockReturnValueOnce(mockSpawnSuccess("ok too"));

    const pipeline: PipelineDefinition = {
      name: "test",
      steps: [
        {
          parallel: [
            { name: "a", agent: "codex", prompt: "A" },
            { name: "b", agent: "claude-code", prompt: "B" }
          ]
        },
        { name: "after", agent: "claude-code", prompt: "After" }
      ]
    };

    const result = await runPipeline(pipeline, { cwd: "/project" });

    expect(result.summary.success).toBe(false);
    expect(result.steps.after).toBeUndefined();
  });

  it("renders events from sequential steps", async () => {
    vi.mocked(spawn).mockReturnValueOnce(mockSpawnSuccess("output"));

    const pipeline: PipelineDefinition = {
      name: "test",
      steps: [{ name: "step1", agent: "claude-code", prompt: "Do it" }]
    };

    await runPipeline(pipeline, { cwd: "/project" });

    expect(renderAcpStream).toHaveBeenCalledTimes(1);
  });
});
