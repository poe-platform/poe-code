import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { Volume, createFsFromVolume } from "memfs";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { buildPlanPrompt, registerPlanCommand } from "./plan.js";
import planSkillTemplate from "../../templates/plan/SKILL_plan.md";

const { isCancelMock, sdkSpawnMock, selectMock, spawnResult } = vi.hoisted(() => ({
  isCancelMock: vi.fn(() => false),
  sdkSpawnMock: vi.fn(),
  selectMock: vi.fn(),
  spawnResult: { stdout: "", stderr: "", exitCode: 0 }
}));

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    isCancel: isCancelMock,
    select: selectMock
  };
});

vi.mock("../../sdk/spawn.js", () => ({
  spawn: sdkSpawnMock
}));

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const volume = Volume.fromJSON(files, "/");
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

async function withMockedStdin<T>(run: () => Promise<T>, isTTY: boolean): Promise<T> {
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: isTTY
  });

  try {
    return await run();
  } finally {
    if (stdinDescriptor !== undefined) {
      Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
    } else {
      Reflect.deleteProperty(process.stdin, "isTTY");
    }
  }
}

describe("buildPlanPrompt", () => {
  it("embeds the skill content, plan directory, and question", () => {
    const prompt = buildPlanPrompt({
      question: "Design a todo CLI",
      planDirectory: "docs/plans",
      skillContent: "SKILL BODY"
    });

    expect(prompt).toContain("SKILL BODY");
    expect(prompt).toContain("docs/plans");
    expect(prompt).toContain("Design a todo CLI");
  });

  it("emits a Plan directory line so the agent uses the configured directory", () => {
    const prompt = buildPlanPrompt({
      question: "anything",
      planDirectory: "custom/plans",
      skillContent: "SKILL"
    });

    expect(prompt).toContain("Plan directory: custom/plans");
  });

  it("prompts the agent to ask the user when no question is given", () => {
    const prompt = buildPlanPrompt({
      question: "",
      planDirectory: "docs/plans",
      skillContent: "SKILL BODY"
    });

    expect(prompt).toContain("What do you want to plan");
  });
});

describe("plan <question> root command", () => {
  afterEach(() => {
    vi.clearAllMocks();
    isCancelMock.mockReset();
    isCancelMock.mockReturnValue(false);
    selectMock.mockReset();
    sdkSpawnMock.mockReset();
  });

  it("uses the fallback plan agent with --yes and the skill-loaded prompt", async () => {
    sdkSpawnMock.mockReturnValue({
      events: (async function* () {})(),
      result: Promise.resolve(spawnResult)
    });

    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await withMockedStdin(
      () => program.parseAsync(["node", "cli", "--yes", "plan", "Design a todo CLI"]),
      true
    );

    expect(sdkSpawnMock).toHaveBeenCalledTimes(1);
    const [agent, prompt, options] = sdkSpawnMock.mock.calls[0]!;
    expect(agent).toBe("claude-code");
    expect(options).toMatchObject({ interactive: true, cwd });
    expect(prompt).toContain(planSkillTemplate);
    expect(prompt).toContain("Plan directory: docs/plans");
    expect(prompt).toContain("Design a todo CLI");
  });

  it("prompts for the plan agent when a question omits --agent and --yes", async () => {
    selectMock.mockResolvedValue("codex");
    sdkSpawnMock.mockReturnValue({
      events: (async function* () {})(),
      result: Promise.resolve(spawnResult)
    });

    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await withMockedStdin(
      () => program.parseAsync(["node", "cli", "plan", "Design a todo CLI"]),
      true
    );

    expect(selectMock).toHaveBeenCalledWith({
      message: "Select agent to draft the plan with:",
      options: expect.arrayContaining([{ value: "codex", label: "codex" }])
    });
    expect(sdkSpawnMock).toHaveBeenCalledWith(
      "codex",
      expect.any(String),
      expect.objectContaining({ interactive: true })
    );
  });

  it("uses core.defaultAgent for plan sessions with --yes", async () => {
    sdkSpawnMock.mockReturnValue({
      events: (async function* () {})(),
      result: Promise.resolve(spawnResult)
    });

    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/config.json": JSON.stringify({
          core: { defaultAgent: "codex:openai/gpt-5.4" }
        })
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await withMockedStdin(
      () => program.parseAsync(["node", "cli", "--yes", "plan", "Design a todo CLI"]),
      true
    );

    expect(selectMock).not.toHaveBeenCalled();
    expect(sdkSpawnMock).toHaveBeenCalledWith(
      "codex",
      expect.any(String),
      expect.objectContaining({ interactive: true })
    );
  });

  it("uses the plan.plan_directory config value when set", async () => {
    sdkSpawnMock.mockReturnValue({
      events: (async function* () {})(),
      result: Promise.resolve(spawnResult)
    });

    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/config.json": JSON.stringify({
          plan: { plan_directory: "custom/plans" }
        })
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await withMockedStdin(
      () => program.parseAsync(["node", "cli", "--yes", "plan", "Build feature X"]),
      true
    );

    expect(sdkSpawnMock).toHaveBeenCalledTimes(1);
    const prompt = sdkSpawnMock.mock.calls[0]![1] as string;
    expect(prompt).toContain("Plan directory: custom/plans");
  });

  it("honors --agent override", async () => {
    sdkSpawnMock.mockReturnValue({
      events: (async function* () {})(),
      result: Promise.resolve(spawnResult)
    });

    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await withMockedStdin(
      () =>
        program.parseAsync([
          "node",
          "cli",
          "plan",
          "question",
          "--agent",
          "codex"
        ]),
      true
    );

    expect(sdkSpawnMock).toHaveBeenCalledWith(
      "codex",
      expect.any(String),
      expect.objectContaining({ interactive: true })
    );
  });

  it("previews a plan session without spawning an agent", async () => {
    const logs: string[] = [];
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "--yes",
      "plan",
      "write a small plan",
      "--agent",
      "codex"
    ]);

    expect(sdkSpawnMock).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("Dry run");
    expect(logs.join("\n")).toContain("codex");
  });

  it("refuses to launch an interactive plan session without a TTY", async () => {
    sdkSpawnMock.mockReturnValue({
      events: (async function* () {})(),
      result: Promise.resolve(spawnResult)
    });

    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await withMockedStdin(
      () =>
        expect(
          program.parseAsync(["node", "cli", "--yes", "plan", "Design a todo CLI"])
        ).rejects.toThrow(/interactive TTY/),
      false
    );

    expect(sdkSpawnMock).not.toHaveBeenCalled();
  });

  it("previews a plan session without a TTY because dry run never spawns", async () => {
    const logs: string[] = [];
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await withMockedStdin(
      () =>
        program.parseAsync([
          "node",
          "cli",
          "--dry-run",
          "--yes",
          "plan",
          "Design a todo CLI",
          "--agent",
          "codex"
        ]),
      false
    );

    expect(sdkSpawnMock).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("Dry run");
  });

  it("does not spawn when no question is given and --yes is passed", async () => {
    sdkSpawnMock.mockReturnValue({
      events: (async function* () {})(),
      result: Promise.resolve(spawnResult)
    });

    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "--yes", "plan"])
    ).rejects.toThrow(/question/i);

    expect(sdkSpawnMock).not.toHaveBeenCalled();
  });
});
