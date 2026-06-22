import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import { hasOwnErrorCode } from "../../utils/error-codes.js";
import type { FileSystem } from "../../utils/file-system.js";
import { registerExperimentCommand } from "./experiment.js";
import { registerRalphCommand } from "./ralph.js";
import { allAgents } from "@poe-code/agent-defs";
import { ValidationError } from "../errors.js";
import type { Dashboard } from "toolcraft-design";
import experimentSkillPlan from "../../templates/experiment/SKILL_experiment.md";
import experimentRunYaml from "../../templates/experiment/run.yaml.mustache";
import { skillPlanConfigSection } from "@poe-code/agent-harness-tools";
import { parseFrontmatter } from "../../../packages/ralph/src/frontmatter/frontmatter.js";

const { selectMock, promptTextMock, isCancelMock, cancelMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  promptTextMock: vi.fn(),
  isCancelMock: vi.fn(() => false),
  cancelMock: vi.fn()
}));

const braintrustLoadIntegrationsMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/braintrust", () => ({
  loadIntegrations: braintrustLoadIntegrationsMock
}));

vi.mock("../../sdk/experiment.js", () => ({
  runExperiment: vi.fn().mockResolvedValue({
    stopReason: "max_experiments",
    docPath: ".poe-code/experiments/plan-a.md",
    experimentsCompleted: 2,
    experimentsKept: 1,
    totalDurationMs: 1000
  }),
  readExperimentJournal: vi.fn().mockResolvedValue([]),
  appendExperimentJournalEntry: vi.fn().mockResolvedValue(undefined)
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

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
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
  readExperimentJournal as sdkReadExperimentJournal,
  appendExperimentJournalEntry as sdkAppendExperimentJournalEntry
} from "../../sdk/experiment.js";
import { runRalph as sdkRunRalph } from "../../sdk/ralph.js";
import { spawn as sdkSpawn } from "../../sdk/spawn.js";
import { acp, createDashboard, withOutputFormat } from "toolcraft-design";

const cwd = "/repo";
const homeDir = "/home/test";

beforeEach(() => {
  vi.mocked(sdkRunExperiment).mockResolvedValue({
    stopReason: "max_experiments",
    docPath: ".poe-code/experiments/plan-a.md",
    experimentsCompleted: 2,
    experimentsKept: 1,
    totalDurationMs: 1000
  });
  vi.mocked(sdkReadExperimentJournal).mockResolvedValue([]);
  vi.mocked(sdkAppendExperimentJournalEntry).mockResolvedValue(undefined);
  vi.mocked(sdkRunRalph).mockResolvedValue({
    stopReason: "max_iterations",
    docPath: ".poe-code/ralph/plans/plan-a.md",
    iterationsCompleted: 3,
    totalDurationMs: 1000
  });
});

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const volume = Volume.fromJSON(files, "/");
  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

async function replaceWithSymlink(
  fs: Pick<FileSystem, "symlink" | "unlink">,
  path: string,
  target: string
): Promise<void> {
  try {
    await fs.unlink(path);
  } catch (error) {
    if (!hasOwnErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
  await fs.symlink(target, path);
}

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
  return program;
}

function getExperimentAgentOptions() {
  return allAgents
    .filter((agent) => agent.binaryName !== undefined)
    .map((agent) => ({
      label: agent.label,
      value: agent.id,
      hint: agent.summary
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

function ralphPlanDoc(name: string): string {
  return [
    "---",
    "kind: ralph",
    "version: 1",
    "status:",
    "  state: open",
    "  iteration: 0",
    "---",
    `# ${name}`
  ].join("\n");
}

function experimentPlanDoc(name: string): string {
  return [
    "---",
    "kind: experiment",
    "version: 1",
    "baseline: null",
    "---",
    `# ${name}`
  ].join("\n");
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

  it("passes runtime flags to the experiment SDK", async () => {
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

    await program.parseAsync([
      "node",
      "cli",
      "experiment",
      "run",
      "docs/loop.md",
      "--agent",
      "claude",
      "--runtime",
      "e2b",
      "--runtime-template",
      "tpl_123",
      "--detach",
      "--mount-poe-code",
      "--runner-sync",
      "none"
    ]);

    expect(vi.mocked(sdkRunExperiment)).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "e2b",
        runtimeTemplate: "tpl_123",
        detach: true,
        mountPoeCode: true,
        runnerSync: "none"
      })
    );
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

  it("previews experiment runs without executing the loop", async () => {
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

    await program.parseAsync([
      "node", "cli", "--dry-run", "experiment", "run", "docs/loop.md", "--agent", "claude", "--max-experiments", "0"
    ]);

    expect(vi.mocked(sdkRunExperiment)).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("Dry run: would run experiment doc docs/loop.md with claude-code for up to 0 experiments.");
  });

  it("discovers the first doc and default agent with --yes", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/plan-b.md": experimentPlanDoc("B"),
        "/repo/docs/plans/plan-a.md": experimentPlanDoc("A")
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
        docPath: "docs/plans/plan-a.md"
      })
    );
  });

  it("uses core.defaultAgent for experiment run with --yes and preserves the model", async () => {
    const fs = createMemFs({
      "/repo/docs/loop.md": "# Loop"
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      container.env.configPath,
      `${JSON.stringify(
        { core: { defaultAgent: "claude-code:anthropic/claude-sonnet-4.6" } },
        null,
        2
      )}
`,
      { encoding: "utf8" }
    );
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "experiment", "run", "docs/loop.md"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunExperiment)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code:anthropic/claude-sonnet-4.6",
        docPath: "docs/loop.md"
      })
    );
  });

  it("prompts for the experiment agent when core.defaultAgent exists without --yes", async () => {
    selectMock.mockResolvedValueOnce("codex");
    const fs = createMemFs({
      "/repo/docs/loop.md": "# Loop"
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      container.env.configPath,
      `${JSON.stringify(
        { core: { defaultAgent: "claude-code:anthropic/claude-sonnet-4.6" } },
        null,
        2
      )}
`,
      { encoding: "utf8" }
    );
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await withMockedTerminal(
      () => program.parseAsync(["node", "cli", "experiment", "run", "docs/loop.md"]),
      { stdin: true }
    );

    expect(selectMock).toHaveBeenCalledWith({
      message: "Select agent to run the experiment with:",
      options: getExperimentAgentOptions()
    });
    expect(vi.mocked(sdkRunExperiment)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex",
        docPath: "docs/loop.md"
      })
    );
  });

  it("prefers the single frontmatter agent over core.defaultAgent and --yes for experiment run", async () => {
    const fs = createMemFs({
      "/repo/docs/loop.md": [
        "---",
        "agent: claude:anthropic/claude-sonnet-4.6",
        "---",
        "# Loop"
      ].join("\n")
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      container.env.configPath,
      `${JSON.stringify({ core: { defaultAgent: "codex" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "experiment", "run", "docs/loop.md"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunExperiment)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code:anthropic/claude-sonnet-4.6",
        docPath: "docs/loop.md"
      })
    );
  });

  it("discovers docs from the shared plan directory config when it points home", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/config.json": JSON.stringify({
          plan: { plan_directory: "~/docs/plans" }
        }),
        "/home/test/docs/plans/plan-a.md": experimentPlanDoc("A")
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
        docPath: "~/docs/plans/plan-a.md"
      })
    );
  });

  it("prompts for missing doc and agent when frontmatter does not provide them", async () => {
    selectMock.mockResolvedValueOnce("docs/plans/plan-a.md").mockResolvedValueOnce("codex");

    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/plan-b.md": experimentPlanDoc("B"),
        "/repo/docs/plans/plan-a.md": experimentPlanDoc("A")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await withMockedTerminal(
      () => program.parseAsync(["node", "cli", "experiment", "run"]),
      { stdin: true }
    );

    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(selectMock).toHaveBeenNthCalledWith(1, {
      message: "Select the experiment doc to run:",
      options: [
        {
          label: "docs/plans/plan-a.md",
          value: "docs/plans/plan-a.md"
        },
        {
          label: "docs/plans/plan-b.md",
          value: "docs/plans/plan-b.md"
        }
      ]
    });
    expect(selectMock).toHaveBeenNthCalledWith(2, {
      message: "Select agent to run the experiment with:",
      options: getExperimentAgentOptions()
    });
    expect(vi.mocked(sdkRunExperiment)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex",
        docPath: "docs/plans/plan-a.md"
      })
    );
  });

  it("rejects missing doc selection in non-interactive mode", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/plan-a.md": experimentPlanDoc("A")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await expect(
      withMockedTerminal(() => program.parseAsync(["node", "cli", "experiment", "run"]), {
        stdin: false
      })
    ).rejects.toThrow(
      "Experiment doc selection requires a doc path or --yes when running without an interactive TTY."
    );

    expect(selectMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunExperiment)).not.toHaveBeenCalled();
  });

  it("rejects missing run agent selection in non-interactive mode", async () => {
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
      withMockedTerminal(
        () => program.parseAsync(["node", "cli", "experiment", "run", "docs/loop.md"]),
        { stdin: false }
      )
    ).rejects.toThrow(
      "Experiment agent selection requires --agent, frontmatter agent, or --yes when running without an interactive TTY."
    );

    expect(selectMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunExperiment)).not.toHaveBeenCalled();
  });

  it("preserves multi-agent frontmatter arrays for experiment run", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": ["---", "agent:", "  - claude", "  - codex", "---", "# Loop"].join(
          "\n"
        )
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await program.parseAsync(["node", "cli", "experiment", "run", "docs/loop.md"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunExperiment)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: ["claude-code", "codex"],
        docPath: "docs/loop.md"
      })
    );
  });

  it("preserves comma-separated CLI agents for experiment run", async () => {
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

    await program.parseAsync([
      "node",
      "cli",
      "experiment",
      "run",
      "docs/loop.md",
      "--agent",
      "claude,codex"
    ]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunExperiment)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: ["claude-code", "codex"],
        docPath: "docs/loop.md"
      })
    );
  });

  it("rejects unsupported single CLI agents with a validation error", async () => {
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
        "mystery-agent"
      ])
    ).rejects.toBeInstanceOf(ValidationError);

    expect(selectMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunExperiment)).not.toHaveBeenCalled();
  });

  it("fails fast on unknown single frontmatter agents", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": ["---", "agent: mystery-agent", "---", "# Loop"].join("\n")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "experiment", "run", "docs/loop.md"])
    ).rejects.toBeInstanceOf(ValidationError);

    expect(selectMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunExperiment)).not.toHaveBeenCalled();
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

  it("runs integration experiment callbacks after CLI callbacks when enabled", async () => {
    const calls: string[] = [];
    braintrustLoadIntegrationsMock.mockResolvedValue({
      experimentCallbacks: {
        onExperimentStart: () => calls.push("integration")
      },
      traceRun: async (_surface: string, _name: string, fn: () => Promise<unknown>) => fn(),
      shutdown: vi.fn(async () => undefined)
    });
    vi.mocked(sdkRunExperiment).mockImplementationOnce(async (options) => {
      options.onExperimentStart?.(1, "codex");
      return {
        stopReason: "max_experiments",
        docPath: options.docPath,
        experimentsCompleted: 1,
        experimentsKept: 0,
        totalDurationMs: 1_000
      };
    });

    const container = createCliContainer({
      fs: createMemFs({
        [`${homeDir}/.poe-code/config.json`]: JSON.stringify({
          integrations: {
            braintrust: {
              enabled: true,
              apiKey: "key",
              project: "project"
            }
          }
        }),
        "/repo/docs/loop.md": "# Loop"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        if (message === "Experiment 1 (codex)") {
          calls.push("cli");
        }
      }
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "experiment",
      "run",
      "docs/loop.md",
      "--agent",
      "codex",
      "--max-experiments",
      "1",
      "--no-tui"
    ]);

    expect(calls).toEqual(["cli", "integration"]);

    braintrustLoadIntegrationsMock.mockReset();
  });

  it("uses the experiment.tui config value when set", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const dashboardMock = createDashboardMock();
    vi.mocked(createDashboard).mockReturnValueOnce(dashboardMock.dashboard);

    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/config.json": JSON.stringify({
          experiment: { tui: true }
        }),
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
        "5"
      ])
    );

    expect(vi.mocked(createDashboard)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sdkRunExperiment)).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("lets --no-tui override the experiment.tui config value", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/config.json": JSON.stringify({
          experiment: { tui: true }
        }),
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
        "--no-tui"
      ])
    );

    expect(vi.mocked(createDashboard)).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunExperiment)).toHaveBeenCalledWith(
      expect.not.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("uses the POE_EXPERIMENT_TUI env value when set", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const dashboardMock = createDashboardMock();
    vi.mocked(createDashboard).mockReturnValueOnce(dashboardMock.dashboard);

    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": "# Loop"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: {
        cwd,
        homeDir,
        variables: {
          POE_EXPERIMENT_TUI: "1"
        }
      },
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
        "5"
      ])
    );

    expect(vi.mocked(createDashboard)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sdkRunExperiment)).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("lets --no-tui override the POE_EXPERIMENT_TUI env value", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": "# Loop"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: {
        cwd,
        homeDir,
        variables: {
          POE_EXPERIMENT_TUI: "1"
        }
      },
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
        "--no-tui"
      ])
    );

    expect(vi.mocked(createDashboard)).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunExperiment)).toHaveBeenCalledWith(
      expect.not.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
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
      outputs.some(
        (item) =>
          item.kind === "tool" && item.text.includes("[experiment:1] Running experiment step")
      )
    ).toBe(true);
    expect(
      outputs.some(
        (item) => item.kind === "tool" && item.text.includes("[experiment:1] Evaluating metrics")
      )
    ).toBe(true);
    expect(
      outputs.some(
        (item) => item.kind === "error" && item.text.includes("[experiment:1] Metric warning")
      )
    ).toBe(true);
    expect(
      outputs.some(
        (item) => item.kind === "error" && item.text.includes("[experiment:1] partial stderr")
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

  it("cancels experiment when SIGINT is received in dashboard mode", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const dashboardMock = createDashboardMock();
    vi.mocked(createDashboard).mockReturnValueOnce(dashboardMock.dashboard);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    try {
      vi.mocked(sdkRunExperiment).mockImplementationOnce(async (options) => {
        process.emit("SIGINT");

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

      expect(exitSpy).not.toHaveBeenCalled();
      expect(dashboardMock.appendOutput).toHaveBeenCalledWith({
        kind: "status",
        text: `${expectedTimestamp} Cancellation requested`,
        ts: 0
      });
      expect(process.exitCode).toBe(130);
      expect(logs.some((message) => message.includes("Experiment run cancelled."))).toBe(true);
    } finally {
      exitSpy.mockRestore();
    }
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

  it("does not repair invalid project config while displaying a journal", async () => {
    const fs = createMemFs({
      "/repo/docs/loop.md": "# Loop",
      "/repo/.poe-code/config.json": "{ invalid json\n"
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "experiment", "journal", "docs/loop.md"])
    ).rejects.toThrow();

    await expect(fs.readFile(container.env.projectConfigPath, "utf8")).resolves.toBe("{ invalid json\n");
    await expect(fs.readdir("/repo/.poe-code")).resolves.toEqual(["config.json"]);
  });

  it("does not repair invalid project config while previewing a journal entry", async () => {
    const fs = createMemFs({
      "/repo/docs/loop.md": "# Loop",
      "/repo/.poe-code/config.json": "{ invalid json\n"
    });
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
        "--dry-run",
        "experiment",
        "journal",
        "log",
        "docs/loop.md",
        "--status",
        "keep",
        "--commit",
        "abc123"
      ])
    ).rejects.toThrow();

    await expect(fs.readFile(container.env.projectConfigPath, "utf8")).resolves.toBe("{ invalid json\n");
    await expect(fs.readdir("/repo/.poe-code")).resolves.toEqual(["config.json"]);
  });

  it("rejects journal scores with non-numeric metric values", async () => {
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
        "journal",
        "log",
        "docs/loop.md",
        "--status",
        "keep",
        "--commit",
        "abc123",
        "--scores",
        '{"tests":"bad"}'
      ])
    ).rejects.toThrow('--scores.tests must be a finite number.');

    expect(vi.mocked(sdkAppendExperimentJournalEntry)).not.toHaveBeenCalled();
  });

  it("rejects journal duration values with trailing text", async () => {
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
        "journal",
        "log",
        "docs/loop.md",
        "--status",
        "keep",
        "--commit",
        "abc123",
        "--duration-ms",
        "2abc"
      ])
    ).rejects.toThrow('Invalid --duration-ms "2abc". Expected a non-negative finite number.');

    expect(vi.mocked(sdkAppendExperimentJournalEntry)).not.toHaveBeenCalled();
  });

  it("discovers the first doc with --yes", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/plan-b.md": experimentPlanDoc("B"),
        "/repo/docs/plans/plan-a.md": experimentPlanDoc("A")
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
      docPath: "docs/plans/plan-a.md"
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

  it("does not repair invalid project config while previewing validation", async () => {
    const fs = createMemFs({
      "/repo/docs/loop.md": [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: tests",
        "  script: npm test",
        "  direction: maximize",
        "---",
        "# Loop"
      ].join("\n"),
      "/repo/.poe-code/config.json": "{ invalid json\n"
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "experiment", "validate", "docs/loop.md"])
    ).rejects.toThrow();

    await expect(fs.readFile(container.env.projectConfigPath, "utf8")).resolves.toBe("{ invalid json\n");
    await expect(fs.readdir("/repo/.poe-code")).resolves.toEqual(["config.json"]);
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
        "/repo/docs/plans/plan-a.md": [
          "---",
          "kind: experiment",
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

describe("experiment plan-path command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the resolved plans path", async () => {
    const fs = createMemFs();
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd: "/repo", homeDir: "/home/test" },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await program.parseAsync(["node", "cli", "experiment", "plan-path"]);

    expect(writeSpy).toHaveBeenCalledWith("/repo/docs/plans\n");
  });

  it("does not repair invalid project config while printing the plan path", async () => {
    const fs = createMemFs({
      "/repo/.poe-code/config.json": "{ invalid json\n"
    });
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await expect(program.parseAsync(["node", "cli", "experiment", "plan-path"])).rejects.toThrow();

    expect(writeSpy).not.toHaveBeenCalled();
    await expect(fs.readFile(container.env.projectConfigPath, "utf8")).resolves.toBe("{ invalid json\n");
    await expect(fs.readdir("/repo/.poe-code")).resolves.toEqual(["config.json"]);
  });
});

describe("experiment install command", () => {
  afterEach(() => {
    vi.clearAllMocks();
    isCancelMock.mockReturnValue(false);
  });

  it("ships shared docs/plans instructions with canonical experiment frontmatter", () => {
    expect(experimentSkillPlan).toContain("<plan-directory>/<name>.md");
    expect(experimentSkillPlan).toContain("kind: experiment");
    expect(experimentSkillPlan).toContain("version: 1");
    expect(experimentSkillPlan).toContain("max_experiments");
    expect(experimentSkillPlan).toContain("metric_timeout");
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
    ).resolves.toBe(experimentSkillPlan + "\n\n" + skillPlanConfigSection("experiment"));
    await expect(fs.stat("/repo/.poe-code/experiments")).resolves.toBeDefined();
    await expect(fs.readFile("/repo/.poe-code/experiments/run.yaml", "utf8")).resolves.toBe(
      experimentRunYaml
    );
  });

  it("does not treat inherited stat codes as missing experiment install paths", async () => {
    const fs = createMemFs();
    const statError = new Error("experiment stat denied");
    const originalStat = fs.stat.bind(fs);
    vi.spyOn(fs, "stat").mockImplementation(async (filePath) => {
      if (String(filePath) === "/repo/.poe-code/experiments") {
        throw statError;
      }
      return originalStat(filePath);
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await withObjectPrototypeCode("ENOENT", async () => {
      await expect(
        program.parseAsync([
          "node",
          "cli",
          "experiment",
          "install",
          "--agent",
          "claude-code",
          "--local"
        ])
      ).rejects.toBe(statError);
    });
  });

  it("does not install the skill when run.yaml scaffolding fails", async () => {
    const fs = createMemFs();
    const writeFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (filePath === "/repo/.poe-code/experiments/run.yaml") {
        throw new Error("run.yaml write failed");
      }
      await writeFile(filePath, data, options);
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await withObjectPrototypeCode("EEXIST", async () => {
      await expect(
        program.parseAsync([
          "node",
          "cli",
          "experiment",
          "install",
          "--agent",
          "claude-code",
          "--local"
        ])
      ).rejects.toThrow("run.yaml write failed");
    });

    await expect(
      fs.readFile("/repo/.claude/skills/poe-code-experiment-plan/SKILL.md", "utf8")
    ).rejects.toThrow();
    await expect(fs.stat("/repo/.poe-code/experiments")).rejects.toThrow();
  });

  it("cleans a partial run.yaml when scaffolding fails in an existing experiments directory", async () => {
    const fs = createMemFs({
      "/repo/.poe-code/experiments/existing.md": "# Existing\n"
    });
    const writeFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (filePath === "/repo/.poe-code/experiments/run.yaml") {
        await writeFile(filePath, "partial run yaml\n", options);
        throw new Error("run.yaml write failed");
      }
      await writeFile(filePath, data, options);
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await withObjectPrototypeCode("EEXIST", async () => {
      await expect(
        program.parseAsync([
          "node",
          "cli",
          "experiment",
          "install",
          "--agent",
          "claude-code",
          "--local"
        ])
      ).rejects.toThrow("run.yaml write failed");
    });

    await expect(fs.readFile("/repo/.poe-code/experiments/existing.md", "utf8")).resolves.toBe(
      "# Existing\n"
    );
    await expect(fs.readFile("/repo/.poe-code/experiments/run.yaml", "utf8")).rejects.toMatchObject(
      { code: "ENOENT" }
    );
  });

  it("does not follow a run.yaml symlink inserted before experiment scaffolding", async () => {
    const runYamlPath = "/repo/.poe-code/experiments/run.yaml";
    const outsidePath = "/outside/run.yaml";
    const fs = createMemFs({
      [outsidePath]: "outside-state\n"
    });
    const writeFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (filePath === runYamlPath) {
        await replaceWithSymlink(fs, runYamlPath, outsidePath);
      }
      await writeFile(filePath, data, options);
    });
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
        "--agent",
        "claude-code",
        "--local"
      ])
    ).rejects.toMatchObject({ code: "EEXIST" });

    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("outside-state\n");
    await expect(
      fs.readFile("/repo/.claude/skills/poe-code-experiment-plan/SKILL.md", "utf8")
    ).rejects.toThrow();
    await expect(fs.stat("/repo/.poe-code/experiments")).rejects.toThrow();
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
    ).resolves.toBe(experimentSkillPlan + "\n\n" + skillPlanConfigSection("experiment"));
    await expect(fs.stat("/repo/.poe-code/experiments")).resolves.toBeDefined();
    await expect(fs.readFile("/repo/.poe-code/experiments/run.yaml", "utf8")).resolves.toBe(
      experimentRunYaml
    );
  });

  it("does not repair invalid global config while previewing experiment installation", async () => {
    const fs = createMemFs({
      "/home/test/.poe-code/config.json": "{ invalid json\n"
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "--yes", "experiment", "install", "--local"])
    ).rejects.toThrow();

    await expect(fs.readFile(container.env.configPath, "utf8")).resolves.toBe("{ invalid json\n");
    await expect(fs.readdir("/home/test/.poe-code")).resolves.toEqual(["config.json"]);
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
    registerExperimentCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "experiment", "install", "--local"]);

    expect(selectMock).not.toHaveBeenCalled();
    await expect(
      fs.readFile("/repo/.codex/skills/poe-code-experiment-plan/SKILL.md", "utf8")
    ).resolves.toBe(experimentSkillPlan + "\n\n" + skillPlanConfigSection("experiment"));
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
      program.parseAsync(["node", "cli", "experiment", "install", "--local", "--global"])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects missing install agent selection in non-interactive mode", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await expect(
      withMockedTerminal(() => program.parseAsync(["node", "cli", "experiment", "install"]), {
        stdin: false
      })
    ).rejects.toThrow(
      "Experiment install agent selection requires --agent or --yes when running without an interactive TTY."
    );

    expect(selectMock).not.toHaveBeenCalled();
  });

  it("rejects missing install scope selection in non-interactive mode", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerExperimentCommand(program, container);

    await expect(
      withMockedTerminal(
        () =>
          program.parseAsync([
            "node",
            "cli",
            "experiment",
            "install",
            "--agent",
            "claude-code"
          ]),
        { stdin: false }
      )
    ).rejects.toThrow(
      "Experiment install scope selection requires --local, --global, or --yes when running without an interactive TTY."
    );

    expect(selectMock).not.toHaveBeenCalled();
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
    ).resolves.toBe(experimentSkillPlan + "\n\n" + skillPlanConfigSection("experiment"));
    await expect(fs.stat("/home/test/.poe-code/experiments")).resolves.toBeDefined();
    await expect(fs.readFile("/home/test/.poe-code/experiments/run.yaml", "utf8")).resolves.toBe(
      experimentRunYaml
    );
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

    await expect(fs.readFile("/repo/.poe-code/experiments/existing.md", "utf8")).resolves.toBe(
      "# Existing"
    );
    await expect(
      fs.readFile("/repo/.claude/skills/poe-code-experiment-plan/SKILL.md", "utf8")
    ).resolves.toBe(experimentSkillPlan + "\n\n" + skillPlanConfigSection("experiment"));
    const lines = loggerOutput.split("\n");
    expect(
      lines.some((l) => l.includes("Create: .poe-code/experiments") && !l.includes("run.yaml"))
    ).toBe(false);
    await expect(fs.readFile("/repo/.poe-code/experiments/run.yaml", "utf8")).resolves.toBe(
      experimentRunYaml
    );
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
      "5",
      "--cwd",
      "/tmp/ralph-work"
    ]);

    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        cwd: "/tmp/ralph-work",
        homeDir,
        docPath: "docs/loop.md",
        maxIterations: 5,
        runtimeConfigCwd: cwd
      })
    );
  });

  it("does not execute Ralph loops during dry-run previews", async () => {
    const logs: string[] = [];
    const container = createCliContainer({
      fs: createMemFs({ "/repo/docs/loop.md": "# Loop" }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "--dry-run", "--yes", "ralph", "run", "docs/loop.md"]);

    expect(vi.mocked(sdkRunRalph)).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("Dry run: would run Ralph");
  });

  it("does not recover invalid global config during dry-run previews", async () => {
    const fs = createMemFs({
      "/home/test/.poe-code/config.json": "{invalid json",
      "/repo/docs/loop.md": "---\nagent: claude-code\niterations: 1\n---\n# Loop"
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "--yes", "ralph", "run", "docs/loop.md"])
    ).rejects.toThrow(SyntaxError);
    await expect(fs.readFile("/home/test/.poe-code/config.json", "utf8")).resolves.toBe(
      "{invalid json"
    );
    await expect(fs.readdir("/home/test/.poe-code")).resolves.toEqual(["config.json"]);
    expect(vi.mocked(sdkRunRalph)).not.toHaveBeenCalled();
  });

  it("passes runtime flags to the Ralph SDK", async () => {
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
      "5",
      "--runtime",
      "docker",
      "--runtime-image",
      "poe-code:test",
      "--detach",
      "--runner-sync",
      "upload"
    ]);

    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "docker",
        runtimeImage: "poe-code:test",
        detach: true,
        runnerSync: "upload"
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

  it("uses core.defaultAgent for ralph run with --yes when frontmatter omits agent", async () => {
    const fs = createMemFs({
      "/repo/docs/loop.md": [
        "---",
        "iterations: 4",
        "status:",
        "  state: open",
        "  iteration: 0",
        "---",
        "# A"
      ].join("\n")
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      container.env.configPath,
      `${JSON.stringify({ core: { defaultAgent: "claude-code" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "ralph", "run", "docs/loop.md"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(promptTextMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        docPath: "docs/loop.md",
        maxIterations: 4
      })
    );
  });

  it("prompts for the Ralph agent when core.defaultAgent exists without --yes", async () => {
    selectMock.mockResolvedValueOnce("codex");
    const fs = createMemFs({
      "/repo/docs/loop.md": [
        "---",
        "iterations: 4",
        "status:",
        "  state: open",
        "  iteration: 0",
        "---",
        "# A"
      ].join("\n")
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      container.env.configPath,
      `${JSON.stringify({ core: { defaultAgent: "claude-code" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await withMockedTerminal(
      () => program.parseAsync(["node", "cli", "ralph", "run", "docs/loop.md"]),
      { stdin: true }
    );

    expect(selectMock).toHaveBeenCalledWith({
      message: "Select agent to run Ralph with:",
      options: getExperimentAgentOptions()
    });
    expect(promptTextMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex",
        docPath: "docs/loop.md",
        maxIterations: 4
      })
    );
  });

  it("prefers frontmatter agent over core.defaultAgent for ralph run", async () => {
    const fs = createMemFs({
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
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      container.env.configPath,
      `${JSON.stringify({ core: { defaultAgent: "claude-code" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "ralph", "run", "docs/loop.md"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(promptTextMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex",
        docPath: "docs/loop.md",
        maxIterations: 4
      })
    );
  });

  it("preserves the model from core.defaultAgent for ralph run with --yes", async () => {
    const fs = createMemFs({
      "/repo/docs/loop.md": [
        "---",
        "iterations: 4",
        "status:",
        "  state: open",
        "  iteration: 0",
        "---",
        "# A"
      ].join("\n")
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      container.env.configPath,
      `${JSON.stringify(
        { core: { defaultAgent: "claude-code:anthropic/claude-sonnet-4.6" } },
        null,
        2
      )}\n`,
      { encoding: "utf8" }
    );
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "ralph", "run", "docs/loop.md"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(promptTextMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code:anthropic/claude-sonnet-4.6",
        docPath: "docs/loop.md",
        maxIterations: 4
      })
    );
  });

  it("prefers core.defaultAgent over --yes for ralph run", async () => {
    const fs = createMemFs({
      "/repo/docs/loop.md": [
        "---",
        "iterations: 4",
        "status:",
        "  state: open",
        "  iteration: 0",
        "---",
        "# A"
      ].join("\n")
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      container.env.configPath,
      `${JSON.stringify({ core: { defaultAgent: "codex" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "ralph", "run", "docs/loop.md"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(promptTextMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex",
        docPath: "docs/loop.md",
        maxIterations: 4
      })
    );
  });

  it("prompts for missing agent, doc, and iterations when frontmatter does not provide them", async () => {
    selectMock.mockResolvedValueOnce("docs/plans/plan-a.md").mockResolvedValueOnce("codex");
    promptTextMock.mockResolvedValue("4");

    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/plan-b.md": ralphPlanDoc("B"),
        "/repo/docs/plans/plan-a.md": ralphPlanDoc("A")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await withMockedTerminal(
      () => program.parseAsync(["node", "cli", "ralph", "run"]),
      { stdin: true }
    );

    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(selectMock).toHaveBeenNthCalledWith(1, {
      message: "Select the Ralph markdown doc to run:",
      options: [
        {
          label: "docs/plans/plan-a.md",
          value: "docs/plans/plan-a.md"
        },
        {
          label: "docs/plans/plan-b.md",
          value: "docs/plans/plan-b.md"
        }
      ]
    });
    expect(selectMock).toHaveBeenNthCalledWith(2, {
      message: "Select agent to run Ralph with:",
      options: getExperimentAgentOptions()
    });
    expect(promptTextMock).toHaveBeenCalledWith({
      message: "How many Ralph iterations should run?"
    });
    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex",
        docPath: "docs/plans/plan-a.md",
        maxIterations: 4
      })
    );
  });

  it("rejects missing doc selection in non-interactive mode", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/plan-a.md": ralphPlanDoc("A")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await expect(
      withMockedTerminal(() => program.parseAsync(["node", "cli", "ralph", "run"]), {
        stdin: false
      })
    ).rejects.toThrow(
      "Ralph doc selection requires a doc path or --yes when running without an interactive TTY."
    );

    expect(selectMock).not.toHaveBeenCalled();
    expect(promptTextMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunRalph)).not.toHaveBeenCalled();
  });

  it("rejects missing run agent selection in non-interactive mode", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": ["---", "iterations: 4", "---", "# Loop"].join("\n")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await expect(
      withMockedTerminal(
        () => program.parseAsync(["node", "cli", "ralph", "run", "docs/loop.md"]),
        { stdin: false }
      )
    ).rejects.toThrow(
      "Ralph agent selection requires --agent, frontmatter agent, or --yes when running without an interactive TTY."
    );

    expect(selectMock).not.toHaveBeenCalled();
    expect(promptTextMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunRalph)).not.toHaveBeenCalled();
  });

  it("rejects missing run iterations in non-interactive mode", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": ["---", "agent: codex", "---", "# Loop"].join("\n")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await expect(
      withMockedTerminal(
        () => program.parseAsync(["node", "cli", "ralph", "run", "docs/loop.md"]),
        { stdin: false }
      )
    ).rejects.toThrow(
      "Ralph iteration selection requires --iterations, frontmatter iterations, or --yes when running without an interactive TTY."
    );

    expect(selectMock).not.toHaveBeenCalled();
    expect(promptTextMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunRalph)).not.toHaveBeenCalled();
  });

  it("rejects run iterations with trailing suffixes", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": ["---", "agent: codex", "iterations: 4", "---", "# Loop"].join("\n")
      }),
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
        "docs/loop.md",
        "--iterations",
        "2abc"
      ])
    ).rejects.toThrow('Invalid iterations "2abc". Expected a positive integer.');

    expect(vi.mocked(sdkRunRalph)).not.toHaveBeenCalled();
  });

  it("shows frontmatter hints in the doc selection prompt", async () => {
    selectMock.mockResolvedValueOnce("docs/plans/plan-a.md");

    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/plan-a.md": [
          "---",
          "kind: ralph",
          "name: A",
          "agent: codex",
          "iterations: 3",
          "status:",
          "  state: in_progress",
          "  iteration: 1",
          "---",
          "# A"
        ].join("\n"),
        "/repo/docs/plans/plan-b.md": ralphPlanDoc("B")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await withMockedTerminal(
      () => program.parseAsync(["node", "cli", "ralph", "run"]),
      { stdin: true }
    );

    const call = selectMock.mock.calls[0]![0];
    expect(call.options[0].label).toContain("docs/plans/plan-a.md");
    expect(call.options[0].label).toContain("codex");
    expect(call.options[0].label).toContain("×3");
    expect(call.options[0].label).toContain("in_progress 1");
    expect(call.options[1].label).toBe("docs/plans/plan-b.md");
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

  it("keeps frontmatter array fan-out when --agent is also provided", async () => {
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

    await program.parseAsync(["node", "cli", "ralph", "run", "docs/loop.md", "--agent", "goose"]);

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

  it("fails before prompting for agent when no Ralph docs exist", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await expect(program.parseAsync(["node", "cli", "ralph", "run"])).rejects.toBeInstanceOf(
      ValidationError
    );

    expect(selectMock).not.toHaveBeenCalled();
    expect(promptTextMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunRalph)).not.toHaveBeenCalled();
  });

  it("uses defaults with --yes when frontmatter does not provide values", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/plan-b.md": ralphPlanDoc("B"),
        "/repo/docs/plans/plan-a.md": ralphPlanDoc("A")
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
        docPath: "docs/plans/plan-a.md",
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

  it("rejects unknown CLI agent names with a validation error", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": [
          "---",
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
      program.parseAsync(["node", "cli", "ralph", "run", "docs/loop.md", "--agent", "mystery"])
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
        text: `${expectedTimestamp} Config · Agent: claude-code · Iterations: 5 · Cwd: /repo · Doc: docs/loop.md`,
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

  it("uses the ralph.tui config value when set", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const dashboardMock = createDashboardMock();
    vi.mocked(createDashboard).mockReturnValueOnce(dashboardMock.dashboard);

    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/config.json": JSON.stringify({
          ralph: { tui: true }
        }),
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
        "5"
      ])
    );

    expect(vi.mocked(createDashboard)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("lets --no-tui override the ralph.tui config value", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/config.json": JSON.stringify({
          ralph: { tui: true }
        }),
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
        "--no-tui"
      ])
    );

    expect(vi.mocked(createDashboard)).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.not.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("uses the POE_RALPH_TUI env value when set", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const dashboardMock = createDashboardMock();
    vi.mocked(createDashboard).mockReturnValueOnce(dashboardMock.dashboard);

    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": "# Loop"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: {
        cwd,
        homeDir,
        variables: {
          POE_RALPH_TUI: "1"
        }
      },
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
        "5"
      ])
    );

    expect(vi.mocked(createDashboard)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("lets --no-tui override the POE_RALPH_TUI env value", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/loop.md": "# Loop"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: {
        cwd,
        homeDir,
        variables: {
          POE_RALPH_TUI: "1"
        }
      },
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
        "--no-tui"
      ])
    );

    expect(vi.mocked(createDashboard)).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunRalph)).toHaveBeenCalledWith(
      expect.not.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
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

  it("cancels Ralph when SIGINT is received in dashboard mode", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const dashboardMock = createDashboardMock();
    vi.mocked(createDashboard).mockReturnValueOnce(dashboardMock.dashboard);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    try {
      vi.mocked(sdkRunRalph).mockImplementationOnce(async (options) => {
        process.emit("SIGINT");

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

      expect(exitSpy).not.toHaveBeenCalled();
      expect(dashboardMock.appendOutput).toHaveBeenCalledWith({
        kind: "status",
        text: `${expectedTimestamp} Cancellation requested`,
        ts: 0
      });
      expect(process.exitCode).toBe(130);
      expect(logs.some((message) => message.includes("Ralph run cancelled."))).toBe(true);
    } finally {
      exitSpy.mockRestore();
    }
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
        hooks: { from: "claude" },
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
        hooks: { from: "claude" },
        signal: expect.any(AbortSignal),
        useStdin: true,
        tee: expect.objectContaining({
          stderr: expect.any(Object)
        })
      })
    );

    const outputs = dashboardMock.appendOutput.mock.calls.map(([item]) => item);
    expect(
      outputs.some(
        (item) => item.kind === "tool" && item.text.includes("[iteration:1] Analyzing doc")
      )
    ).toBe(true);
    expect(
      outputs.some(
        (item) => item.kind === "tool" && item.text.includes("[iteration:1] Drafting update")
      )
    ).toBe(true);
    expect(
      outputs.some(
        (item) => item.kind === "error" && item.text.includes("[iteration:1] Tool warning")
      )
    ).toBe(true);
    expect(
      outputs.some(
        (item) => item.kind === "error" && item.text.includes("[iteration:1] partial stderr")
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

  it("does not follow a doc symlink inserted before config publish", async () => {
    const docPath = "/repo/docs/loop.md";
    const outsidePath = "/outside/loop.md";
    const baseFs = createMemFs({
      [docPath]: "# My Plan\n\nBody",
      [outsidePath]: "outside-state\n"
    });
    const fs: FileSystem = {
      ...baseFs,
      async writeFile(
        filePath: string,
        data: string | NodeJS.ArrayBufferView,
        options?: { encoding?: BufferEncoding; flag?: string }
      ): Promise<void> {
        if (filePath === docPath) {
          await replaceWithSymlink(baseFs, docPath, outsidePath);
        }
        await baseFs.writeFile(filePath, data, options);
      },
      async rename(oldPath: string, newPath: string): Promise<void> {
        if (newPath === docPath) {
          await replaceWithSymlink(baseFs, docPath, outsidePath);
        }
        await baseFs.rename(oldPath, newPath);
      }
    };
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

    expect(await fs.readFile(outsidePath, "utf8")).toBe("outside-state\n");
    expect((await fs.lstat(docPath)).isSymbolicLink()).toBe(false);
    const parsed = parseFrontmatter(await fs.readFile(docPath, "utf8"));
    expect(parsed.data).toMatchObject({
      agent: "codex",
      iterations: 5
    });
    expect(parsed.body).toBe("# My Plan\n\nBody");
  });

  it("cleans a partial doc temp file when config publish fails", async () => {
    const docPath = "/repo/docs/loop.md";
    const initial = "# My Plan\n\nBody";
    const baseFs = createMemFs({
      [docPath]: initial
    });
    let temporaryPath: string | undefined;
    const fs: FileSystem = {
      ...baseFs,
      async writeFile(
        filePath: string,
        data: string | NodeJS.ArrayBufferView,
        options?: { encoding?: BufferEncoding; flag?: string }
      ): Promise<void> {
        if (
          temporaryPath === undefined &&
          filePath.startsWith(`${docPath}.${process.pid}.`) &&
          filePath.endsWith(".tmp")
        ) {
          temporaryPath = filePath;
          await baseFs.writeFile(filePath, "partial doc config\n", options);
          throw new Error("doc config write failed");
        }
        await baseFs.writeFile(filePath, data, options);
      }
    };
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await withObjectPrototypeCode("EEXIST", async () => {
      await expect(
        program.parseAsync([
          "node",
          "cli",
          "ralph",
          "init",
          "docs/loop.md",
          "--agent",
          "codex",
          "--iterations",
          "5"
        ])
      ).rejects.toThrow("doc config write failed");
    });

    expect(temporaryPath).toBeDefined();
    await expect(fs.readFile(docPath, "utf8")).resolves.toBe(initial);
    await expect(fs.readFile(temporaryPath as string, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
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
      "/repo/docs/plans/plan-a.md": ralphPlanDoc("A")
    });
    selectMock.mockResolvedValueOnce("docs/plans/plan-a.md").mockResolvedValueOnce("codex");
    promptTextMock.mockResolvedValue("4");

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await withMockedTerminal(
      () => program.parseAsync(["node", "cli", "ralph", "init"]),
      { stdin: true }
    );

    const updated = await fs.readFile("/repo/docs/plans/plan-a.md", "utf8");
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

    await program.parseAsync(["node", "cli", "--yes", "ralph", "init", "docs/loop.md"]);

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

  it("rejects missing init agent selection in non-interactive mode", async () => {
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

    await expect(
      withMockedTerminal(
        () => program.parseAsync(["node", "cli", "ralph", "init", "docs/loop.md"]),
        { stdin: false }
      )
    ).rejects.toThrow(
      "Ralph agent selection requires --agent or --yes when running without an interactive TTY."
    );

    expect(selectMock).not.toHaveBeenCalled();
    expect(promptTextMock).not.toHaveBeenCalled();
  });

  it("rejects missing init iterations in non-interactive mode", async () => {
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

    await expect(
      withMockedTerminal(
        () =>
          program.parseAsync([
            "node",
            "cli",
            "ralph",
            "init",
            "docs/loop.md",
            "--agent",
            "codex"
          ]),
        { stdin: false }
      )
    ).rejects.toThrow(
      "Ralph iteration selection requires --iterations or --yes when running without an interactive TTY."
    );

    expect(selectMock).not.toHaveBeenCalled();
    expect(promptTextMock).not.toHaveBeenCalled();
  });

  it("previews initialization without rewriting the document", async () => {
    const original = "# A\n";
    const logs: string[] = [];
    const fs = createMemFs({ "/repo/docs/loop.md": original });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerRalphCommand(program, container);

    await program.parseAsync(["node", "cli", "--dry-run", "--yes", "ralph", "init", "docs/loop.md"]);

    await expect(fs.readFile("/repo/docs/loop.md", "utf8")).resolves.toBe(original);
    expect(logs.join("\n")).toContain("Dry run: would save Ralph config.");
  });
});
