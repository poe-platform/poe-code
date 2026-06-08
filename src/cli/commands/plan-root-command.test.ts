import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { Volume, createFsFromVolume } from "memfs";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { registerPlanCommand } from "./plan.js";

const { runPlanBrowserMock, sdkSpawnMock, promptTextMock, selectMock, isCancelMock, spawnResult } = vi.hoisted(
  () => ({
    runPlanBrowserMock: vi.fn().mockResolvedValue(undefined),
    sdkSpawnMock: vi.fn(),
    promptTextMock: vi.fn(),
    selectMock: vi.fn(),
    isCancelMock: vi.fn(() => false),
    spawnResult: { stdout: "", stderr: "", exitCode: 0 }
  })
);

vi.mock("@poe-code/plan-browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/plan-browser")>();
  return {
    ...actual,
    runPlanBrowser: runPlanBrowserMock
  };
});

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    intro: vi.fn(),
    isCancel: isCancelMock,
    promptText: promptTextMock,
    select: selectMock
  };
});

vi.mock("../../sdk/spawn.js", () => ({
  spawn: sdkSpawnMock
}));

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const volume = Volume.fromJSON({}, "/");
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

describe("plan root and browse commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    sdkSpawnMock.mockReset();
    promptTextMock.mockReset();
    selectMock.mockReset();
    isCancelMock.mockReset();
    isCancelMock.mockReturnValue(false);
  });

  it("spawns a plan session for a question without opening the browser", async () => {
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

    await program.parseAsync(["node", "cli", "--yes", "plan", "Design a todo CLI"]);

    expect(sdkSpawnMock).toHaveBeenCalledTimes(1);
    expect(runPlanBrowserMock).not.toHaveBeenCalled();
  });

  it("documents the default explorer flow in help", () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    const planCommand = program.commands.find((command) => command.name() === "plan");
    const browseCommand = planCommand?.commands.find((command) => command.name() === "browse");

    expect(planCommand?.description()).toBe(
      "Browse plans in an interactive explorer, or draft a new plan when given a question."
    );
    expect(browseCommand?.description()).toBe("Browse plans in the interactive explorer.");

    const helpChunks: string[] = [];
    planCommand?.configureOutput({
      writeOut: (chunk) => {
        helpChunks.push(chunk);
      }
    });
    planCommand?.outputHelp();

    expect(helpChunks.join("")).toContain("Explorer keymap: e edit, a archive, d delete, n new");
  });

  it("throws when --yes is passed without a question", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await expect(program.parseAsync(["node", "cli", "--yes", "plan"])).rejects.toThrow(
      "A question is required for `poe-code plan`. Pass it as the first argument."
    );

    expect(sdkSpawnMock).not.toHaveBeenCalled();
    expect(runPlanBrowserMock).not.toHaveBeenCalled();
  });

  it("opens the browser with a new-plan action when no question is given interactively", async () => {
    sdkSpawnMock.mockReturnValue({
      events: (async function* () {})(),
      result: Promise.resolve(spawnResult)
    });
    promptTextMock.mockResolvedValue("Draft plan from browser");
    selectMock.mockResolvedValue("codex");
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync(["node", "cli", "plan"]);

    expect(runPlanBrowserMock).toHaveBeenCalledTimes(1);
    expect(runPlanBrowserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assumeYes: false,
        onCreatePlan: expect.any(Function)
      })
    );
    expect(sdkSpawnMock).not.toHaveBeenCalled();

    const browserOptions = runPlanBrowserMock.mock.calls[0]![0];
    await browserOptions.onCreatePlan!();

    expect(promptTextMock).toHaveBeenCalledWith({
      message: "What do you want to plan?"
    });
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

  it("rejects an invalid root --kind value", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await expect(program.parseAsync(["node", "cli", "plan", "--kind", "invalid"])).rejects.toThrow(
      'Invalid --kind value "invalid". Expected plan, pipeline, experiment, ralph, superintendent, superintendent-base.'
    );

    expect(sdkSpawnMock).not.toHaveBeenCalled();
    expect(runPlanBrowserMock).not.toHaveBeenCalled();
  });

  it("passes assumeYes to the browser for --yes", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "plan", "browse"]);

    expect(runPlanBrowserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assumeYes: true
      })
    );
  });

  it("forwards --kind to the browser", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync(["node", "cli", "plan", "browse", "--kind", "ralph"]);

    expect(runPlanBrowserMock).toHaveBeenCalledWith(expect.objectContaining({ kind: "ralph" }));
  });

  it("forwards superintendent kinds to the browser", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync(["node", "cli", "plan", "browse", "--kind", "superintendent"]);

    expect(runPlanBrowserMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "superintendent" })
    );
  });
});
