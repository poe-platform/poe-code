import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fs, vol } from "memfs";
import type { PipelineRunResult } from "@poe-code/pipeline";

const workspaceRunPipelineMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

vi.mock("./spawn.js", () => ({
  spawn: vi.fn()
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
  vol.fromJSON(files, "/");
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

describe("SDK pipeline", () => {
  beforeEach(() => {
    workspaceRunPipelineMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs directly when the target file already has tasks", async () => {
    seedFs({
      "/repo/feature.md": initializedPlan()
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
        runAgent
      })
    );
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
    expect(workspaceRunPipelineMock).toHaveBeenCalledTimes(1);
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
});
