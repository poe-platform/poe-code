import { afterEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { registerExperimentCommand } from "./experiment.js";
import { registerRalphCommand } from "./ralph.js";
import { allSpawnConfigs } from "@poe-code/agent-spawn";
import { ValidationError } from "../errors.js";
import type { Dashboard } from "@poe-code/design-system";
import experimentSkillPlan from "../../templates/experiment/SKILL_experiment.md";
import experimentRunYaml from "../../templates/experiment/run.yaml.mustache";
import { parseFrontmatter } from "../../../packages/ralph/src/frontmatter/frontmatter.js";

const {
  selectMock,
  promptTextMock,
  isCancelMock,
  cancelMock
} = vi.hoisted(() => ({
  selectMock: vi.fn(),
  promptTextMock: vi.fn(),
  isCancelMock: vi.fn(() => false),
  cancelMock: vi.fn()
}));

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

vi.mock("../../sdk/ralph.js", () => ({
  runRalph: vi.fn().mockResolvedValue({
    stopReason: "max_iterations",
    docPath: ".poe-code/ralph/plans/plan-a.md",
    iterationsCompleted: 3,
    totalDurationMs: 1000
  })
}));

vi.mock("../../sdk/spawn.js", () => ({
  spawn: Object.assign(vi.fn(), {
    autonomous: vi.fn()
  })
}));

vi.mock("@poe-code/design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/design-system")>();
  return {
    ...actual,
    createDashboard: vi.fn(),
    select: selectMock,
    promptText: promptTextMock,
    isCancel: isCancelMock,
    cancel: cancelMock
  };
});

import {
  runExperiment as sdkRunExperiment,
  readExperimentJournal as sdkReadExperimentJournal
} from "../../sdk/experiment.js";
import { runRalph as sdkRunRalph } from "../../sdk/ralph.js";
import { spawn as sdkSpawn } from "../../sdk/spawn.js";
import { acp, createDashboard, withOutputFormat } from "@poe-code/design-system";

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

function getSpawnAgentOptions() {
  return allSpawnConfigs.map((config) => ({
    label: config.agentId,
    value: config.agentId
  }));
}

function withMockedTerminal<T>(
  run: () => Promise<T>,
  options: { stdin?: boolean; stdout?: boolean } = {}
): Promise<T> {
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: options.stdin ?? true
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: options.stdout ?? true
  });

  return run().finally(() => {
    if (stdinDescriptor) {
      Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
    } else {
      delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
    }

    if (stdoutDescriptor) {
      Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
    } else {
      delete (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY;
    }
  });
}

function createDashboardMock(): {
  dashboard: Dashboard;
  appendOutput: ReturnType<typeof vi.fn>;
  updateStats: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  onCommand: ReturnType<typeof vi.fn>;
  commandHandlers: Array<(command: string) => void>;
} {
  const appendOutput = vi.fn();
  const updateStats = vi.fn();
  const start = vi.fn();
  const stop = vi.fn();
  const destroy = vi.fn();
  const commandHandlers: Array<(command: string) => void> = [];
  const onCommand = vi.fn((handler: (command: string) => void) => {
    commandHandlers.push(handler);
  });

  return {
    dashboard: {
      appendOutput,
      updateStats,
      start,
      stop,
      destroy,
      onCommand
    },
    appendOutput,
    updateStats,
    start,
    stop,
    destroy,
    onCommand,
    commandHandlers
  };
}

