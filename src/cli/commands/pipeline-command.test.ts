import { describe, it, expect, vi, afterEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { registerPipelineCommand } from "./pipeline.js";
import { ValidationError } from "../errors.js";
import pipelineSkillPlan from "../../templates/pipeline/SKILL_plan.md";
import pipelineStepsTemplate from "../../templates/pipeline/steps.yaml.hbs";

vi.mock("../../sdk/pipeline.js", () => ({
  runPipeline: vi.fn().mockResolvedValue({
    stopReason: "completed",
    planPath: ".poe-code/pipeline/plans/plan.yaml",
    runsCompleted: 1,
    totalDurationMs: 1_000,
    metrics: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 1
    }
  })
}));

vi.mock("../../sdk/spawn.js", () => ({
  spawn: vi.fn()
}));

vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  return {
    ...actual,
    renderAcpStream: vi.fn().mockResolvedValue(undefined)
  };
});

import { runPipeline as sdkRunPipeline } from "../../sdk/pipeline.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
  return program;
}

describe("pipeline run command", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls the pipeline SDK with the CLI options", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "pipeline",
      "run",
      "--plan",
      "custom-plan.yaml",
      "--task",
      "auth-hardening",
      "--agent",
      "codex",
      "--model",
      "gpt-5.2",
      "--max-runs",
      "3"
    ]);

    expect(vi.mocked(sdkRunPipeline)).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd,
        homeDir,
        assumeYes: true,
        plan: "custom-plan.yaml",
        task: "auth-hardening",
        agent: "codex",
        model: "gpt-5.2",
        maxRuns: 3
      })
    );
  });

  it("defaults to claude-code and resolves agent aliases", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "pipeline",
      "run",
      "--agent",
      "claude"
    ]);

    expect(vi.mocked(sdkRunPipeline)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code"
      })
    );
  });

  it("rejects invalid max-runs values", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "pipeline",
        "run",
        "--agent",
        "claude-code",
        "--max-runs",
        "0"
      ])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("shows usage in task completion and metrics in summary", async () => {
    const logs: string[] = [];
    vi.mocked(sdkRunPipeline).mockImplementationOnce(async (options) => {
      options.onTaskComplete?.({
        taskId: "task-1",
        taskTitle: "Task 1",
        stepName: "implement",
        index: 1,
        total: 1,
        durationMs: 2_500,
        success: true,
        usage: {
          inputTokens: 1_234,
          outputTokens: 567
        }
      });
      return {
        stopReason: "completed",
        planPath: ".poe-code/pipeline/plans/plan.yaml",
        runsCompleted: 1,
        totalDurationMs: 3_000,
        metrics: {
          totalInputTokens: 5_000,
          totalOutputTokens: 2_000,
          totalCachedTokens: 1_000,
          tasksCompleted: 1,
          tasksFailed: 0,
          stepsCompleted: 1
        }
      };
    });

    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "pipeline",
      "run",
      "--agent",
      "codex"
    ]);

    expect(
      logs.some((message) =>
        message.includes("Task task-1 done in 3s (tokens: 1234 in / 567 out)")
      )
    ).toBe(true);
    expect(
      logs.some((message) =>
        message.includes("Total tokens: 5000 input, 2000 output, 1000 cached")
      )
    ).toBe(true);
    expect(
      logs.some((message) =>
        message.includes("tasksCompleted: 1, tasksFailed: 0, stepsCompleted: 1")
      )
    ).toBe(true);
  });
});

