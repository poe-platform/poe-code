import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFsFromVolume, fs, vol, Volume } from "memfs";
import type { PipelineFileSystem, PipelineRunOptions, PipelineRunResult } from "@poe-code/pipeline";

const workspaceRunPipelineMock = vi.hoisted(() => vi.fn());
const sdkSpawnAutonomousMock = vi.hoisted(() => vi.fn());
const runWithOptionalWorktreeMock = vi.hoisted(() => vi.fn());
const pipelineSkillPlanPath = new URL("../templates/pipeline/SKILL_plan.md", import.meta.url)
  .pathname;

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

vi.mock("./spawn.js", () => ({
  spawn: {
    autonomous: sdkSpawnAutonomousMock
  }
}));

vi.mock("./worktree.js", () => ({
  runWithOptionalWorktree: runWithOptionalWorktreeMock
}));

vi.mock("@poe-code/pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/pipeline")>();
  return {
    ...actual,
    runPipeline: workspaceRunPipelineMock
  };
});

const { runPipeline } = await import("./pipeline.js");

const cwd = "/repo";
const homeDir = "/home/test";
const workspaceResult: PipelineRunResult = {
  stopReason: "completed",
  planPath: "feature.md",
  runsCompleted: 1,
  totalDurationMs: 100,
  metrics: {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedTokens: 0,
    tasksCompleted: 1,
    tasksFailed: 0,
    stepsCompleted: 1
  }
};

function seedFs(files: Record<string, string>): void {
  vol.reset();
  vol.fromJSON(
    {
      [pipelineSkillPlanPath]: "Pipeline skill template",
      ...files
    },
    "/"
  );
  vol.mkdirSync(cwd, { recursive: true });
  vol.mkdirSync(homeDir, { recursive: true });
}

function initializedPlan(body = "# Feature\nShip it.\n"): string {
  return [
    "---",
    "$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json",
    "kind: pipeline",
    "version: 1",
    "tasks:",
    "  - id: ship-feature",
    "    title: Ship feature",
    "    prompt: |",
    "      Ship it.",
    "    status: open",
    "---",
    body.trimEnd(),
    ""
  ].join("\n");
}

function createActivityTimeoutError(): Error {
  const error = new Error("Timed out waiting for agent activity for 600000ms.");
  error.name = "ActivityTimeoutError";
  return error;
}