const expectedTimestamp = (() => {
  const date = new Date(0);
  return `[${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}]`;
})();
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
      "--max-experiments",
      "5"
    ]);

    expect(vi.mocked(sdkRunExperiment)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        cwd,
        homeDir,
        docPath: "docs/loop.md",
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

  it("discovers docs from the home experiments directory when no local docs exist", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/home/test/.poe-code/experiments/plan-a.md": "# A"
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
        docPath: "~/.poe-code/experiments/plan-a.md"
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
      options: getSpawnAgentOptions()
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

  it("routes experiment progress through the dashboard when --tui is enabled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const dashboardMock = createDashboardMock();
    vi.mocked(createDashboard).mockReturnValueOnce(dashboardMock.dashboard);

    vi.mocked(sdkRunExperiment).mockImplementationOnce(async (options) => {
      options.onExperimentStart?.(1, "claude-code");
      options.onBaselineCollected?.({ accuracy: 0.91, latency: 120 });
      options.onMetricResult?.(
        { name: "accuracy", script: "npm run eval", direction: "maximize" },
        { score: 0.94, passed: true, output: "ok" }
      );
      options.onCommit?.("abc1234def");
      options.onExperimentComplete?.(1, {
        commit: "abc1234def",
        status: "keep",
        scores: { accuracy: 0.94, latency: 110 },
        output: "ok",
        agentOutput: "done",
        durationMs: 2_000,
        timestamp: "2026-04-01T00:00:00.000Z"
      });

      return {
        stopReason: "max_experiments",
        docPath: options.docPath,
        experimentsCompleted: 1,
        experimentsKept: 1,
        totalDurationMs: 2_000
      };
    });

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

    await withMockedTerminal(() =>
      program.parseAsync([
        "node",
        "cli",
        "experiment",
        "run",
        "docs/loop.md",
        "--agent",
        "claude",
        "--max-experiments",
        "5",
        "--tui"
      ])
    );

    expect(vi.mocked(createDashboard)).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Experiment",
        statsTitle: "Run",
        hints: [
          { key: "q", label: "Quit" },
          { key: "↑↓", label: "Scroll" },
          { key: "F", label: "Follow" }
        ]
      })
    );
    expect(dashboardMock.start).toHaveBeenCalledTimes(1);
    expect(dashboardMock.onCommand).toHaveBeenCalledTimes(1);
    expect(dashboardMock.appendOutput.mock.calls.map(([item]) => item)).toEqual([
      {
        kind: "info",
        text: `${expectedTimestamp} Config · Agent: claude-code · Max experiments: 5 · Doc: docs/loop.md`,
        ts: 0
      },
      {
        kind: "status",
        text: `${expectedTimestamp} Experiment 1/5 (claude-code)`,
        ts: 0
      },
      {
        kind: "info",
        text: `${expectedTimestamp} Baseline collected: accuracy=0.91, latency=120`,
        ts: 0
      },
      {
        kind: "info",
        text: `${expectedTimestamp} accuracy: 0.94 (passed)`,
        ts: 0
      },
      {
        kind: "info",
        text: `${expectedTimestamp} Committed abc1234`,
        ts: 0
      },
      {
        kind: "success",
        text: `${expectedTimestamp} Experiment 1 keep in 2s · scores: accuracy=0.94, latency=110`,
        ts: 0
      }
    ]);
    expect(dashboardMock.updateStats).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "done",
        iterations: 1,
        tokensIn: 0,
        tokensOut: 0,
        currentAction: "Experiment 1/5 · claude-code"
      })
    );
    expect(vi.mocked(sdkRunExperiment)).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
    expect(dashboardMock.stop).toHaveBeenCalledTimes(1);
    expect(dashboardMock.destroy).toHaveBeenCalledTimes(1);
  });

  it("falls back to the logger path when --tui is used without a TTY stdout", async () => {
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

    await withMockedTerminal(
      () =>
        program.parseAsync([
          "node",
          "cli",
          "experiment",
          "run",
          "docs/loop.md",
          "--agent",
          "claude",
          "--max-experiments",
          "5",
          "--tui"
        ]),
      { stdout: false }
    );

    expect(vi.mocked(createDashboard)).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunExperiment)).toHaveBeenCalledWith(
      expect.not.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("streams experiment child-agent output into the dashboard via ACP writer and stderr tee", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const dashboardMock = createDashboardMock();
    vi.mocked(createDashboard).mockReturnValueOnce(dashboardMock.dashboard);

    vi.mocked(sdkSpawn.autonomous).mockImplementationOnce(async (_agent, input) => {
      acp.getAcpWriter()("Running experiment step");
      acp.getAcpWriter()("Evaluating metrics");
      input.tee?.stderr?.write("Metric warning\npartial stderr");

      return {
        stdout: "",
        stderr: "",
        exitCode: 0
      };
    });

    vi.mocked(sdkRunExperiment).mockImplementationOnce(async (options) => {
      options.onExperimentStart?.(1, "claude-code");
      await options.runAgent?.({
        agent: "claude-code",
        prompt: "Run experiment iteration",
        cwd,
        signal: options.signal
      });
      options.onExperimentComplete?.(1, {
        commit: "abc1234def",
        status: "keep",
        scores: { accuracy: 0.95 },
        output: "ok",
        agentOutput: "done",
        durationMs: 2_000,
        timestamp: "2026-04-01T00:00:00.000Z"
      });

      return {
        stopReason: "max_experiments",
        docPath: options.docPath,
        experimentsCompleted: 1,
        experimentsKept: 1,
        totalDurationMs: 2_000
      };
    });

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

    await withMockedTerminal(() =>
      program.parseAsync([
        "node",
        "cli",
        "experiment",
        "run",
        "docs/loop.md",
        "--agent",
        "claude",
        "--max-experiments",
        "3",
        "--tui"
      ])
    );

    expect(vi.mocked(sdkRunExperiment)).toHaveBeenCalledWith(
      expect.objectContaining({
        runAgent: expect.any(Function),
        signal: expect.any(AbortSignal)
      })
    );
    expect(vi.mocked(sdkSpawn.autonomous)).toHaveBeenCalledWith(
      "claude-code",
      expect.objectContaining({
        prompt: "Run experiment iteration",
        cwd,
        mode: "yolo",
        signal: expect.any(AbortSignal),
        useStdin: true,
        tee: expect.objectContaining({
          stderr: expect.any(Object)
        })
      })
    );

    const outputs = dashboardMock.appendOutput.mock.calls.map(([item]) => item);
    expect(
      outputs.some((item) =>
        item.kind === "tool"
        && item.text.includes("[experiment:1] Running experiment step")
      )
    ).toBe(true);
    expect(
      outputs.some((item) =>
        item.kind === "tool"
        && item.text.includes("[experiment:1] Evaluating metrics")
      )
    ).toBe(true);
    expect(
      outputs.some((item) =>
        item.kind === "error"
        && item.text.includes("[experiment:1] Metric warning")
      )
    ).toBe(true);
    expect(
      outputs.some((item) =>
        item.kind === "error"
        && item.text.includes("[experiment:1] partial stderr")
      )
    ).toBe(true);
  });

  it("aborts experiment when the dashboard quit command is used", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const dashboardMock = createDashboardMock();
    vi.mocked(createDashboard).mockReturnValueOnce(dashboardMock.dashboard);

    vi.mocked(sdkRunExperiment).mockImplementationOnce(async (options) => {
      dashboardMock.commandHandlers[0]?.("quit");

      expect(options.signal?.aborted).toBe(true);

      return {
        stopReason: "cancelled",
        docPath: options.docPath,
        experimentsCompleted: 0,
        experimentsKept: 0,
        totalDurationMs: 1_000
      };
    });

    const logs: string[] = [];
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": "# Loop"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await withMockedTerminal(() =>
      program.parseAsync([
        "node",
        "cli",
        "experiment",
        "run",
        "docs/loop.md",
        "--agent",
        "claude",
        "--max-experiments",
        "5",
        "--tui"
      ])
    );

    expect(dashboardMock.appendOutput).toHaveBeenCalledWith({
      kind: "status",
      text: `${expectedTimestamp} Cancellation requested`,
      ts: 0
    });
    expect(process.exitCode).toBe(130);
    expect(logs.some((message) => message.includes("Experiment run cancelled."))).toBe(true);
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