describe("pipeline validate command", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("validates a plan file and reports success", async () => {
    const fs = createMemFs();
    await fs.mkdir("/repo/.poe-code/pipeline/plans", { recursive: true });
    await fs.writeFile(
      "/repo/.poe-code/pipeline/plans/plan-demo.yaml",
      [
        "tasks:",
        "  - id: one",
        "    title: Task one",
        "    prompt: Do the thing",
        "    status: open",
        ""
      ].join("\n"),
      { encoding: "utf8" }
    );

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "pipeline",
        "validate",
        ".poe-code/pipeline/plans/plan-demo.yaml"
      ])
    ).resolves.not.toThrow();
  });

  it("validates step references against steps.yaml", async () => {
    const fs = createMemFs();
    await fs.mkdir("/repo/.poe-code/pipeline/plans", { recursive: true });
    await fs.writeFile(
      "/repo/.poe-code/pipeline/steps.yaml",
      [
        "steps:",
        "  implement:",
        "    instruction: Implement {{id}}",
        ""
      ].join("\n"),
      { encoding: "utf8" }
    );
    await fs.writeFile(
      "/repo/.poe-code/pipeline/plans/plan-bad.yaml",
      [
        "tasks:",
        "  - id: one",
        "    title: Task one",
        "    prompt: Do the thing",
        "    status:",
        "      nonexistent: open",
        ""
      ].join("\n"),
      { encoding: "utf8" }
    );

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "pipeline",
        "validate",
        ".poe-code/pipeline/plans/plan-bad.yaml"
      ])
    ).rejects.toThrow(/unknown step/i);
  });
});

describe("pipeline plan-path command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints project plans path when local .poe-code directory exists", async () => {
    const fs = createMemFs();
    await fs.mkdir("/repo/.poe-code", { recursive: true });

    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync(["node", "cli", "pipeline", "plan-path"]);

    expect(writeSpy).toHaveBeenCalledWith("/repo/.poe-code/pipeline/plans\n");
  });

  it("prints global plans path when local .poe-code directory does not exist", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync(["node", "cli", "pipeline", "plan-path"]);

    expect(writeSpy).toHaveBeenCalledWith("/home/test/.poe-code/pipeline/plans\n");
  });
});

describe("pipeline install command", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("installs the pipeline skill and scaffolds local steps and plans paths", async () => {
    const fs = createMemFs();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "pipeline",
      "install",
      "--agent",
      "claude-code",
      "--local"
    ]);

    await expect(
      fs.readFile("/repo/.claude/skills/poe-code-pipeline-plan/SKILL.md", "utf8")
    ).resolves.toBe(pipelineSkillPlan);
    await expect(
      fs.readFile("/repo/.poe-code/pipeline/steps.yaml", "utf8")
    ).resolves.toBe(pipelineStepsTemplate);
    await expect(fs.stat("/repo/.poe-code/pipeline/plans")).resolves.toBeDefined();
  });

  it("defaults to claude-code and local scope with --yes", async () => {
    const fs = createMemFs();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "pipeline",
      "install"
    ]);

    await expect(
      fs.readFile("/repo/.claude/skills/poe-code-pipeline-plan/SKILL.md", "utf8")
    ).resolves.toBe(pipelineSkillPlan);
    await expect(
      fs.readFile("/repo/.poe-code/pipeline/steps.yaml", "utf8")
    ).resolves.toBe(pipelineStepsTemplate);
  });

  it("does not overwrite steps.yaml without --force", async () => {
    const fs = createMemFs();
    await fs.mkdir("/repo/.poe-code/pipeline", { recursive: true });
    await fs.writeFile("/repo/.poe-code/pipeline/steps.yaml", "EXISTING_STEPS", {
      encoding: "utf8"
    });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "pipeline",
      "install",
      "--agent",
      "claude-code",
      "--local"
    ]);

    await expect(
      fs.readFile("/repo/.poe-code/pipeline/steps.yaml", "utf8")
    ).resolves.toBe("EXISTING_STEPS");

    await program.parseAsync([
      "node",
      "cli",
      "pipeline",
      "install",
      "--agent",
      "claude-code",
      "--local",
      "--force"
    ]);

    await expect(
      fs.readFile("/repo/.poe-code/pipeline/steps.yaml", "utf8")
    ).resolves.toBe(pipelineStepsTemplate);
  });
});
