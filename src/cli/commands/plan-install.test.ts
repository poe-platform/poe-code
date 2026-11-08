import { afterEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { registerPlanCommand } from "./plan.js";
import planSkillTemplate from "../../templates/plan/SKILL_plan.md";

const { selectMock, cancelMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  cancelMock: vi.fn()
}));

vi.mock("toolcraft-design", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("toolcraft-design");
  return {
    ...actual,
    select: selectMock,
    isCancel: (value: unknown) => value === "__cancel__",
    cancel: cancelMock
  };
});

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

function withMockedStdin<T>(run: () => Promise<T>, isTTY: boolean): Promise<T> {
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: isTTY
  });

  return run().finally(() => {
    if (stdinDescriptor) {
      Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
    } else {
      Reflect.deleteProperty(process.stdin, "isTTY");
    }
  });
}

describe("plan install command", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("ships canonical metadata instructions in the generic plan skill template", () => {
    expect(planSkillTemplate).toContain("Write `docs/plans/<name>.md`");
    expect(planSkillTemplate).toContain("kind: plan");
    expect(planSkillTemplate).toContain("version: 1");
    expect(planSkillTemplate).toContain("```yaml");
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

    await expect(fs.readFile("/repo/.claude/skills/poe-code-plan/SKILL.md", "utf8")).resolves.toBe(
      planSkillTemplate
    );
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

    await expect(fs.readFile("/repo/.claude/skills/poe-code-plan/SKILL.md", "utf8")).resolves.toBe(
      planSkillTemplate
    );
  });

  it("announces the default agent and scope that --yes selected", async () => {
    const logs: string[] = [];
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "plan", "install"]);

    const output = logs.join("\n");
    expect(output).toContain("Using default agent: claude-code (built-in default");
    expect(output).toContain("Using default scope: local");
  });

  it("announces a configured default agent instead of the built-in one", async () => {
    const logs: string[] = [];
    const fs = createMemFs();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      container.env.configPath,
      `${JSON.stringify({ core: { defaultAgent: "codex:openai/gpt-5.4" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "plan", "install", "--local"]);

    const output = logs.join("\n");
    expect(output).toContain("Using default agent: codex (from core.defaultAgent)");
    expect(output).not.toContain("Using default scope");
  });

  it("does not recover malformed config while previewing plan installation", async () => {
    const fs = createMemFs();
    const malformedConfig = "{ invalid json\n";
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(container.env.configPath, malformedConfig, { encoding: "utf8" });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "--yes", "plan", "install", "--local"])
    ).rejects.toThrow();

    await expect(fs.readFile(container.env.configPath, "utf8")).resolves.toBe(malformedConfig);
    await expect(fs.readdir(`${homeDir}/.poe-code`)).resolves.toEqual(["config.json"]);
  });

  it("uses core.defaultAgent for install with --yes and drops the model portion", async () => {
    const fs = createMemFs();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      container.env.configPath,
      `${JSON.stringify({ core: { defaultAgent: "codex:openai/gpt-5.4" } }, null, 2)}
`,
      { encoding: "utf8" }
    );
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "plan", "install", "--local"]);

    expect(selectMock).not.toHaveBeenCalled();
    await expect(fs.readFile("/repo/.codex/skills/poe-code-plan/SKILL.md", "utf8")).resolves.toBe(
      planSkillTemplate
    );
  });

  it("prompts for the install agent when core.defaultAgent exists without --yes", async () => {
    const fs = createMemFs();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    selectMock.mockResolvedValueOnce("claude-code");
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      container.env.configPath,
      `${JSON.stringify({ core: { defaultAgent: "codex:openai/gpt-5.4" } }, null, 2)}
`,
      { encoding: "utf8" }
    );
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await withMockedStdin(
      () => program.parseAsync(["node", "cli", "plan", "install", "--local"]),
      true
    );

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(selectMock).toHaveBeenCalledWith({
      message: "Select agent to install the plan skill for:",
      options: expect.arrayContaining([expect.objectContaining({ value: "claude-code" })])
    });
    await expect(fs.readFile("/repo/.claude/skills/poe-code-plan/SKILL.md", "utf8")).resolves.toBe(
      planSkillTemplate
    );
    await expect(fs.stat("/repo/.codex/skills/poe-code-plan/SKILL.md")).rejects.toThrow("ENOENT");
  });

  it("rejects missing install agent selection in non-interactive mode", async () => {
    const fs = createMemFs();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await expect(
      withMockedStdin(() => program.parseAsync(["node", "cli", "plan", "install"]), false)
    ).rejects.toThrow(
      "Plan install agent selection requires --agent or --yes when running without an interactive TTY."
    );

    expect(selectMock).not.toHaveBeenCalled();
  });

  it("rejects missing install scope selection in non-interactive mode", async () => {
    const fs = createMemFs();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await expect(
      withMockedStdin(
        () => program.parseAsync(["node", "cli", "plan", "install", "--agent", "claude-code"]),
        false
      )
    ).rejects.toThrow(
      "Plan install scope selection requires --local, --global, or --yes when running without an interactive TTY."
    );
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
      program.parseAsync(["node", "cli", "plan", "install", "--local", "--global"])
    ).rejects.toThrow(/either --local or --global/);
  });
});