describe("experiment validate command", () => {
  afterEach(() => {
    vi.clearAllMocks();
    isCancelMock.mockReturnValue(false);
  });

  it("validates a valid experiment doc and reports success", async () => {
    let loggerOutput = "";
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": [
          "---",
          "agent: claude-code",
          "metric:",
          "  name: tests",
          "  script: npm test",
          "  direction: maximize",
          "baseline: null",
          "status:",
          "  state: open",
          "  experiment: 0",
          "  kept: 0",
          "---",
          "# Loop"
        ].join("\n")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        loggerOutput += `${message}\n`;
      }
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await program.parseAsync(["node", "cli", "experiment", "validate", "docs/loop.md"]);

    expect(loggerOutput).toContain("claude-code");
    expect(loggerOutput).toContain("tests: npm test (maximize)");
    expect(loggerOutput).toContain("valid");
  });

  it("reports errors for missing required fields", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/bad.md": [
          "---",
          "baseline: null",
          "status:",
          "  state: open",
          "  experiment: 0",
          "  kept: 0",
          "---",
          "# Bad"
        ].join("\n")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "experiment", "validate", "docs/bad.md"])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("reports status inconsistency when kept exceeds experiment count", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/inconsistent.md": [
          "---",
          "agent: claude-code",
          "metric:",
          "  name: tests",
          "  direction: maximize",
          "baseline: null",
          "status:",
          "  state: open",
          "  experiment: 2",
          "  kept: 5",
          "---",
          "# Inconsistent"
        ].join("\n")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "experiment", "validate", "docs/inconsistent.md"])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("validates a chain of metrics", async () => {
    let loggerOutput = "";
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/chain.md": [
          "---",
          "agent: claude-code",
          "metric:",
          "  - name: tests",
          "    script: npm test",
          "    direction: maximize",
          "  - name: test_duration",
          "    script: npm run measure:duration",
          "    direction: minimize",
          "baseline: null",
          "status:",
          "  state: open",
          "  experiment: 0",
          "  kept: 0",
          "---",
          "# Chain"
        ].join("\n")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        loggerOutput += `${message}\n`;
      }
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await program.parseAsync(["node", "cli", "experiment", "validate", "docs/chain.md"]);

    expect(loggerOutput).toContain("tests: npm test (maximize)");
    expect(loggerOutput).toContain("test_duration: npm run measure:duration (minimize)");
    expect(loggerOutput).toContain("valid");
  });

  it("discovers doc with --yes", async () => {
    let loggerOutput = "";
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/experiments/plan-a.md": [
          "---",
          "agent: claude-code",
          "metric:",
          "  name: tests",
          "  script: npm test",
          "  direction: maximize",
          "baseline: null",
          "status:",
          "  state: open",
          "  experiment: 0",
          "  kept: 0",
          "---",
          "# A"
        ].join("\n")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        loggerOutput += `${message}\n`;
      }
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "experiment", "validate"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(loggerOutput).toContain("valid");
  });
});

