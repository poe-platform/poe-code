import { afterEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { registerRalphCommand } from "./ralph.js";
import { ValidationError } from "../errors.js";

const selectMock = vi.hoisted(() => vi.fn());
const promptTextMock = vi.hoisted(() => vi.fn());
const isCancelMock = vi.hoisted(() => vi.fn().mockReturnValue(false));
const cancelMock = vi.hoisted(() => vi.fn());

vi.mock("../../sdk/ralph.js", () => ({
  runRalph: vi.fn().mockResolvedValue({
    stopReason: "max_iterations",
    docPath: ".poe-code/ralph/plans/plan-a.md",
    iterationsCompleted: 3,
    totalDurationMs: 1000
  })
}));

vi.mock("@poe-code/design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/design-system")>();
  return {
    ...actual,
    select: selectMock,
    promptText: promptTextMock,
    isCancel: isCancelMock,
    cancel: cancelMock
  };
});

import { runRalph as sdkRunRalph } from "../../sdk/ralph.js";

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

describe("ralph run command", () => {
  afterEach(() => {
    vi.clearAllMocks();
    isCancelMock.mockReturnValue(false);
  });

  it("calls the Ralph SDK with explicit CLI options", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "ralph",
      "run",
      "5",
      "docs/loop.md",
      "--agent",
      "claude",
      "--model",
      "gpt-5.2",
      "--max-failures",
      "4"
    ]);

    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        cwd,
        homeDir,
        docPath: "docs/loop.md",
        maxIterations: 5,
        model: "gpt-5.2",
        maxFailures: 4
      })
    );
  });

  it("prompts for missing agent, doc, and iterations", async () => {
    selectMock
      .mockResolvedValueOnce("codex")
      .mockResolvedValueOnce(".poe-code/ralph/plans/plan-a.md");
    promptTextMock.mockResolvedValue("4");

    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/ralph/plans/plan-b.md": "# B",
        "/repo/.poe-code/ralph/plans/plan-a.md": "# A"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "ralph", "run"]);

    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(promptTextMock).toHaveBeenCalledWith({
      message: "How many Ralph iterations should run?"
    });
    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex",
        docPath: ".poe-code/ralph/plans/plan-a.md",
        maxIterations: 4
      })
    );
  });

  it("uses defaults with --yes where a default exists", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/ralph/plans/plan-b.md": "# B",
        "/repo/.poe-code/ralph/plans/plan-a.md": "# A"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "ralph", "run", "3"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(promptTextMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        docPath: ".poe-code/ralph/plans/plan-a.md",
        maxIterations: 3
      })
    );
  });

  it("requires iterations when using --yes without an explicit value", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/ralph/plans/plan-a.md": "# A"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "--yes", "ralph", "run"])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects invalid max-failures values", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "ralph",
        "run",
        "2",
        "docs/loop.md",
        "--max-failures",
        "0"
      ])
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