describe("SDK pipeline", () => {
  beforeEach(() => {
    workspaceRunPipelineMock.mockReset();
    sdkSpawnAutonomousMock.mockReset();
    runWithOptionalWorktreeMock.mockReset();
    runWithOptionalWorktreeMock.mockImplementation(async (input) => {
      const value = await input.run({
        sourceCwd: input.cwd,
        worktreeCwd: "/repo/.poe-code/worktrees/pipeline",
        worktree: {
          name: "pipeline",
          path: "/repo/.poe-code/worktrees/pipeline",
          branch: "poe-code/pipeline",
          baseBranch: "HEAD",
          createdAt: "2026-01-01T00:00:00.000Z",
          source: "sdk",
          agent: input.selectedAgent,
          status: "active"
        }
      });
      return { value };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs directly when the target file already has tasks", async () => {
    seedFs({
      "/repo/feature.md": initializedPlan(),
      "/repo/.poe-code/worktrees/pipeline/feature.md": initializedPlan()
    });

    const runAgent = vi.fn();
    workspaceRunPipelineMock.mockResolvedValueOnce(workspaceResult);

    const result = await runPipeline({
      agent: "codex",
      cwd,
      homeDir,
      plan: "feature.md",
      runAgent
    });

    expect(result).toEqual(workspaceResult);
    expect(runAgent).not.toHaveBeenCalled();
    expect(workspaceRunPipelineMock).toHaveBeenCalledTimes(1);
    expect(workspaceRunPipelineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex",
        cwd,
        homeDir,
        plan: "feature.md",
        runAgent: expect.any(Function)
      })
    );
  });

  it("wraps the whole pipeline run in one worktree when enabled", async () => {
    seedFs({
      "/repo/feature.md": initializedPlan(),
      "/repo/.poe-code/worktrees/pipeline/feature.md": initializedPlan()
    });
    workspaceRunPipelineMock.mockResolvedValueOnce(workspaceResult);

    await runPipeline({
      agent: "codex",
      cwd,
      homeDir,
      plan: "feature.md",
      worktree: true
    });

    expect(runWithOptionalWorktreeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd,
        selectedAgent: "codex",
        worktree: true
      })
    );
    expect(workspaceRunPipelineMock).toHaveBeenCalledTimes(1);
    expect(workspaceRunPipelineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo/.poe-code/worktrees/pipeline",
        plan: "feature.md"
      })
    );
  });

  it.each(["completed", "max_runs", "nothing_to_run", "failed", "cancelled"] as const)(
    "classifies %s without changing the returned workflow result",
    async (stopReason) => {
      seedFs({ "/repo/.poe-code/worktrees/pipeline/feature.md": initializedPlan() });
      const value = { ...workspaceResult, stopReason };
      workspaceRunPipelineMock.mockResolvedValueOnce(value);
      const result = await runPipeline({ agent: "codex", cwd, homeDir, plan: "feature.md", worktree: true });

      expect(result).toBe(value);
      const input = runWithOptionalWorktreeMock.mock.calls[0]![0];
      expect(input.isSuccessful(value)).toBe(stopReason !== "failed" && stopReason !== "cancelled");
    }
  );

  it("uses an injected filesystem for explicit plan initialization preflight", async () => {
    seedFs({});
    const injectedFs = createFsFromVolume(
      Volume.fromJSON({ "/virtual/feature.md": initializedPlan() }, "/")
    ).promises as unknown as PipelineFileSystem;
    workspaceRunPipelineMock.mockResolvedValueOnce(workspaceResult);

    const result = await runPipeline({
      agent: "codex",
      cwd: "/virtual",
      homeDir,
      plan: "feature.md",
      fs: injectedFs,
      runAgent: vi.fn()
    });

    expect(result).toEqual(workspaceResult);
    expect(workspaceRunPipelineMock).toHaveBeenCalledTimes(1);
  });

  it("supports home-relative explicit plan paths during initialization preflight", async () => {
    seedFs({
      "/home/test/plans/feature.md": initializedPlan()
    });
    workspaceRunPipelineMock.mockResolvedValueOnce(workspaceResult);

    const result = await runPipeline({
      agent: "codex",
      cwd,
      homeDir,
      plan: "~/plans/feature.md",
      runAgent: vi.fn()
    });

    expect(result).toEqual(workspaceResult);
    expect(workspaceRunPipelineMock).toHaveBeenCalledTimes(1);
  });

  it("initializes the source file in place when the target file has no frontmatter", async () => {
    seedFs({
      "/repo/feature.md": "# Feature\nShip it.\n"
    });

    const runAgent = vi.fn(async () => {
      await fs.promises.writeFile("/repo/feature.md", initializedPlan());
      return {
        stdout: "initialized",
        stderr: "",
        exitCode: 0
      };
    });
    workspaceRunPipelineMock.mockImplementationOnce(async () => {
      const content = await fs.promises.readFile("/repo/feature.md", "utf8");
      expect(content).toContain("tasks:");
      expect(content).toContain("# Feature");
      return workspaceResult;
    });

    const result = await runPipeline({
      agent: "codex",
      cwd,
      homeDir,
      plan: "feature.md",
      runAgent
    });

    expect(result).toEqual(workspaceResult);
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgent.mock.calls[0]?.[0]).not.toHaveProperty("mode");
    expect(workspaceRunPipelineMock).toHaveBeenCalledTimes(1);
  });

  it("does not run automatic initialization when already aborted", async () => {
    seedFs({
      "/repo/feature.md": "# Feature\nShip it.\n"
    });
    const controller = new AbortController();
    controller.abort();
    const runAgent = vi.fn();

    await expect(
      runPipeline({
        agent: "codex",
        cwd,
        homeDir,
        plan: "feature.md",
        signal: controller.signal,
        runAgent
      })
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(runAgent).not.toHaveBeenCalled();
    expect(workspaceRunPipelineMock).not.toHaveBeenCalled();
  });

  it("rejects when automatic initialization exits nonzero", async () => {
    seedFs({
      "/repo/feature.md": "# Feature\nShip it.\n"
    });
    const runAgent = vi.fn().mockResolvedValue({
      stdout: "",
      stderr: "init failed",
      exitCode: 1
    });

    await expect(
      runPipeline({
        agent: "codex",
        cwd,
        homeDir,
        plan: "feature.md",
        runAgent
      })
    ).rejects.toThrow("Pipeline initialization failed with exit code 1");

    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(workspaceRunPipelineMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "frontmatter without a tasks key",
      content: ["---", "kind: pipeline", "version: 1", "---", "# Feature", ""].join("\n")
    },
    {
      name: "frontmatter with an empty tasks array",
      content: ["---", "tasks: []", "---", "# Feature", ""].join("\n")
    }
  ])("initializes when the target file has $name", async ({ content }) => {
    seedFs({
      "/repo/feature.md": content
    });

    const runAgent = vi.fn(async () => {
      await fs.promises.writeFile("/repo/feature.md", initializedPlan());
      return {
        stdout: "initialized",
        stderr: "",
        exitCode: 0
      };
    });
    workspaceRunPipelineMock.mockResolvedValueOnce(workspaceResult);

    const result = await runPipeline({
      agent: "codex",
      cwd,
      homeDir,
      plan: "feature.md",
      runAgent
    });

    expect(result).toEqual(workspaceResult);
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(workspaceRunPipelineMock).toHaveBeenCalledTimes(1);
  });

  it("retries timed out init runs before executing the workspace pipeline", async () => {
    seedFs({
      "/repo/feature.md": "# Feature\nShip it.\n"
    });

    const timeoutError = createActivityTimeoutError();
    const runAgent = vi
      .fn()
      .mockRejectedValueOnce(timeoutError)
      .mockImplementationOnce(async () => {
        await fs.promises.writeFile("/repo/feature.md", initializedPlan());
        return {
          stdout: "initialized",
          stderr: "",
          exitCode: 0
        };
      });
    workspaceRunPipelineMock.mockImplementationOnce(async () => {
      const content = await fs.promises.readFile("/repo/feature.md", "utf8");
      expect(content).toContain("tasks:");
      return workspaceResult;
    });

    const result = await runPipeline({
      agent: "codex",
      cwd,
      homeDir,
      plan: "feature.md",
      runAgent
    });

    expect(result).toEqual(workspaceResult);
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(workspaceRunPipelineMock).toHaveBeenCalledTimes(1);
  });

  it("retries timed out agent runs before succeeding", async () => {
    seedFs({
      "/repo/feature.md": initializedPlan()
    });

    const timeoutError = createActivityTimeoutError();
    const runAgent = vi.fn().mockRejectedValueOnce(timeoutError).mockResolvedValueOnce({
      stdout: "done",
      stderr: "",
      exitCode: 0
    });
    workspaceRunPipelineMock.mockImplementationOnce(async (options) => {
      await options.runAgent?.({
        agent: "codex",
        prompt: "Ship it.",
        cwd
      });

      return workspaceResult;
    });

    const result = await runPipeline({
      agent: "codex",
      cwd,
      homeDir,
      plan: "feature.md",
      runAgent
    });

    expect(result).toEqual(workspaceResult);
    expect(runAgent).toHaveBeenCalledTimes(2);
  });

  it("does not retry a timed out agent after cancellation", async () => {
    seedFs({
      "/repo/feature.md": initializedPlan()
    });
    const controller = new AbortController();
    const timeoutError = createActivityTimeoutError();
    const runAgent = vi.fn(async () => {
      controller.abort();
      throw timeoutError;
    });
    workspaceRunPipelineMock.mockImplementationOnce(async (options: PipelineRunOptions) => {
      await options.runAgent?.({
        agent: "codex",
        prompt: "Ship it.",
        mode: "yolo",
        cwd,
        signal: controller.signal
      });
      return workspaceResult;
    });

    await expect(
      runPipeline({
        agent: "codex",
        cwd,
        homeDir,
        plan: "feature.md",
        signal: controller.signal,
        runAgent
      })
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it("passes pipeline step options through the default SDK spawn runner", async () => {
    seedFs({
      "/repo/feature.md": initializedPlan()
    });

    sdkSpawnAutonomousMock.mockResolvedValueOnce({
      stdout: "done",
      stderr: "",
      exitCode: 0
    });
    workspaceRunPipelineMock.mockImplementationOnce(async (options) => {
      await options.runAgent?.({
        agent: "codex",
        prompt: "Ship it.",
        mode: "yolo",
        cwd,
        logDir: "/tmp/logs",
        logFileName: "task.jsonl",
        skills: ["foo", "claude/bar"],
        hooks: { from: "claude", strategy: "transform", scope: "merged" }
      });

      return workspaceResult;
    });

    const result = await runPipeline({
      agent: "codex",
      cwd,
      homeDir,
      plan: "feature.md"
    });

    expect(result).toEqual(workspaceResult);
    expect(sdkSpawnAutonomousMock).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({
        prompt: "Ship it.",
        cwd,
        mode: "yolo",
        logDir: "/tmp/logs",
        logFileName: "task.jsonl",
        skills: ["foo", "claude/bar"],
        hooks: { from: "claude", strategy: "transform", scope: "merged" }
      })
    );
  });

  it("does not retry non-timeout errors", async () => {
    seedFs({
      "/repo/feature.md": initializedPlan()
    });

    const failure = new Error("boom");
    const runAgent = vi.fn().mockRejectedValue(failure);
    workspaceRunPipelineMock.mockImplementationOnce(async (options) => {
      await options.runAgent?.({
        agent: "codex",
        prompt: "Ship it.",
        cwd
      });

      return workspaceResult;
    });

    await expect(
      runPipeline({
        agent: "codex",
        cwd,
        homeDir,
        plan: "feature.md",
        runAgent
      })
    ).rejects.toBe(failure);
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting activity-timeout retries", async () => {
    seedFs({
      "/repo/feature.md": initializedPlan()
    });

    const timeoutError = createActivityTimeoutError();
    const runAgent = vi.fn().mockRejectedValue(timeoutError);
    workspaceRunPipelineMock.mockImplementationOnce(async (options) => {
      await options.runAgent?.({
        agent: "codex",
        prompt: "Ship it.",
        cwd
      });

      return workspaceResult;
    });

    await expect(
      runPipeline({
        agent: "codex",
        cwd,
        homeDir,
        plan: "feature.md",
        runAgent
      })
    ).rejects.toBe(timeoutError);
    expect(runAgent).toHaveBeenCalledTimes(3);
  });
});