describe("experiment install command", () => {
  afterEach(() => {
    vi.clearAllMocks();
    isCancelMock.mockReturnValue(false);
  });

  it("installs the experiment skill and scaffolds local experiments directory", async () => {
    const fs = createMemFs();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "experiment",
      "install",
      "--agent",
      "claude-code",
      "--local"
    ]);

    await expect(
      fs.readFile("/repo/.claude/skills/poe-code-experiment-plan/SKILL.md", "utf8")
    ).resolves.toBe(experimentSkillPlan);
    await expect(fs.stat("/repo/.poe-code/experiments")).resolves.toBeDefined();
    await expect(
      fs.readFile("/repo/.poe-code/experiments/run.yaml", "utf8")
    ).resolves.toBe(experimentRunYaml);
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
    registerExperimentCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "experiment", "install"]);

    await expect(
      fs.readFile("/repo/.claude/skills/poe-code-experiment-plan/SKILL.md", "utf8")
    ).resolves.toBe(experimentSkillPlan);
    await expect(fs.stat("/repo/.poe-code/experiments")).resolves.toBeDefined();
    await expect(
      fs.readFile("/repo/.poe-code/experiments/run.yaml", "utf8")
    ).resolves.toBe(experimentRunYaml);
  });

  it("rejects --local and --global together", async () => {
    const fs = createMemFs();
    const container = createCliContainer({
      fs,
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
        "install",
        "--local",
        "--global"
      ])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("installs to global scope when --global is specified", async () => {
    const fs = createMemFs();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "experiment",
      "install",
      "--agent",
      "claude-code",
      "--global"
    ]);

    await expect(
      fs.readFile("/home/test/.claude/skills/poe-code-experiment-plan/SKILL.md", "utf8")
    ).resolves.toBe(experimentSkillPlan);
    await expect(fs.stat("/home/test/.poe-code/experiments")).resolves.toBeDefined();
    await expect(
      fs.readFile("/home/test/.poe-code/experiments/run.yaml", "utf8")
    ).resolves.toBe(experimentRunYaml);
  });

  it("does not recreate experiments directory if it already exists", async () => {
    const fs = createMemFs();
    await fs.mkdir("/repo/.poe-code/experiments", { recursive: true });
    await fs.writeFile("/repo/.poe-code/experiments/existing.md", "# Existing", {
      encoding: "utf8"
    });

    let loggerOutput = "";
    const container = createCliContainer({
      fs,
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
      "install",
      "--agent",
      "claude-code",
      "--local"
    ]);

    await expect(
      fs.readFile("/repo/.poe-code/experiments/existing.md", "utf8")
    ).resolves.toBe("# Existing");
    await expect(
      fs.readFile("/repo/.claude/skills/poe-code-experiment-plan/SKILL.md", "utf8")
    ).resolves.toBe(experimentSkillPlan);
    const lines = loggerOutput.split("\n");
    expect(lines.some((l) => l.includes("Create: .poe-code/experiments") && !l.includes("run.yaml"))).toBe(false);
    await expect(
      fs.readFile("/repo/.poe-code/experiments/run.yaml", "utf8")
    ).resolves.toBe(experimentRunYaml);
  });
});

