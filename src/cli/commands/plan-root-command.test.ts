import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { stripVTControlCharacters } from "node:util";
import { Volume, createFsFromVolume } from "memfs";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { SilentError } from "../errors.js";
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

    await withMockedStdin(
      () => program.parseAsync(["node", "cli", "--yes", "plan", "Design a todo CLI"]),
      true
    );

    expect(sdkSpawnMock).toHaveBeenCalledTimes(1);
    expect(runPlanBrowserMock).not.toHaveBeenCalled();
  });

  it("reports a typo'd subcommand as unknown instead of drafting a plan", async () => {
    let loggerOutput = "";
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        loggerOutput += `${message}\n`;
      }
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await expect(
      withMockedStdin(() => program.parseAsync(["node", "cli", "plan", "lst"]), false)
    ).rejects.toBeInstanceOf(SilentError);

    const plain = stripVTControlCharacters(loggerOutput);
    expect(plain).toContain("Unknown command:");
    expect(plain).toContain("lst");
    expect(plain).toContain("Did you mean:");
    expect(plain).toContain("list");
    expect(sdkSpawnMock).not.toHaveBeenCalled();
    expect(runPlanBrowserMock).not.toHaveBeenCalled();
  });

  it("renders a plan when browse is given a path", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs: createMemFs({ "/repo/docs/plans/plan-a.md": "# Plan A\n\nPlan body line." }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await withMockedStdin(
      () => program.parseAsync(["node", "cli", "plan", "browse", "docs/plans/plan-a.md"]),
      false
    );

    const output = stripVTControlCharacters(
      writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("")
    );
    expect(output).toContain("Plan A");
    expect(output).toContain("Plan body line.");
    expect(runPlanBrowserMock).not.toHaveBeenCalled();
  });

  it("reports an unknown plan path passed to browse", async () => {
    const container = createCliContainer({
      fs: createMemFs({ "/repo/docs/plans/plan-a.md": "# Plan A" }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await expect(
      withMockedStdin(
        () => program.parseAsync(["node", "cli", "plan", "browse", "docs/plans/missing.md"]),
        false
      )
    ).rejects.toThrow("Plan not found: docs/plans/missing.md");

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
    expect(browseCommand?.description()).toBe(
      "Browse plans in the interactive explorer, or render one plan when given a path."
    );

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

    await withMockedStdin(() => program.parseAsync(["node", "cli", "plan"]), true);

    expect(runPlanBrowserMock).toHaveBeenCalledTimes(1);
    expect(runPlanBrowserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        onCreatePlan: expect.any(Function)
      })
    );
    expect(sdkSpawnMock).not.toHaveBeenCalled();

    const browserOptions = runPlanBrowserMock.mock.calls[0]![0];
    await withMockedStdin(() => browserOptions.onCreatePlan!(), true);

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

  it("rejects browser-created plan question prompts in non-interactive mode", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await withMockedStdin(() => program.parseAsync(["node", "cli", "plan"]), true);

    const browserOptions = runPlanBrowserMock.mock.calls[0]![0];
    await expect(withMockedStdin(() => browserOptions.onCreatePlan!(), false)).rejects.toThrow(
      "Plan question prompt requires a question when running without an interactive TTY."
    );

    expect(promptTextMock).not.toHaveBeenCalled();
    expect(sdkSpawnMock).not.toHaveBeenCalled();
  });

  it("rejects missing session agent selection in non-interactive mode", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await expect(
      withMockedStdin(() => program.parseAsync(["node", "cli", "plan", "Design a todo CLI"]), false)
    ).rejects.toThrow(
      "Plan session agent selection requires --agent or --yes when running without an interactive TTY."
    );

    expect(selectMock).not.toHaveBeenCalled();
    expect(sdkSpawnMock).not.toHaveBeenCalled();
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

  it("refuses to browse with --yes and lists the candidate plans", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/plan-a.md": "# Plan A",
        "/repo/docs/plans/plan-b.md": "# Plan B"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    // Plans are listed newest-first, so their relative order depends on mtime.
    // Assert both candidates are listed without pinning the order.
    const error = await withMockedStdin(
      () => program.parseAsync(["node", "cli", "--yes", "plan", "browse"]),
      true
    ).catch((thrown: unknown) => thrown as Error);

    expect(error.message).toContain("Name the plan you want");
    expect(error.message).toContain("docs/plans/plan-a.md");
    expect(error.message).toContain("docs/plans/plan-b.md");

    expect(runPlanBrowserMock).not.toHaveBeenCalled();
  });

  it("refuses to browse without an interactive TTY and lists the candidate plans", async () => {
    const container = createCliContainer({
      fs: createMemFs({ "/repo/docs/plans/plan-a.md": "# Plan A" }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await expect(
      withMockedStdin(() => program.parseAsync(["node", "cli", "plan", "browse"]), false)
    ).rejects.toThrow(/docs\/plans\/plan-a\.md/);

    expect(runPlanBrowserMock).not.toHaveBeenCalled();
  });

  it("refuses the root plan command without a question when stdin is not a TTY", async () => {
    const container = createCliContainer({
      fs: createMemFs({ "/repo/docs/plans/plan-a.md": "# Plan A" }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await expect(
      withMockedStdin(() => program.parseAsync(["node", "cli", "plan"]), false)
    ).rejects.toThrow(/docs\/plans\/plan-a\.md/);

    expect(runPlanBrowserMock).not.toHaveBeenCalled();
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

    await withMockedStdin(
      () => program.parseAsync(["node", "cli", "plan", "browse", "--kind", "ralph"]),
      true
    );

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

    await withMockedStdin(
      () => program.parseAsync(["node", "cli", "plan", "browse", "--kind", "superintendent"]),
      true
    );

    expect(runPlanBrowserMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "superintendent" })
    );
  });
});
