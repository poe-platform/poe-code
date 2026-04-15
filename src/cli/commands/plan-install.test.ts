import { afterEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { registerPlanCommand } from "./plan.js";
import planSkillTemplate from "../../templates/plan/SKILL_plan.md";

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

describe("plan install command", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("installs the plan skill locally for claude-code", async () => {
    const fs = createMemFs();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "plan",
      "install",
      "--agent",
      "claude-code",
      "--local"
    ]);

    await expect(
      fs.readFile("/repo/.claude/skills/poe-code-plan/SKILL.md", "utf8")
    ).resolves.toBe(planSkillTemplate);
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
    registerPlanCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "plan", "install"]);

    await expect(
      fs.readFile("/repo/.claude/skills/poe-code-plan/SKILL.md", "utf8")
    ).resolves.toBe(planSkillTemplate);
  });

  it("installs globally when --global is passed", async () => {
    const fs = createMemFs();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "plan",
      "install",
      "--agent",
      "claude-code",
      "--global"
    ]);

    await expect(
      fs.readFile("/home/test/.claude/skills/poe-code-plan/SKILL.md", "utf8")
    ).resolves.toBe(planSkillTemplate);
  });

  it("rejects using --local and --global together", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "plan",
        "install",
        "--local",
        "--global"
      ])
    ).rejects.toThrow(/either --local or --global/);
  });
});