describe("ralph run command", () => {
  afterEach(() => {
    vi.clearAllMocks();
    isCancelMock.mockReturnValue(false);
    process.exitCode = undefined;
    vi.useRealTimers();
  });

  it("calls the Ralph SDK with explicit CLI options", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": "# Loop"
      }),
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
      "docs/loop.md",
      "--agent",
      "claude",
      "--iterations",
      "5"
    ]);

    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        cwd,
        homeDir,
        docPath: "docs/loop.md",
        maxIterations: 5
      })
    );
  });

  it("reads agent and iterations from frontmatter and skips prompts", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": [
          "---",
          "agent:",
          "  - claude-code",
          "  - codex",
          "iterations: 4",
          "status:",
          "  state: open",
          "  iteration: 0",
          "---",
          "# A"
        ].join("\n")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "ralph", "run", "docs/loop.md"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(promptTextMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: ["claude-code", "codex"],
        docPath: "docs/loop.md",
        maxIterations: 4
      })
    );
  });

  it("prompts for missing agent, doc, and iterations when frontmatter does not provide them", async () => {
    selectMock
      .mockResolvedValueOnce(".poe-code/ralph/plans/plan-a.md")
      .mockResolvedValueOnce("codex");
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
    expect(selectMock).toHaveBeenNthCalledWith(1, {
      message: "Select the Ralph markdown doc to run:",
      options: [
        {
          label: ".poe-code/ralph/plans/plan-a.md",
          value: ".poe-code/ralph/plans/plan-a.md"
        },
        {
          label: ".poe-code/ralph/plans/plan-b.md",
          value: ".poe-code/ralph/plans/plan-b.md"
        }
      ]
    });
    expect(selectMock).toHaveBeenNthCalledWith(2, {
      message: "Select agent to run Ralph with:",
      options: getSpawnAgentOptions()
    });
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

  it("shows frontmatter hints in the doc selection prompt", async () => {
    selectMock.mockResolvedValueOnce(".poe-code/ralph/plans/plan-a.md");

    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/ralph/plans/plan-a.md": [
          "---",
          "agent: codex",
          "iterations: 3",
          "status:",
          "  state: in_progress",
          "  iteration: 1",
          "---",
          "# A"
        ].join("\n"),
        "/repo/.poe-code/ralph/plans/plan-b.md": "# B"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "ralph", "run"]);

    const call = selectMock.mock.calls[0]![0];
    expect(call.options[0].label).toContain(".poe-code/ralph/plans/plan-a.md");
    expect(call.options[0].label).toContain("codex");
    expect(call.options[0].label).toContain("×3");
    expect(call.options[0].label).toContain("in_progress 1");
    expect(call.options[1].label).toBe(".poe-code/ralph/plans/plan-b.md");
  });

  it("lets CLI flags override frontmatter values", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": [
          "---",
          "agent: codex",
          "iterations: 4",
          "status:",
          "  state: open",
          "  iteration: 0",
          "---",
          "# A"
        ].join("\n")
      }),
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
      "docs/loop.md",
      "--agent",
      "claude",
      "--iterations",
      "6"
    ]);

    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        maxIterations: 6
      })
    );
  });

  it("fails before prompting for agent when no Ralph docs exist", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "ralph", "run"])
    ).rejects.toBeInstanceOf(ValidationError);

    expect(selectMock).not.toHaveBeenCalled();
    expect(promptTextMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunRalph)).not.toHaveBeenCalled();
  });

  it("uses defaults with --yes when frontmatter does not provide values", async () => {
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

    await program.parseAsync(["node", "cli", "--yes", "ralph", "run"]);

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

  it("fails fast on unknown agent names in frontmatter", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": [
          "---",
          "agent: mystery-agent",
          "iterations: 4",
          "status:",
          "  state: open",
          "  iteration: 0",
          "---",
          "# A"
        ].join("\n")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "ralph", "run", "docs/loop.md"])
    ).rejects.toBeInstanceOf(ValidationError);

    expect(vi.mocked(sdkRunRalph)).not.toHaveBeenCalled();
  });

  it("routes Ralph progress through the dashboard when --tui is enabled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const dashboardMock = createDashboardMock();
    vi.mocked(createDashboard).mockReturnValueOnce(dashboardMock.dashboard);

    vi.mocked(sdkRunRalph).mockImplementationOnce(async (options) => {
      options.onIterationStart?.(1, 5, "claude-code");
      options.onIterationComplete?.(1, 2_000, true);

      return {
        stopReason: "max_iterations",
        docPath: options.docPath,
        iterationsCompleted: 1,
        totalDurationMs: 2_000
      };
    });

    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": "# Loop"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await withMockedTerminal(() =>
      program.parseAsync([
        "node",
        "cli",
        "ralph",
        "run",
        "docs/loop.md",
        "--agent",
        "claude",
        "--iterations",
        "5",
        "--tui"
      ])
    );

    expect(vi.mocked(createDashboard)).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Ralph",
        statsTitle: "Run",
        hints: [
          { key: "q", label: "Quit" },
          { key: "↑↓", label: "Scroll" },
          { key: "F", label: "Follow" }
        ]
      })
    );
    expect(dashboardMock.start).toHaveBeenCalledTimes(1);
    expect(dashboardMock.onCommand).toHaveBeenCalledTimes(1);
    expect(dashboardMock.appendOutput.mock.calls.map(([item]) => item)).toEqual([
      {
        kind: "info",
        text: `${expectedTimestamp} Config · Agent: claude-code · Iterations: 5 · Doc: docs/loop.md`,
        ts: 0
      },
      {
        kind: "status",
        text: `${expectedTimestamp} Iteration 1/5 (claude-code)`,
        ts: 0
      },
      {
        kind: "success",
        text: `${expectedTimestamp} Iteration 1 done in 2s`,
        ts: 0
      }
    ]);
    expect(dashboardMock.updateStats).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "done",
        iterations: 1,
        tokensIn: 0,
        tokensOut: 0,
        currentAction: "Iteration 1/5 · claude-code"
      })
    );
    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
    expect(dashboardMock.stop).toHaveBeenCalledTimes(1);
    expect(dashboardMock.destroy).toHaveBeenCalledTimes(1);
  });

  it("falls back to the logger path when --tui is used with non-terminal output", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": "# Loop"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await withOutputFormat("markdown", () =>
      withMockedTerminal(() =>
        program.parseAsync([
          "node",
          "cli",
          "ralph",
          "run",
          "docs/loop.md",
          "--agent",
          "claude",
          "--iterations",
          "5",
          "--tui"
        ])
      )
    );

    expect(vi.mocked(createDashboard)).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.not.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("aborts Ralph when the dashboard quit command is used", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const dashboardMock = createDashboardMock();
    vi.mocked(createDashboard).mockReturnValueOnce(dashboardMock.dashboard);

    vi.mocked(sdkRunRalph).mockImplementationOnce(async (options) => {
      dashboardMock.commandHandlers[0]?.("quit");

      expect(options.signal?.aborted).toBe(true);

      return {
        stopReason: "cancelled",
        docPath: options.docPath,
        iterationsCompleted: 0,
        totalDurationMs: 1_000
      };
    });

    const logs: string[] = [];
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": "# Loop"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await withMockedTerminal(() =>
      program.parseAsync([
        "node",
        "cli",
        "ralph",
        "run",
        "docs/loop.md",
        "--agent",
        "claude",
        "--iterations",
        "5",
        "--tui"
      ])
    );

    expect(dashboardMock.appendOutput).toHaveBeenCalledWith({
      kind: "status",
      text: `${expectedTimestamp} Cancellation requested`,
      ts: 0
    });
    expect(process.exitCode).toBe(130);
    expect(logs.some((message) => message.includes("Ralph run cancelled."))).toBe(true);
  });

  it("streams Ralph child-agent output into the dashboard via ACP writer and stderr tee", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const dashboardMock = createDashboardMock();
    vi.mocked(createDashboard).mockReturnValueOnce(dashboardMock.dashboard);

    vi.mocked(sdkSpawn.autonomous).mockImplementationOnce(async (_agent, input) => {
      acp.getAcpWriter()("Analyzing doc");
      acp.getAcpWriter()("Drafting update");
      input.tee?.stderr?.write("Tool warning\npartial stderr");

      return {
        stdout: "",
        stderr: "",
        exitCode: 0
      };
    });

    vi.mocked(sdkRunRalph).mockImplementationOnce(async (options) => {
      options.onIterationStart?.(1, 5, "claude-code");
      await options.runAgent?.({
        agent: "claude-code",
        prompt: "Inspect the plan doc",
        cwd,
        signal: options.signal
      });
      options.onIterationComplete?.(1, 2_000, true);

      return {
        stopReason: "max_iterations",
        docPath: options.docPath,
        iterationsCompleted: 1,
        totalDurationMs: 2_000
      };
    });

    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": "# Loop"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await withMockedTerminal(() =>
      program.parseAsync([
        "node",
        "cli",
        "ralph",
        "run",
        "docs/loop.md",
        "--agent",
        "claude",
        "--iterations",
        "5",
        "--tui"
      ])
    );

    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        runAgent: expect.any(Function),
        signal: expect.any(AbortSignal)
      })
    );
    expect(vi.mocked(sdkSpawn.autonomous)).toHaveBeenCalledWith(
      "claude-code",
      expect.objectContaining({
        prompt: "Inspect the plan doc",
        cwd,
        mode: "yolo",
        signal: expect.any(AbortSignal),
        useStdin: true,
        tee: expect.objectContaining({
          stderr: expect.any(Object)
        })
      })
    );

    const outputs = dashboardMock.appendOutput.mock.calls.map(([item]) => item);
    expect(
      outputs.some((item) =>
        item.kind === "tool"
        && item.text.includes("[iteration:1] Analyzing doc")
      )
    ).toBe(true);
    expect(
      outputs.some((item) =>
        item.kind === "tool"
        && item.text.includes("[iteration:1] Drafting update")
      )
    ).toBe(true);
    expect(
      outputs.some((item) =>
        item.kind === "error"
        && item.text.includes("[iteration:1] Tool warning")
      )
    ).toBe(true);
    expect(
      outputs.some((item) =>
        item.kind === "error"
        && item.text.includes("[iteration:1] partial stderr")
      )
    ).toBe(true);
  });
});

