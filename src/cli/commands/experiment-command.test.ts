import { afterEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { registerExperimentCommand } from "./experiment.js";
import { ValidationError } from "../errors.js";

const selectMock = vi.hoisted(() => vi.fn());
const isCancelMock = vi.hoisted(() => vi.fn().mockReturnValue(false));
const cancelMock = vi.hoisted(() => vi.fn());

vi.mock("../../sdk/experiment.js", () => ({
  runExperiment: vi.fn().mockResolvedValue({
    stopReason: "max_experiments",
    docPath: ".poe-code/experiments/plan-a.md",
    experimentsCompleted: 2,
    experimentsKept: 1,
    totalDurationMs: 1000
  }),
  readExperimentJournal: vi.fn().mockResolvedValue([])
}));

vi.mock("@poe-code/design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/design-system")>();
  return {
    ...actual,
    select: selectMock,
    isCancel: isCancelMock,
    cancel: cancelMock
  };
});

import {
  runExperiment as sdkRunExperiment,
  readExperimentJournal as sdkReadExperimentJournal
} from "../../sdk/experiment.js";

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

describe("experiment run command", () => {
  afterEach(() => {
    vi.clearAllMocks();
    isCancelMock.mockReturnValue(false);
  });

  it("calls the experiment SDK with explicit CLI options and logs progress hooks", async () => {
    vi.mocked(sdkRunExperiment).mockImplementationOnce(async (options) => {
      options.onExperimentStart?.(1, "claude-code");
      options.onExperimentComplete?.(1, {
        commit: "abc123",
        status: "keep",
        score: 2,
        output: "tests: score=2, passed=true",
        durationMs: 1500,
        timestamp: "2026-04-01T00:00:00.000Z"
      });

      return {
        stopReason: "max_experiments",
        docPath: options.docPath,
        experimentsCompleted: 1,
        experimentsKept: 1,
        totalDurationMs: 1500
      };
    });

    let loggerOutput = "";
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": "# Loop"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        loggerOutput += `${message}\n`;
      }
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "experiment",
      "run",
      "docs/loop.md",
      "--agent",
      "claude",
      "--model",
      "gpt-5.2",
      "--max-experiments",
      "5"
    ]);

    expect(vi.mocked(sdkRunExperiment)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        cwd,
        homeDir,
        docPath: "docs/loop.md",
        model: "gpt-5.2",
        maxExperiments: 5,
        onExperimentStart: expect.any(Function),
        onExperimentComplete: expect.any(Function)
      })
    );
    expect(loggerOutput).toContain("Experiment 1 (claude-code)");
    expect(loggerOutput).toContain("Experiment 1 keep");
    expect(loggerOutput).toContain("Experiments: 1");
    expect(loggerOutput).toContain("Kept: 1");
  });

  it("rejects malformed max-experiments values before starting the loop", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": "# Loop"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "experiment",
        "run",
        "docs/loop.md",
        "--agent",
        "claude",
        "--max-experiments",
        "1.5"
      ])
    ).rejects.toBeInstanceOf(ValidationError);

    expect(vi.mocked(sdkRunExperiment)).not.toHaveBeenCalled();
  });

  it("discovers the first doc and default agent with --yes", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/experiments/plan-b.md": "# B",
        "/repo/.poe-code/experiments/plan-a.md": "# A"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "experiment", "run"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunExperiment)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        docPath: ".poe-code/experiments/plan-a.md"
      })
    );
  });

  it("prompts for missing doc and agent when frontmatter does not provide them", async () => {
    selectMock
      .mockResolvedValueOnce(".poe-code/experiments/plan-a.md")
      .mockResolvedValueOnce("codex");

    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/experiments/plan-b.md": "# B",
        "/repo/.poe-code/experiments/plan-a.md": "# A"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await program.parseAsync(["node", "cli", "experiment", "run"]);

    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(selectMock).toHaveBeenNthCalledWith(1, {
      message: "Select the experiment doc to run:",
      options: [
        {
          label: ".poe-code/experiments/plan-a.md",
          value: ".poe-code/experiments/plan-a.md"
        },
        {
          label: ".poe-code/experiments/plan-b.md",
          value: ".poe-code/experiments/plan-b.md"
        }
      ]
    });
    expect(selectMock).toHaveBeenNthCalledWith(2, {
      message: "Select agent to run the experiment with:",
      options: [
        { label: "claude-code", value: "claude-code" },
        { label: "codex", value: "codex" },
        { label: "opencode", value: "opencode" },
        { label: "kimi", value: "kimi" }
      ]
    });
    expect(vi.mocked(sdkRunExperiment)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex",
        docPath: ".poe-code/experiments/plan-a.md"
      })
    );
  });

  it("fails before prompting when no experiment docs exist", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await expect(program.parseAsync(["node", "cli", "experiment", "run"])).rejects.toBeInstanceOf(
      ValidationError
    );

    expect(selectMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunExperiment)).not.toHaveBeenCalled();
  });
});

describe("experiment journal command", () => {
  afterEach(() => {
    vi.clearAllMocks();
    isCancelMock.mockReturnValue(false);
  });

  it("renders the experiment journal as a table", async () => {
    vi.mocked(sdkReadExperimentJournal).mockResolvedValueOnce([
      {
        commit: "abc1234",
        status: "keep",
        score: 2,
        output: "tests: score=2, passed=true",
        durationMs: 1500,
        timestamp: "2026-04-01T00:00:00.000Z"
      },
      {
        commit: "def5678",
        status: "discard",
        score: 1,
        output: "tests: score=1, passed=true",
        durationMs: 900,
        timestamp: "2026-04-01T00:10:00.000Z"
      }
    ]);

    let loggerOutput = "";
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": "# Loop"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        loggerOutput += `${message}\n`;
      }
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await program.parseAsync(["node", "cli", "experiment", "journal", "docs/loop.md"]);

    expect(vi.mocked(sdkReadExperimentJournal)).toHaveBeenCalledWith({
      cwd,
      homeDir,
      docPath: "docs/loop.md"
    });
    expect(loggerOutput).toContain("#");
    expect(loggerOutput).toContain("status");
    expect(loggerOutput).toContain("abc1234");
    expect(loggerOutput).toContain("discard");
  });

  it("discovers the first doc with --yes", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/experiments/plan-b.md": "# B",
        "/repo/.poe-code/experiments/plan-a.md": "# A"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "experiment", "journal"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkReadExperimentJournal)).toHaveBeenCalledWith({
      cwd,
      homeDir,
      docPath: ".poe-code/experiments/plan-a.md"
    });
  });
});
