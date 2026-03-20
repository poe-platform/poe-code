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
    runsCompleted: 1
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