describe("ralph init command", () => {
  afterEach(() => {
    vi.clearAllMocks();
    isCancelMock.mockReturnValue(false);
  });

  it("updates an existing doc preserving body and runtime status", async () => {
    const fs = createMemFs({
      "/repo/docs/loop.md": [
        "---",
        "status:",
        "  state: in_progress",
        "  iteration: 2",
        "---",
        "# My Plan",
        "",
        "Body"
      ].join("\n")
    });
    const container = createCliContainer({
      fs,
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
      "init",
      "docs/loop.md",
      "--agent",
      "codex",
      "--iterations",
      "5"
    ]);

    const updated = await fs.readFile("/repo/docs/loop.md", "utf8");
    const parsed = parseFrontmatter(updated);
    expect(parsed.data).toEqual({
      agent: "codex",
      iterations: 5,
      status: {
        state: "in_progress",
        iteration: 2
      }
    });
    expect(parsed.body).toBe("# My Plan\n\nBody");
  });

  it("errors when the doc does not exist", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "ralph", "init", "docs/missing.md"])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("uses CLI prompts when agent and iterations are omitted", async () => {
    const fs = createMemFs({
      "/repo/.poe-code/ralph/plans/plan-a.md": "# A"
    });
    selectMock
      .mockResolvedValueOnce(".poe-code/ralph/plans/plan-a.md")
      .mockResolvedValueOnce("codex");
    promptTextMock.mockResolvedValue("4");

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "ralph", "init"]);

    const updated = await fs.readFile(
      "/repo/.poe-code/ralph/plans/plan-a.md",
      "utf8"
    );
    const parsed = parseFrontmatter(updated);
    expect(parsed.data).toEqual({
      agent: "codex",
      iterations: 4,
      status: {
        state: "open",
        iteration: 0
      }
    });
  });

  it("uses defaults with --yes", async () => {
    const fs = createMemFs({
      "/repo/docs/loop.md": "# A"
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "ralph",
      "init",
      "docs/loop.md"
    ]);

    const updated = await fs.readFile("/repo/docs/loop.md", "utf8");
    const parsed = parseFrontmatter(updated);
    expect(parsed.data).toEqual({
      agent: "claude-code",
      iterations: 3,
      status: {
        state: "open",
        iteration: 0
      }
    });
    expect(selectMock).not.toHaveBeenCalled();
    expect(promptTextMock).not.toHaveBeenCalled();
  });
});
