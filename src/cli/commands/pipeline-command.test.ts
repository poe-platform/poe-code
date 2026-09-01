import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command, Help } from "commander";
import { createCliContainer } from "../container.js";
import { hasOwnErrorCode } from "../../utils/error-codes.js";
import type { FileSystem } from "../../utils/file-system.js";
import { registerPipelineCommand } from "./pipeline.js";
import { ValidationError, SilentError } from "../errors.js";
import pipelineSkillPlan from "../../templates/pipeline/SKILL_plan.md";
import pipelineStepsTemplate from "../../templates/pipeline/steps.yaml.mustache";
import { resolveLoopAgent, skillPlanConfigSection } from "@poe-code/agent-harness-tools";
import type { Dashboard } from "toolcraft-design";

const { selectMock, cancelMock, resolvePipelineLoopAgentMock, runWithOptionalWorktreeMock } =
  vi.hoisted(() => ({
    selectMock: vi.fn(),
    cancelMock: vi.fn(),
    resolvePipelineLoopAgentMock: vi.fn(),
    runWithOptionalWorktreeMock: vi.fn()
  }));

const braintrustLoadIntegrationsMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/braintrust", () => ({
  loadIntegrations: braintrustLoadIntegrationsMock
}));

vi.mock("../../sdk/pipeline.js", () => ({
  runPipelineInit: vi.fn().mockResolvedValue({
    stopReason: "done",
    sourcesProcessed: 0
  }),
  runPipeline: vi.fn().mockResolvedValue({
    stopReason: "completed",
    planPath: ".poe-code/pipeline/plans/plan.yaml",
    runsCompleted: 1,
    totalDurationMs: 1_000,
    metrics: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 1
    }
  })
}));

vi.mock("../../sdk/spawn.js", () => ({
  spawn: vi.fn()
}));

vi.mock("../../sdk/worktree.js", () => ({
  runWithOptionalWorktree: runWithOptionalWorktreeMock
}));

vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  return {
    ...actual,
    renderAcpStream: vi.fn().mockResolvedValue(undefined)
  };
});

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    createDashboard: vi.fn(),
    select: selectMock,
    isCancel: (value: unknown) => value === "__cancel__",
    cancel: cancelMock
  };
});

vi.mock("./pipeline-loop-agent.js", () => ({
  resolvePipelineLoopAgent: resolvePipelineLoopAgentMock
}));

import { runPipeline as sdkRunPipeline } from "../../sdk/pipeline.js";
import { runPipelineInit as sdkRunPipelineInit } from "../../sdk/pipeline.js";
import { spawn as sdkSpawn } from "../../sdk/spawn.js";
import { createDashboard, withOutputFormat } from "toolcraft-design";

const cwd = "/repo";
const homeDir = "/home/test";

beforeEach(() => {
  resolvePipelineLoopAgentMock.mockImplementation(resolveLoopAgent);
  runWithOptionalWorktreeMock.mockReset();
  runWithOptionalWorktreeMock.mockImplementation(async (input) => {
    const enabled = input.worktree === true;
    const worktreeCwd = enabled ? "/repo/.poe-code/worktrees/pipeline-wt" : input.cwd;
    const value = await input.run({
      sourceCwd: input.cwd,
      worktreeCwd,
      worktree: {
        name: "pipeline-wt",
        path: worktreeCwd,
        branch: "poe-code/pipeline-wt",
        baseBranch: "HEAD",
        createdAt: "2026-01-01T00:00:00.000Z",
        source: "sdk",
        agent: input.selectedAgent,
        status: "active"
      }
    });
    return { value };
  });
  vi.mocked(sdkRunPipelineInit).mockResolvedValue({
    stopReason: "done",
    sourcesProcessed: 0
  });
  vi.mocked(sdkRunPipeline).mockResolvedValue({
    stopReason: "completed",
    planPath: ".poe-code/pipeline/plans/plan.yaml",
    runsCompleted: 1,
    totalDurationMs: 1_000,
    metrics: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 1
    }
  });
});

const PIPELINE_MD_EMPTY = ["---", "kind: pipeline", "version: 1", "tasks: []", "---", ""].join(
  "\n"
);

function pipelinePlanYaml(lines: string[]): string {
  return ["kind: pipeline", "version: 1", ...lines].join("\n");
}

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });
  for (const [filePath, content] of Object.entries(files)) {
    volume.mkdirSync(path.dirname(filePath), { recursive: true });
    volume.writeFileSync(filePath, content);
  }
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
      Reflect.deleteProperty(process.stdin, "isTTY");
    }

    if (stdoutDescriptor) {
      Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
    } else {
      Reflect.deleteProperty(process.stdout, "isTTY");
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

describe("pipeline run command", () => {
  afterEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    vi.useRealTimers();
  });

  it("asks for a subcommand and exits non-zero when invoked bare", async () => {
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
    registerPipelineCommand(program, container);

    await expect(program.parseAsync(["node", "cli", "pipeline"])).rejects.toBeInstanceOf(
      SilentError
    );

    const plain = stripVTControlCharacters(loggerOutput);
    expect(plain).toMatch(/pick a subcommand/i);
    expect(plain).toContain("run");
    expect(plain).toContain("init");
    expect(process.exitCode).toBe(1);
    expect(sdkRunPipeline).not.toHaveBeenCalled();
  });

  it("documents that plans are archived by default", () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    const pipelineCommand = program.commands.find((cmd) => cmd.name() === "pipeline");
    const runCommand = pipelineCommand?.commands.find((cmd) => cmd.name() === "run");
    const help = (runCommand?.helpInformation() ?? "").replace(/\s+/g, " ");

    expect(help).toContain("Archive each plan after successful completion (default)");
    expect(help).toContain("--no-archive");
  });

  it("calls the pipeline SDK with the CLI options", async () => {
    const fs = createMemFs();
    await fs.writeFile("/repo/custom-plan.yaml", "tasks: []\n", { encoding: "utf8" });
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

  it("passes pipeline archive config to the SDK", async () => {
    const fs = createMemFs({
      "/repo/.poe-code/config.json": JSON.stringify({
        pipeline: { "auto-archive": false }
      }),
      "/repo/custom-plan.yaml": "tasks: []\n"
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
      "--yes",
      "pipeline",
      "run",
      "--plan",
      "custom-plan.yaml",
      "--agent",
      "codex"
    ]);

    expect(vi.mocked(sdkRunPipeline)).toHaveBeenCalledWith(
      expect.objectContaining({
        archive: false
      })
    );
  });

  it("lets --archive override disabled pipeline archive config", async () => {
    const fs = createMemFs({
      "/repo/.poe-code/config.json": JSON.stringify({
        pipeline: { "auto-archive": false }
      }),
      "/repo/custom-plan.yaml": "tasks: []\n"
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
      "--yes",
      "pipeline",
      "run",
      "--plan",
      "custom-plan.yaml",
      "--agent",
      "codex",
      "--archive"
    ]);

    expect(vi.mocked(sdkRunPipeline)).toHaveBeenCalledWith(
      expect.objectContaining({
        archive: true
      })
    );
  });

  it("wraps multiple pipeline plans in one worktree from the CLI", async () => {
    const fs = createMemFs({
      "/repo/plan-a.md": "tasks: []\n",
      "/repo/plan-b.md": "tasks: []\n"
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
      "--yes",
      "pipeline",
      "run",
      "--plans",
      "plan-a.md",
      "plan-b.md",
      "--agent",
      "codex",
      "--worktree"
    ]);

    expect(runWithOptionalWorktreeMock).toHaveBeenCalledTimes(1);
    expect(runWithOptionalWorktreeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd,
        selectedAgent: "codex",
        worktree: true
      })
    );
    expect(vi.mocked(sdkRunPipeline)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sdkRunPipeline)).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        cwd: "/repo/.poe-code/worktrees/pipeline-wt",
        plan: "plan-a.md"
      })
    );
    expect(vi.mocked(sdkRunPipeline)).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cwd: "/repo/.poe-code/worktrees/pipeline-wt",
        plan: "plan-b.md"
      })
    );
  });

  it.each(["failed", "cancelled", "completed", "max_runs", "nothing_to_run"] as const)(
    "classifies a %s sequence outcome before worktree reconciliation",
    async (stopReason) => {
      const fs = createMemFs({ "/repo/plan-a.md": "tasks: []\n", "/repo/plan-b.md": "tasks: []\n" });
      const container = createCliContainer({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        logger: () => {}
      });
      const result = {
        stopReason: "completed" as const,
        planPath: "plan-a.md",
        runsCompleted: 1,
        totalDurationMs: 1,
        metrics: { totalInputTokens: 0, totalOutputTokens: 0, totalCachedTokens: 0, tasksCompleted: 1, tasksFailed: 0, stepsCompleted: 1 }
      };
      vi.mocked(sdkRunPipeline).mockResolvedValueOnce(result).mockResolvedValueOnce({ ...result, stopReason });
      const program = createBaseProgram();
      registerPipelineCommand(program, container);

      await program.parseAsync([
        "node", "cli", "--yes", "pipeline", "run", "--plans", "plan-a.md", "plan-b.md", "--agent", "codex", "--worktree"
      ]);

      expect(sdkRunPipeline).toHaveBeenCalledTimes(2);
      const input = runWithOptionalWorktreeMock.mock.calls[0]![0];
      const output = await runWithOptionalWorktreeMock.mock.results[0]!.value;
      expect(input.isSuccessful).toBeTypeOf("function");
      expect(input.isSuccessful(output.value)).toBe(stopReason !== "failed" && stopReason !== "cancelled");
    }
  );

  it("dry-runs an explicit plan without selecting an agent or invoking the SDK", async () => {
    const logs: string[] = [];
    const planContent = [
      "---",
      "kind: pipeline",
      "version: 1",
      "tasks:",
      "  - id: task-1",
      "    title: Task 1",
      "    prompt: Do task 1",
      "    status: open",
      "---",
      ""
    ].join("\n");
    const fs = createMemFs({
      "/repo/docs/plans/plan.md": planContent
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "pipeline",
      "run",
      "--plan",
      "docs/plans/plan.md",
      "--dry-run"
    ]);

    expect(resolvePipelineLoopAgentMock).not.toHaveBeenCalled();
    expect(braintrustLoadIntegrationsMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunPipeline)).not.toHaveBeenCalled();
    expect(await fs.readFile("/repo/docs/plans/plan.md", "utf8")).toBe(planContent);
    expect(logs.some((message) => message.includes("Would run: docs/plans/plan.md"))).toBe(true);
    expect(logs.some((message) => message.includes("Tasks: 0 done, 0 failed, 1 open"))).toBe(true);
  });

  it("applies run options while dry-running an explicit plan", async () => {
    const logs: string[] = [];
    const planContent = [
      "---",
      "kind: pipeline",
      "version: 1",
      "tasks:",
      "  - id: task-1",
      "    title: Task 1",
      "    prompt: Do task 1",
      "    status: open",
      "  - id: task-2",
      "    title: Task 2",
      "    prompt: Do task 2",
      "    status: open",
      "---",
      ""
    ].join("\n");
    const fs = createMemFs({
      "/repo/docs/plans/plan.md": planContent
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "pipeline",
      "run",
      "--plan",
      "docs/plans/plan.md",
      "--task",
      "task-2",
      "--max-runs",
      "2",
      "--dry-run"
    ]);

    expect(resolvePipelineLoopAgentMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunPipeline)).not.toHaveBeenCalled();
    expect(logs.some((message) => message.includes("Task: task-2"))).toBe(true);
    expect(logs.some((message) => message.includes("Max runs: 2"))).toBe(true);
    expect(logs.some((message) => message.includes("Tasks: 0 done, 0 failed, 1 open"))).toBe(true);
    expect(await fs.readFile("/repo/docs/plans/plan.md", "utf8")).toBe(planContent);
  });

  it("does not recover malformed config while dry-running a pipeline", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/plan.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: task-1",
        "    title: Task 1",
        "    prompt: Do task 1",
        "    status: open",
        "---",
        ""
      ].join("\n"),
      [`${homeDir}/.poe-code/config.json`]: "{ invalid json\n"
    });
    const container = createCliContainer({
      fs,
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
        "--plan",
        "docs/plans/plan.md",
        "--dry-run"
      ])
    ).rejects.toThrow();

    expect(await fs.readFile(`${homeDir}/.poe-code/config.json`, "utf8")).toBe("{ invalid json\n");
    expect(await fs.readdir(`${homeDir}/.poe-code`)).toEqual(["config.json"]);
  });

  it("runs integration pipeline callbacks after CLI callbacks when enabled", async () => {
    const calls: string[] = [];
    braintrustLoadIntegrationsMock.mockResolvedValue({
      pipelineCallbacks: {
        onTaskStart: () => calls.push("integration")
      },
      traceRun: async (_surface: string, _name: string, fn: () => Promise<unknown>) => fn(),
      shutdown: vi.fn(async () => undefined)
    });
    vi.mocked(sdkRunPipeline).mockImplementationOnce(async (options) => {
      options.onTaskStart?.({
        taskId: "task-1",
        taskTitle: "Task 1",
        taskIndex: 1,
        totalTasks: 1
      });
      return {
        stopReason: "completed",
        planPath: "custom-plan.yaml",
        runsCompleted: 1,
        totalDurationMs: 1_000,
        metrics: {
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCachedTokens: 0,
          tasksCompleted: 1,
          tasksFailed: 0,
          stepsCompleted: 1
        }
      };
    });

    const fs = createMemFs({
      [`${homeDir}/.poe-code/config.json`]: JSON.stringify({
        integrations: {
          braintrust: {
            enabled: true,
            apiKey: "key",
            project: "project"
          }
        }
      })
    });
    await fs.writeFile("/repo/custom-plan.yaml", "tasks: []\n", { encoding: "utf8" });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        if (message.startsWith("Task 1")) {
          calls.push("cli");
        }
      }
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
      "--agent",
      "codex"
    ]);

    expect(calls).toEqual(["cli", "integration"]);

    braintrustLoadIntegrationsMock.mockReset();
  });

  it("reads plan.plan_directory for pipeline discovery", async () => {
    const fs = createMemFs();
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      `${homeDir}/.poe-code/config.json`,
      `${JSON.stringify({ plan: { plan_directory: "custom/plans" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );
    await fs.writeFile("/repo/custom-plan.yaml", "tasks: []\n", { encoding: "utf8" });
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
      "run",
      "--plan",
      "custom-plan.yaml",
      "--agent",
      "codex"
    ]);

    expect(vi.mocked(sdkRunPipeline)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex",
        plan: "custom-plan.yaml",
        planDirectory: "custom/plans"
      })
    );
  });

  it("uses core.defaultAgent for pipeline run with --yes and preserves the model", async () => {
    const fs = createMemFs();
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      `${homeDir}/.poe-code/config.json`,
      `${JSON.stringify({ core: { defaultAgent: "codex:openai/gpt-5.4" } }, null, 2)}
`,
      { encoding: "utf8" }
    );
    await fs.writeFile("/repo/plan.yaml", "tasks: []\n", { encoding: "utf8" });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "pipeline", "run", "--plan", "plan.yaml"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunPipeline)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex:openai/gpt-5.4",
        plan: "plan.yaml"
      })
    );
  });

  it("prompts for the pipeline run agent when core.defaultAgent exists without --yes", async () => {
    selectMock.mockResolvedValueOnce("goose");
    const fs = createMemFs();
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      `${homeDir}/.poe-code/config.json`,
      `${JSON.stringify({ core: { defaultAgent: "codex:openai/gpt-5.4" } }, null, 2)}
`,
      { encoding: "utf8" }
    );
    await fs.writeFile("/repo/plan.yaml", "tasks: []\n", { encoding: "utf8" });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await withMockedTerminal(
      () => program.parseAsync(["node", "cli", "pipeline", "run", "--plan", "plan.yaml"]),
      { stdin: true }
    );

    expect(selectMock).toHaveBeenCalledWith({
      message: "Select agent to run pipeline steps with:",
      options: expect.arrayContaining([expect.objectContaining({ value: "goose" })])
    });
    expect(vi.mocked(sdkRunPipeline)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "goose",
        plan: "plan.yaml"
      })
    );
  });

  it("cancels pipeline run when agent selection is cancelled", async () => {
    resolvePipelineLoopAgentMock.mockResolvedValueOnce({ cancelled: true });

    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await withMockedTerminal(() => program.parseAsync(["node", "cli", "pipeline", "run"]), {
      stdin: true
    });

    expect(resolvePipelineLoopAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providedAgent: undefined,
        configuredDefaultAgent: null,
        assumeYes: false,
        fallbackAgent: "claude-code",
        message: "Select agent to run pipeline steps with:",
        select: selectMock,
        isCancel: expect.any(Function)
      })
    );
    expect(cancelMock).toHaveBeenCalledWith("Pipeline run cancelled.");
    expect(vi.mocked(sdkRunPipeline)).not.toHaveBeenCalled();
  });

  it("rejects missing run agent selection in non-interactive mode", async () => {
    const fs = createMemFs();
    await fs.writeFile("/repo/plan.yaml", "tasks: []\n", { encoding: "utf8" });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await expect(
      withMockedTerminal(
        () => program.parseAsync(["node", "cli", "pipeline", "run", "--plan", "plan.yaml"]),
        { stdin: false }
      )
    ).rejects.toThrow(
      "Pipeline run agent selection requires --agent or --yes when running without an interactive TTY."
    );

    expect(resolvePipelineLoopAgentMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunPipeline)).not.toHaveBeenCalled();
  });

  it("rejects discovered plan selection in non-interactive mode", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/plan-a.md": PIPELINE_MD_EMPTY
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await expect(
      withMockedTerminal(
        () => program.parseAsync(["node", "cli", "pipeline", "run", "--agent", "codex"]),
        { stdin: false }
      )
    ).rejects.toThrow(
      "Pipeline plan selection requires --plan, --plans, or --yes when running without an interactive TTY."
    );

    expect(vi.mocked(sdkRunPipeline)).not.toHaveBeenCalled();
  });

  it("rejects manual plan path prompts in non-interactive dry-run mode", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await expect(
      withMockedTerminal(
        () => program.parseAsync(["node", "cli", "pipeline", "run", "--dry-run"]),
        { stdin: false }
      )
    ).rejects.toThrow(
      "Pipeline plan path selection requires --plan, --plans, or --yes when running without an interactive TTY."
    );

    expect(vi.mocked(sdkRunPipeline)).not.toHaveBeenCalled();
  });

  it("defaults to claude-code and resolves agent aliases", async () => {
    const fs = createMemFs();
    await fs.writeFile("/repo/plan.yaml", "tasks: []\n", { encoding: "utf8" });
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
      "run",
      "--agent",
      "claude",
      "--plan",
      "plan.yaml"
    ]);

    expect(vi.mocked(sdkRunPipeline)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code"
      })
    );
  });

  it.each(["0", "2abc"])("rejects invalid max-runs value %s", async (maxRuns) => {
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
        maxRuns
      ])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects malformed max-runs before dry-running a pipeline", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/plan.md": PIPELINE_MD_EMPTY
      }),
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
        "--plan",
        "docs/plans/plan.md",
        "--dry-run",
        "--max-runs",
        "2abc"
      ])
    ).rejects.toBeInstanceOf(ValidationError);

    expect(vi.mocked(sdkRunPipeline)).not.toHaveBeenCalled();
  });

  it("shows usage in task completion and metrics in summary", async () => {
    const logs: string[] = [];
    vi.mocked(sdkRunPipeline).mockImplementationOnce(async (options) => {
      options.onTaskComplete?.({
        taskId: "task-1",
        taskTitle: "Task 1",
        stepName: "implement",
        taskIndex: 1,
        totalTasks: 1,
        durationMs: 2_500,
        success: true,
        usage: {
          inputTokens: 1_234,
          outputTokens: 567
        }
      });
      return {
        stopReason: "completed",
        planPath: ".poe-code/pipeline/plans/plan.md",
        runsCompleted: 1,
        totalDurationMs: 3_000,
        metrics: {
          totalInputTokens: 5_000,
          totalOutputTokens: 2_000,
          totalCachedTokens: 1_000,
          tasksCompleted: 1,
          tasksFailed: 0,
          stepsCompleted: 1
        }
      };
    });

    const fs = createMemFs();
    await fs.mkdir("/repo/docs/plans", { recursive: true });
    await fs.writeFile("/repo/docs/plans/plan.md", PIPELINE_MD_EMPTY, {
      encoding: "utf8"
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "pipeline",
      "run",
      "--agent",
      "codex",
      "--plan",
      "docs/plans/plan.md"
    ]);

    expect(
      logs.some((message) => message.includes("Task task-1 done in 3s (tokens: 1234 in / 567 out)"))
    ).toBe(true);
    expect(
      logs.some((message) => message.includes("Total tokens: 5000 input, 2000 output, 1000 cached"))
    ).toBe(true);
    expect(logs.some((message) => message.includes("Tasks: 1 completed, 0 failed"))).toBe(true);
    expect(logs.some((message) => message.includes("Steps: 1 completed"))).toBe(true);
  });

  it("reports pipeline failures without blocked retry messaging", async () => {
    const logs: string[] = [];
    vi.mocked(sdkRunPipeline).mockResolvedValueOnce({
      stopReason: "failed",
      planPath: ".poe-code/pipeline/plans/plan.md",
      runsCompleted: 1,
      totalDurationMs: 1_000,
      metrics: {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCachedTokens: 0,
        tasksCompleted: 0,
        tasksFailed: 1,
        stepsCompleted: 1
      },
      lastTaskId: "auth-hardening",
      lastStepName: "test"
    });

    const fs = createMemFs();
    await fs.mkdir("/repo/docs/plans", { recursive: true });
    await fs.writeFile("/repo/docs/plans/plan.md", PIPELINE_MD_EMPTY, {
      encoding: "utf8"
    });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "pipeline",
      "run",
      "--agent",
      "codex",
      "--plan",
      "docs/plans/plan.md"
    ]);

    expect(process.exitCode).toBe(1);
    expect(
      logs.some((message) => message.includes("Pipeline failed at auth-hardening (test)."))
    ).toBe(true);
    expect(logs.some((message) => message.includes("Pipeline blocked at"))).toBe(false);
  });

  it("reports nothing to run as an informational outcome with next steps", async () => {
    const logs: string[] = [];
    vi.mocked(sdkRunPipeline).mockResolvedValueOnce({
      stopReason: "nothing_to_run",
      planPath: ".poe-code/pipeline/plans/plan.md",
      runsCompleted: 0,
      totalDurationMs: 5,
      metrics: {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCachedTokens: 0,
        tasksCompleted: 0,
        tasksFailed: 0,
        stepsCompleted: 0
      }
    });

    const fs = createMemFs();
    await fs.mkdir("/repo/docs/plans", { recursive: true });
    await fs.writeFile("/repo/docs/plans/plan.md", PIPELINE_MD_EMPTY, {
      encoding: "utf8"
    });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "pipeline",
      "run",
      "--agent",
      "codex",
      "--plan",
      "docs/plans/plan.md"
    ]);

    expect(logs.some((message) => message.includes("Pipeline run finished."))).toBe(false);
    expect(
      logs.some((message) =>
        message.includes("Nothing to run: all tasks in the plan are already complete.")
      )
    ).toBe(true);
    expect(logs.some((message) => message.includes("status back to open"))).toBe(true);
    expect(logs.filter((message) => message === "Nothing to run.")).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });

  it("runs multiple explicit plans sequentially", async () => {
    vi.mocked(sdkRunPipeline)
      .mockResolvedValueOnce({
        stopReason: "completed",
        planPath: "plan-a.yaml",
        runsCompleted: 1,
        totalDurationMs: 1_000,
        metrics: {
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCachedTokens: 0,
          tasksCompleted: 1,
          tasksFailed: 0,
          stepsCompleted: 1
        }
      })
      .mockResolvedValueOnce({
        stopReason: "completed",
        planPath: "plan-b.yaml",
        runsCompleted: 2,
        totalDurationMs: 2_000,
        metrics: {
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCachedTokens: 0,
          tasksCompleted: 2,
          tasksFailed: 0,
          stepsCompleted: 2
        }
      });

    const fs = createMemFs();
    await fs.writeFile("/repo/plan-a.yaml", "tasks: []\n", { encoding: "utf8" });
    await fs.writeFile("/repo/plan-b.yaml", "tasks: []\n", { encoding: "utf8" });
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
      "run",
      "plan-a.yaml",
      "plan-b.yaml",
      "--agent",
      "codex"
    ]);

    expect(vi.mocked(sdkRunPipeline)).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        plan: "plan-a.yaml",
        agent: "codex"
      })
    );
    expect(vi.mocked(sdkRunPipeline)).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        plan: "plan-b.yaml",
        agent: "codex"
      })
    );
  });

  it("routes pipeline progress through the dashboard when --tui is enabled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const dashboardMock = createDashboardMock();
    vi.mocked(createDashboard).mockReturnValueOnce(dashboardMock.dashboard);

    vi.mocked(sdkRunPipeline).mockImplementationOnce(async (options) => {
      options.onPlanResolved?.({
        planPath: "custom-plan.yaml",
        done: 1,
        failed: 0,
        open: 2,
        total: 3
      });
      options.onTaskStart?.({
        taskId: "auth-hardening",
        taskTitle: "Auth hardening",
        taskIndex: 2,
        totalTasks: 3,
        stepName: "implement",
        stepIndex: 1,
        totalSteps: 2
      });
      options.onTaskComplete?.({
        taskId: "auth-hardening",
        taskTitle: "Auth hardening",
        taskIndex: 2,
        totalTasks: 3,
        stepName: "implement",
        stepIndex: 1,
        totalSteps: 2,
        durationMs: 2_000,
        success: true,
        taskCompleted: true,
        usage: {
          inputTokens: 120,
          outputTokens: 45
        }
      });

      return {
        stopReason: "completed",
        planPath: "custom-plan.yaml",
        runsCompleted: 1,
        totalDurationMs: 2_000,
        metrics: {
          totalInputTokens: 120,
          totalOutputTokens: 45,
          totalCachedTokens: 0,
          tasksCompleted: 1,
          tasksFailed: 0,
          stepsCompleted: 1
        }
      };
    });

    const fs = createMemFs();
    await fs.writeFile("/repo/custom-plan.yaml", "tasks: []\n", { encoding: "utf8" });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await withMockedTerminal(() =>
      program.parseAsync([
        "node",
        "cli",
        "--yes",
        "pipeline",
        "run",
        "--tui",
        "--agent",
        "codex",
        "--model",
        "gpt-5.2",
        "--plan",
        "custom-plan.yaml"
      ])
    );

    expect(vi.mocked(createDashboard)).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Pipeline",
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
        text: `${expectedTimestamp} Config · Agent: codex · Model: gpt-5.2 · Plan: custom-plan.yaml`,
        ts: 0
      },
      {
        kind: "info",
        text: `${expectedTimestamp} Tasks · 1/3 done, 2 open`,
        ts: 0
      },
      {
        kind: "status",
        text: `${expectedTimestamp} Task 2/3: auth-hardening (implement) step 1/2`,
        ts: 0
      },
      {
        kind: "success",
        text: `${expectedTimestamp} Task auth-hardening done in 2s (tokens: 120 in / 45 out)`,
        ts: 0
      }
    ]);
    expect(dashboardMock.updateStats).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "done",
        iterations: 1,
        tokensIn: 120,
        tokensOut: 45,
        currentAction: "Task 2/3 · auth-hardening · implement · step 1/2"
      })
    );
    expect(vi.mocked(sdkRunPipeline)).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
    expect(dashboardMock.stop).toHaveBeenCalledTimes(1);
    expect(dashboardMock.destroy).toHaveBeenCalledTimes(1);
  });

  it("uses the pipeline.tui config value when set", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const dashboardMock = createDashboardMock();
    vi.mocked(createDashboard).mockReturnValueOnce(dashboardMock.dashboard);

    const fs = createMemFs();
    await fs.mkdir("/repo/.poe-code", { recursive: true });
    await fs.writeFile(
      "/repo/.poe-code/config.json",
      `${JSON.stringify({ pipeline: { tui: true } }, null, 2)}\n`,
      { encoding: "utf8" }
    );
    await fs.writeFile("/repo/custom-plan.yaml", "tasks: []\n", { encoding: "utf8" });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await withMockedTerminal(() =>
      program.parseAsync([
        "node",
        "cli",
        "--yes",
        "pipeline",
        "run",
        "--agent",
        "codex",
        "--plan",
        "custom-plan.yaml"
      ])
    );

    expect(vi.mocked(createDashboard)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sdkRunPipeline)).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("lets --no-tui override the pipeline.tui config value", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const fs = createMemFs();
    await fs.mkdir("/repo/.poe-code", { recursive: true });
    await fs.writeFile(
      "/repo/.poe-code/config.json",
      `${JSON.stringify({ pipeline: { tui: true } }, null, 2)}\n`,
      { encoding: "utf8" }
    );
    await fs.writeFile("/repo/custom-plan.yaml", "tasks: []\n", { encoding: "utf8" });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await withMockedTerminal(() =>
      program.parseAsync([
        "node",
        "cli",
        "--yes",
        "pipeline",
        "run",
        "--agent",
        "codex",
        "--plan",
        "custom-plan.yaml",
        "--no-tui"
      ])
    );

    expect(vi.mocked(createDashboard)).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunPipeline)).toHaveBeenCalledWith(
      expect.not.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("uses the POE_PIPELINE_TUI env value when set", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const dashboardMock = createDashboardMock();
    vi.mocked(createDashboard).mockReturnValueOnce(dashboardMock.dashboard);

    const fs = createMemFs();
    await fs.writeFile("/repo/custom-plan.yaml", "tasks: []\n", { encoding: "utf8" });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: {
        cwd,
        homeDir,
        variables: {
          POE_PIPELINE_TUI: "1"
        }
      },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await withMockedTerminal(() =>
      program.parseAsync([
        "node",
        "cli",
        "--yes",
        "pipeline",
        "run",
        "--agent",
        "codex",
        "--plan",
        "custom-plan.yaml"
      ])
    );

    expect(vi.mocked(createDashboard)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sdkRunPipeline)).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("lets --no-tui override the POE_PIPELINE_TUI env value", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const fs = createMemFs();
    await fs.writeFile("/repo/custom-plan.yaml", "tasks: []\n", { encoding: "utf8" });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: {
        cwd,
        homeDir,
        variables: {
          POE_PIPELINE_TUI: "1"
        }
      },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await withMockedTerminal(() =>
      program.parseAsync([
        "node",
        "cli",
        "--yes",
        "pipeline",
        "run",
        "--agent",
        "codex",
        "--plan",
        "custom-plan.yaml",
        "--no-tui"
      ])
    );

    expect(vi.mocked(createDashboard)).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunPipeline)).toHaveBeenCalledWith(
      expect.not.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("falls back to the logger path when --tui is used with non-terminal output", async () => {
    const fs = createMemFs();
    await fs.writeFile("/repo/custom-plan.yaml", "tasks: []\n", { encoding: "utf8" });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await withOutputFormat("json", () =>
      withMockedTerminal(() =>
        program.parseAsync([
          "node",
          "cli",
          "pipeline",
          "run",
          "--plan",
          "custom-plan.yaml",
          "--agent",
          "claude",
          "--tui"
        ])
      )
    );

    expect(vi.mocked(createDashboard)).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunPipeline)).toHaveBeenCalledWith(
      expect.not.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("aborts the pipeline when the dashboard quit command is used", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const dashboardMock = createDashboardMock();
    vi.mocked(createDashboard).mockReturnValueOnce(dashboardMock.dashboard);

    vi.mocked(sdkRunPipeline).mockImplementationOnce(async (options) => {
      dashboardMock.commandHandlers[0]?.("quit");

      expect(options.signal?.aborted).toBe(true);

      return {
        stopReason: "cancelled",
        planPath: "custom-plan.yaml",
        runsCompleted: 0,
        totalDurationMs: 1_000,
        metrics: {
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCachedTokens: 0,
          tasksCompleted: 0,
          tasksFailed: 0,
          stepsCompleted: 0
        }
      };
    });

    const logs: string[] = [];
    const fs = createMemFs();
    await fs.writeFile("/repo/custom-plan.yaml", "tasks: []\n", { encoding: "utf8" });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await withMockedTerminal(() =>
      program.parseAsync([
        "node",
        "cli",
        "--yes",
        "pipeline",
        "run",
        "--tui",
        "--agent",
        "codex",
        "--plan",
        "custom-plan.yaml"
      ])
    );

    expect(dashboardMock.appendOutput).toHaveBeenCalledWith({
      kind: "status",
      text: `${expectedTimestamp} Cancellation requested`,
      ts: 0
    });
    expect(process.exitCode).toBe(130);
    expect(logs.some((message) => message.includes("Pipeline run cancelled."))).toBe(true);
  });

  it("cancels the pipeline when SIGINT is received in dashboard mode", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const dashboardMock = createDashboardMock();
    vi.mocked(createDashboard).mockReturnValueOnce(dashboardMock.dashboard);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    try {
      vi.mocked(sdkRunPipeline).mockImplementationOnce(async (options) => {
        process.emit("SIGINT");

        expect(options.signal?.aborted).toBe(true);

        return {
          stopReason: "cancelled",
          planPath: "custom-plan.yaml",
          runsCompleted: 0,
          totalDurationMs: 1_000,
          metrics: {
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCachedTokens: 0,
            tasksCompleted: 0,
            tasksFailed: 0,
            stepsCompleted: 0
          }
        };
      });

      const logs: string[] = [];
      const fs = createMemFs();
      await fs.writeFile("/repo/custom-plan.yaml", "tasks: []\n", { encoding: "utf8" });
      const container = createCliContainer({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        logger: (message) => logs.push(message)
      });
      const program = createBaseProgram();
      registerPipelineCommand(program, container);

      await withMockedTerminal(() =>
        program.parseAsync([
          "node",
          "cli",
          "--yes",
          "pipeline",
          "run",
          "--tui",
          "--agent",
          "codex",
          "--plan",
          "custom-plan.yaml"
        ])
      );

      expect(exitSpy).not.toHaveBeenCalled();
      expect(dashboardMock.appendOutput).toHaveBeenCalledWith({
        kind: "status",
        text: `${expectedTimestamp} Cancellation requested`,
        ts: 0
      });
      expect(process.exitCode).toBe(130);
      expect(logs.some((message) => message.includes("Pipeline run cancelled."))).toBe(true);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("streams child-agent stdout and stderr into the dashboard via tee", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const dashboardMock = createDashboardMock();
    vi.mocked(createDashboard).mockReturnValueOnce(dashboardMock.dashboard);

    vi.mocked(sdkSpawn).mockImplementationOnce((_agent, input) => {
      input.tee?.stdout?.write("Inspecting repo");
      input.tee?.stdout?.write("...\nsecond line\npartial");
      input.tee?.stderr?.write("Tool warning\npartial stderr");

      return {
        events: (async function* () {})(),
        result: Promise.resolve({
          stdout: "",
          stderr: "",
          exitCode: 0,
          usage: {
            inputTokens: 120,
            outputTokens: 45
          }
        })
      };
    });

    vi.mocked(sdkRunPipeline).mockImplementationOnce(async (options) => {
      options.onTaskStart?.({
        taskId: "auth-hardening",
        taskTitle: "Auth hardening",
        taskIndex: 2,
        totalTasks: 3,
        stepName: "implement",
        stepIndex: 1,
        totalSteps: 2
      });

      await options.runAgent?.({
        agent: "codex",
        prompt: "Inspect the repo",
        mode: "yolo",
        cwd,
        model: "gpt-5.2",
        hooks: { from: "claude", strategy: "transform", scope: "merged" },
        signal: options.signal
      });

      options.onTaskComplete?.({
        taskId: "auth-hardening",
        taskTitle: "Auth hardening",
        taskIndex: 2,
        totalTasks: 3,
        stepName: "implement",
        stepIndex: 1,
        totalSteps: 2,
        durationMs: 2_000,
        success: true,
        usage: {
          inputTokens: 120,
          outputTokens: 45
        }
      });

      return {
        stopReason: "completed",
        planPath: "custom-plan.yaml",
        runsCompleted: 1,
        totalDurationMs: 2_000,
        metrics: {
          totalInputTokens: 120,
          totalOutputTokens: 45,
          totalCachedTokens: 0,
          tasksCompleted: 1,
          tasksFailed: 0,
          stepsCompleted: 1
        }
      };
    });

    const fs = createMemFs();
    await fs.writeFile("/repo/custom-plan.yaml", "tasks: []\n", { encoding: "utf8" });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await withMockedTerminal(() =>
      program.parseAsync([
        "node",
        "cli",
        "--yes",
        "pipeline",
        "run",
        "--tui",
        "--agent",
        "codex",
        "--model",
        "gpt-5.2",
        "--plan",
        "custom-plan.yaml"
      ])
    );

    expect(vi.mocked(sdkSpawn)).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({
        prompt: "Inspect the repo",
        cwd,
        model: "gpt-5.2",
        mode: "yolo",
        hooks: { from: "claude", strategy: "transform", scope: "merged" },
        signal: expect.any(AbortSignal),
        tee: expect.objectContaining({
          stdout: expect.any(Object),
          stderr: expect.any(Object)
        })
      })
    );

    const outputs = dashboardMock.appendOutput.mock.calls.map(([item]) => item);
    expect(
      outputs.some(
        (item) =>
          item.kind === "tool" &&
          item.text.includes("[auth-hardening:implement] Inspecting repo...")
      )
    ).toBe(true);
    expect(
      outputs.some(
        (item) =>
          item.kind === "tool" && item.text.includes("[auth-hardening:implement] second line")
      )
    ).toBe(true);
    expect(
      outputs.some(
        (item) => item.kind === "tool" && item.text.includes("[auth-hardening:implement] partial")
      )
    ).toBe(true);
    expect(
      outputs.some(
        (item) =>
          item.kind === "error" && item.text.includes("[auth-hardening:implement] Tool warning")
      )
    ).toBe(true);
    expect(
      outputs.some(
        (item) =>
          item.kind === "error" && item.text.includes("[auth-hardening:implement] partial stderr")
      )
    ).toBe(true);
  });

  it("retries timed out pipeline agent runs without losing fallback stdout from the successful attempt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const dashboardMock = createDashboardMock();
    vi.mocked(createDashboard).mockReturnValueOnce(dashboardMock.dashboard);

    const timeoutError = new Error("Timed out waiting for agent activity for 600000ms.");
    timeoutError.name = "ActivityTimeoutError";

    vi.mocked(sdkSpawn)
      .mockImplementationOnce((_agent, input) => {
        input.tee?.stdout?.write("first attempt output\n");

        return {
          events: (async function* () {})(),
          result: Promise.reject(timeoutError)
        };
      })
      .mockImplementationOnce(() => ({
        events: (async function* () {})(),
        result: Promise.resolve({
          stdout: "retry fallback output",
          stderr: "",
          exitCode: 0,
          usage: {
            inputTokens: 120,
            outputTokens: 45
          }
        })
      }));

    vi.mocked(sdkRunPipeline).mockImplementationOnce(async (options) => {
      options.onTaskStart?.({
        taskId: "auth-hardening",
        taskTitle: "Auth hardening",
        taskIndex: 2,
        totalTasks: 3,
        stepName: "implement",
        stepIndex: 1,
        totalSteps: 2
      });

      await options.runAgent?.({
        agent: "codex",
        prompt: "Inspect the repo",
        mode: "yolo",
        cwd,
        model: "gpt-5.2",
        signal: options.signal
      });

      options.onTaskComplete?.({
        taskId: "auth-hardening",
        taskTitle: "Auth hardening",
        taskIndex: 2,
        totalTasks: 3,
        stepName: "implement",
        stepIndex: 1,
        totalSteps: 2,
        durationMs: 2_000,
        success: true,
        usage: {
          inputTokens: 120,
          outputTokens: 45
        }
      });

      return {
        stopReason: "completed",
        planPath: "custom-plan.yaml",
        runsCompleted: 1,
        totalDurationMs: 2_000,
        metrics: {
          totalInputTokens: 120,
          totalOutputTokens: 45,
          totalCachedTokens: 0,
          tasksCompleted: 1,
          tasksFailed: 0,
          stepsCompleted: 1
        }
      };
    });

    const fs = createMemFs();
    await fs.writeFile("/repo/custom-plan.yaml", "tasks: []\n", { encoding: "utf8" });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await withMockedTerminal(() =>
      program.parseAsync([
        "node",
        "cli",
        "--yes",
        "pipeline",
        "run",
        "--tui",
        "--agent",
        "codex",
        "--model",
        "gpt-5.2",
        "--plan",
        "custom-plan.yaml"
      ])
    );

    expect(vi.mocked(sdkSpawn)).toHaveBeenCalledTimes(2);

    const outputs = dashboardMock.appendOutput.mock.calls.map(([item]) => item);
    expect(
      outputs.some(
        (item) =>
          item.kind === "tool" &&
          item.text.includes("[auth-hardening:implement] first attempt output")
      )
    ).toBe(true);
    expect(
      outputs.some(
        (item) =>
          item.kind === "tool" &&
          item.text.includes("[auth-hardening:implement] retry fallback output")
      )
    ).toBe(true);
  });
});

describe("pipeline init command", () => {
  afterEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it("rejects --source together with --sources", async () => {
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
        "--yes",
        "pipeline",
        "init",
        "--source",
        "docs/plans/alpha.md",
        "--sources",
        "docs/plans/beta.md"
      ])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects --yes without any sources", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await expect(program.parseAsync(["node", "cli", "--yes", "pipeline", "init"])).rejects.toEqual(
      new ValidationError("Provide --source or --sources when using --yes.")
    );
  });

  it("passes two sources to the pipeline init SDK and logs progress", async () => {
    const logs: string[] = [];
    vi.mocked(sdkRunPipelineInit).mockImplementationOnce(async (options) => {
      options.onSourceStart?.(options.sources[0]!, 1, 2);
      options.onSourceComplete?.(options.sources[0]!, 1, 2, {
        stdout: "alpha",
        stderr: "",
        exitCode: 0
      });
      options.onSourceStart?.(options.sources[1]!, 2, 2);
      options.onSourceComplete?.(options.sources[1]!, 2, 2, {
        stdout: "beta",
        stderr: "",
        exitCode: 0
      });
      return {
        stopReason: "done",
        sourcesProcessed: 2
      };
    });

    const fs = createMemFs({
      "/repo/docs/plans/alpha.md": "# Alpha\n",
      "/repo/docs/plans/beta.md": "# Beta\n"
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "pipeline",
      "init",
      "--agent",
      "claude",
      "--model",
      "claude-sonnet-4.5",
      "--sources",
      "docs/plans/alpha.md",
      "docs/plans/beta.md",
      "Build the pipeline plan"
    ]);

    expect(vi.mocked(sdkRunPipelineInit)).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd,
        homeDir,
        assumeYes: true,
        agent: "claude-code",
        model: "claude-sonnet-4.5",
        question: "Build the pipeline plan",
        sources: [
          {
            absolutePath: "/repo/docs/plans/alpha.md",
            relativePath: "docs/plans/alpha.md",
            title: "alpha"
          },
          {
            absolutePath: "/repo/docs/plans/beta.md",
            relativePath: "docs/plans/beta.md",
            title: "beta"
          }
        ]
      })
    );
    expect(logs.some((message) => message.includes("Source 1/2: docs/plans/alpha.md"))).toBe(true);
    expect(logs.some((message) => message.includes("Completed 1/2: docs/plans/alpha.md"))).toBe(
      true
    );
    expect(logs.some((message) => message.includes("Source 2/2: docs/plans/beta.md"))).toBe(true);
    expect(logs.some((message) => message.includes("Completed 2/2: docs/plans/beta.md"))).toBe(
      true
    );
    expect(logs.some((message) => message.includes("Pipeline init finished."))).toBe(true);
  });

  it("dry-runs pipeline init without invoking the SDK", async () => {
    const logs: string[] = [];
    const fs = createMemFs({
      "/repo/docs/plans/alpha.md": "# Alpha\n"
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "--yes",
      "pipeline",
      "init",
      "--agent",
      "codex",
      "--source",
      "docs/plans/alpha.md"
    ]);

    expect(vi.mocked(sdkRunPipelineInit)).not.toHaveBeenCalled();
    expect(logs.some((message) => message.includes("Would initialize: docs/plans/alpha.md"))).toBe(
      true
    );
    expect(
      logs.some((message) => message.includes("Would generate pipeline plans with codex"))
    ).toBe(true);
  });

  it("uses core.defaultAgent for init with --yes and preserves the model", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/alpha.md": "# Alpha\n"
    });
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      `${homeDir}/.poe-code/config.json`,
      `${JSON.stringify({ core: { defaultAgent: "codex:openai/gpt-5.4" } }, null, 2)}
`,
      { encoding: "utf8" }
    );
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
      "init",
      "--source",
      "docs/plans/alpha.md",
      "Build the pipeline plan"
    ]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunPipelineInit)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex:openai/gpt-5.4",
        question: "Build the pipeline plan",
        sources: [
          {
            absolutePath: "/repo/docs/plans/alpha.md",
            relativePath: "docs/plans/alpha.md",
            title: "alpha"
          }
        ]
      })
    );
  });

  it("prompts for the pipeline init agent when core.defaultAgent exists without --yes", async () => {
    selectMock.mockResolvedValueOnce("goose");
    const fs = createMemFs({
      "/repo/docs/plans/alpha.md": "# Alpha\n"
    });
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      `${homeDir}/.poe-code/config.json`,
      `${JSON.stringify({ core: { defaultAgent: "codex:openai/gpt-5.4" } }, null, 2)}
`,
      { encoding: "utf8" }
    );
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await withMockedTerminal(
      () =>
        program.parseAsync([
          "node",
          "cli",
          "pipeline",
          "init",
          "--source",
          "docs/plans/alpha.md",
          "Build the pipeline plan"
        ]),
      { stdin: true }
    );

    expect(selectMock).toHaveBeenCalledWith({
      message: "Select agent to generate pipeline plans with:",
      options: expect.arrayContaining([expect.objectContaining({ value: "goose" })])
    });
    expect(vi.mocked(sdkRunPipelineInit)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "goose",
        question: "Build the pipeline plan"
      })
    );
  });

  it("cancels pipeline init when agent selection is cancelled", async () => {
    resolvePipelineLoopAgentMock.mockResolvedValueOnce({ cancelled: true });

    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await withMockedTerminal(() => program.parseAsync(["node", "cli", "pipeline", "init"]), {
      stdin: true
    });

    expect(resolvePipelineLoopAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providedAgent: undefined,
        configuredDefaultAgent: null,
        assumeYes: false,
        fallbackAgent: "claude-code",
        message: "Select agent to generate pipeline plans with:",
        select: selectMock,
        isCancel: expect.any(Function)
      })
    );
    expect(cancelMock).toHaveBeenCalledWith("Pipeline init cancelled.");
    expect(vi.mocked(sdkRunPipelineInit)).not.toHaveBeenCalled();
  });

  it("rejects missing init agent selection in non-interactive mode", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/alpha.md": "# Alpha\n"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await expect(
      withMockedTerminal(
        () =>
          program.parseAsync([
            "node",
            "cli",
            "pipeline",
            "init",
            "--source",
            "docs/plans/alpha.md"
          ]),
        { stdin: false }
      )
    ).rejects.toThrow(
      "Pipeline init agent selection requires --agent or --yes when running without an interactive TTY."
    );

    expect(resolvePipelineLoopAgentMock).not.toHaveBeenCalled();
    expect(vi.mocked(sdkRunPipelineInit)).not.toHaveBeenCalled();
  });

  it("rejects source selection in non-interactive mode", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/alpha.md": "# Alpha\n"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await expect(
      withMockedTerminal(
        () => program.parseAsync(["node", "cli", "pipeline", "init", "--agent", "codex"]),
        { stdin: false }
      )
    ).rejects.toThrow(
      "Pipeline source selection requires --source or --sources when running without an interactive TTY."
    );

    expect(vi.mocked(sdkRunPipelineInit)).not.toHaveBeenCalled();
  });
});

describe("pipeline validate command", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("describes markdown plans in help output", () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    const pipelineCommand = program.commands.find((cmd) => cmd.name() === "pipeline");
    const validateCommand = pipelineCommand?.commands.find((cmd) => cmd.name() === "validate");

    expect(validateCommand).toBeDefined();

    const help = validateCommand?.helpInformation() ?? "";
    expect(help).toContain("Validate a pipeline plan markdown file without running it.");
    expect(help).toContain("Path to the pipeline plan markdown file");
    expect(help).not.toContain("YAML");
  });

  it("validates a plan file and reports success", async () => {
    const fs = createMemFs();
    await fs.mkdir("/repo/.poe-code/pipeline/plans", { recursive: true });
    await fs.writeFile(
      "/repo/.poe-code/pipeline/plans/plan-demo.yaml",
      pipelinePlanYaml([
        "tasks:",
        "  - id: one",
        "    title: Task one",
        "    prompt: Do the thing",
        "    status: open",
        ""
      ]),
      { encoding: "utf8" }
    );

    const container = createCliContainer({
      fs,
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
        "validate",
        ".poe-code/pipeline/plans/plan-demo.yaml"
      ])
    ).resolves.not.toThrow();
  });

  it("validates step references against steps.yaml", async () => {
    const fs = createMemFs();
    await fs.mkdir("/repo/.poe-code/pipeline/plans", { recursive: true });
    await fs.writeFile(
      "/repo/.poe-code/pipeline/steps.yaml",
      ["steps:", "  implement:", "    prompt: Implement {{id}}", ""].join("\n"),
      { encoding: "utf8" }
    );
    await fs.writeFile(
      "/repo/.poe-code/pipeline/plans/plan-bad.yaml",
      pipelinePlanYaml([
        "tasks:",
        "  - id: one",
        "    title: Task one",
        "    prompt: Do the thing",
        "    status:",
        "      nonexistent: open",
        ""
      ]),
      { encoding: "utf8" }
    );

    const container = createCliContainer({
      fs,
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
        "validate",
        ".poe-code/pipeline/plans/plan-bad.yaml"
      ])
    ).rejects.toThrow(/unknown step/i);
  });

  it("--preview renders expanded prompt for a stepless task", async () => {
    const fs = createMemFs();
    await fs.mkdir("/repo/.poe-code/pipeline/plans", { recursive: true });
    await fs.writeFile(
      "/repo/.poe-code/pipeline/plans/plan-demo.yaml",
      pipelinePlanYaml([
        "tasks:",
        "  - id: deploy",
        "    title: Deploy",
        "    prompt: Deploy to production.",
        "    status: open",
        ""
      ]),
      { encoding: "utf8" }
    );

    const logs: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (msg) => logs.push(msg)
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "pipeline",
      "validate",
      "--preview",
      ".poe-code/pipeline/plans/plan-demo.yaml"
    ]);

    expect(logs.join("\n")).toContain("Deploy to production.");
  });

  it("--preview expands vars into prompts", async () => {
    const fs = createMemFs();
    await fs.mkdir("/repo/.poe-code/pipeline/plans", { recursive: true });
    await fs.writeFile(
      "/repo/.poe-code/pipeline/plans/plan-demo.yaml",
      pipelinePlanYaml([
        "vars:",
        "  env: staging",
        "tasks:",
        "  - id: deploy",
        "    title: Deploy",
        "    prompt: Deploy to {{env}}.",
        "    status: open",
        ""
      ]),
      { encoding: "utf8" }
    );

    const logs: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (msg) => logs.push(msg)
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "pipeline",
      "validate",
      "--preview",
      ".poe-code/pipeline/plans/plan-demo.yaml"
    ]);

    expect(logs.join("\n")).toContain("Deploy to staging.");
    expect(logs.join("\n")).not.toContain("{{env}}");
  });

  it("--preview expands file-backed vars into prompts", async () => {
    const fs = createMemFs();
    await fs.mkdir("/repo/.poe-code/pipeline/plans", { recursive: true });
    await fs.mkdir("/repo/docs/plans", { recursive: true });
    await fs.writeFile("/repo/docs/plans/feature.md", "# Feature Plan\nBuild the thing.", {
      encoding: "utf8"
    });
    await fs.writeFile(
      "/repo/.poe-code/pipeline/plans/plan-demo.yaml",
      pipelinePlanYaml([
        "vars:",
        "  plan_doc: \"{{file 'docs/plans/feature.md'}}\"",
        "tasks:",
        "  - id: implement",
        "    title: Implement",
        "    prompt: |",
        "      {{plan_doc}}",
        "      Do the work.",
        "    status: open",
        ""
      ]),
      { encoding: "utf8" }
    );

    const logs: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (msg) => logs.push(msg)
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "pipeline",
      "validate",
      "--preview",
      ".poe-code/pipeline/plans/plan-demo.yaml"
    ]);

    const output = logs.join("\n");
    expect(output).toContain("# Feature Plan");
    expect(output).toContain("Build the thing.");
    expect(output).toContain("Do the work.");
  });

  it("--preview renders each step for a stepped task", async () => {
    const fs = createMemFs();
    await fs.mkdir("/repo/.poe-code/pipeline/plans", { recursive: true });
    await fs.writeFile(
      "/repo/.poe-code/pipeline/steps.yaml",
      [
        "steps:",
        "  implement:",
        "    prompt: |",
        "      {{id}}: {{title}}",
        "      {{prompt}}",
        "  test:",
        "    prompt: |",
        "      Test {{id}}.",
        ""
      ].join("\n"),
      { encoding: "utf8" }
    );
    await fs.writeFile(
      "/repo/.poe-code/pipeline/plans/plan-demo.yaml",
      pipelinePlanYaml([
        "tasks:",
        "  - id: auth",
        "    title: Auth hardening",
        "    prompt: Improve auth.",
        "    status:",
        "      implement: open",
        "      test: open",
        ""
      ]),
      { encoding: "utf8" }
    );

    const logs: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (msg) => logs.push(msg)
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "pipeline",
      "validate",
      "--preview",
      ".poe-code/pipeline/plans/plan-demo.yaml"
    ]);

    const output = logs.join("\n");
    expect(output).toContain("auth: Auth hardening");
    expect(output).toContain("Improve auth.");
    expect(output).toContain("Test auth.");
  });
});

describe("pipeline plan directory help surface", () => {
  it("lists the plan directory query as a verb command keeping plan-path as an alias", () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    const pipeline = program.commands.find((command) => command.name() === "pipeline")!;
    const visible = new Help().visibleCommands(pipeline);

    expect(visible.map((command) => command.name())).not.toContain("plan-path");
    expect(visible.map((command) => command.name())).toContain("show-plan-path");
    expect(visible.find((command) => command.name() === "show-plan-path")?.aliases()).toEqual([
      "plan-path"
    ]);
  });

  it("does not add plan-path to the options of pipeline subcommands", () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    const pipeline = program.commands.find((command) => command.name() === "pipeline")!;

    expect(pipeline.options.map((option) => option.long)).not.toContain("--plan-path");
  });

  it("describes install without leaking the internal skill path", () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    const install = program.commands
      .find((command) => command.name() === "pipeline")!
      .commands.find((command) => command.name() === "install")!;

    expect(install.description()).toBe("Install the Pipeline skill and scaffold pipeline files.");
    expect(install.options.find((option) => option.long === "--agent")?.description).toBe(
      "Target agent"
    );
  });
});

describe("pipeline plan-path command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the shared plans path for the verb-form command", async () => {
    const fs = createMemFs();
    await fs.mkdir("/repo/.poe-code", { recursive: true });

    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync(["node", "cli", "pipeline", "show-plan-path"]);

    expect(writeSpy).toHaveBeenCalledWith("/repo/docs/plans\n");
  });

  it("prints the shared plans path", async () => {
    const fs = createMemFs();
    await fs.mkdir("/repo/.poe-code", { recursive: true });

    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync(["node", "cli", "pipeline", "plan-path"]);

    expect(writeSpy).toHaveBeenCalledWith("/repo/docs/plans\n");
  });

  it("does not recover malformed project config while printing the path", async () => {
    const fs = createMemFs({
      "/repo/.poe-code/config.json": "{ invalid json\n"
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await expect(program.parseAsync(["node", "cli", "pipeline", "plan-path"])).rejects.toThrow();

    expect(await fs.readFile("/repo/.poe-code/config.json", "utf8")).toBe("{ invalid json\n");
    expect(await fs.readdir("/repo/.poe-code")).toEqual(["config.json"]);
  });
});

describe("pipeline install command", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("ships markdown frontmatter instructions in the pipeline skill template", () => {
    expect(pipelineSkillPlan).toContain("Generate a Pipeline plan markdown file");
    expect(pipelineSkillPlan).toContain(
      "A file in the plan directory matches the topic (filename stem or `# heading`): overwrite it, regardless of its `kind:`. One file per topic."
    );
    expect(pipelineSkillPlan).toContain("Otherwise: create `<plan-directory>/<name>.md`.");
    expect(pipelineSkillPlan).toContain("kind: pipeline");
    expect(pipelineSkillPlan).toContain("version: 1");
    expect(pipelineSkillPlan).toContain("```markdown");
    expect(pipelineSkillPlan).toContain("# Context");
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
    ).resolves.toBe(pipelineSkillPlan + "\n\n" + skillPlanConfigSection("pipeline"));
    await expect(fs.readFile("/repo/.poe-code/pipeline/steps.yaml", "utf8")).resolves.toBe(
      pipelineStepsTemplate
    );
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

    await program.parseAsync(["node", "cli", "--yes", "pipeline", "install"]);

    await expect(
      fs.readFile("/repo/.claude/skills/poe-code-pipeline-plan/SKILL.md", "utf8")
    ).resolves.toBe(pipelineSkillPlan + "\n\n" + skillPlanConfigSection("pipeline"));
    await expect(fs.readFile("/repo/.poe-code/pipeline/steps.yaml", "utf8")).resolves.toBe(
      pipelineStepsTemplate
    );
  });

  it("does not treat inherited stat codes as missing pipeline install paths", async () => {
    const fs = createMemFs();
    const statError = new Error("pipeline stat denied");
    const originalStat = fs.stat.bind(fs);
    vi.spyOn(fs, "stat").mockImplementation(async (filePath) => {
      if (String(filePath) === "/repo/.poe-code/pipeline/plans") {
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
    registerPipelineCommand(program, container);

    await withObjectPrototypeCode("ENOENT", async () => {
      await expect(
        program.parseAsync([
          "node",
          "cli",
          "pipeline",
          "install",
          "--agent",
          "claude-code",
          "--local"
        ])
      ).rejects.toBe(statError);
    });
  });

  it("uses core.defaultAgent for install with --yes and drops the model portion", async () => {
    const fs = createMemFs();
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      `${homeDir}/.poe-code/config.json`,
      `${JSON.stringify({ core: { defaultAgent: "codex:openai/gpt-5.4" } }, null, 2)}
`,
      { encoding: "utf8" }
    );
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "pipeline", "install", "--local"]);

    expect(selectMock).not.toHaveBeenCalled();
    await expect(
      fs.readFile("/repo/.codex/skills/poe-code-pipeline-plan/SKILL.md", "utf8")
    ).resolves.toBe(pipelineSkillPlan + "\n\n" + skillPlanConfigSection("pipeline"));
  });

  it("cancels pipeline install when agent selection is cancelled", async () => {
    resolvePipelineLoopAgentMock.mockResolvedValueOnce({ cancelled: true });

    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await withMockedTerminal(() => program.parseAsync(["node", "cli", "pipeline", "install"]), {
      stdin: true
    });

    expect(resolvePipelineLoopAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providedAgent: undefined,
        configuredDefaultAgent: null,
        assumeYes: false,
        fallbackAgent: "claude-code",
        message: "Select agent to install the Pipeline skill for:",
        select: selectMock,
        isCancel: expect.any(Function)
      })
    );
    expect(cancelMock).toHaveBeenCalledWith("Pipeline install cancelled.");
  });

  it("rejects missing install agent selection in non-interactive mode", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await expect(
      withMockedTerminal(() => program.parseAsync(["node", "cli", "pipeline", "install"]), {
        stdin: false
      })
    ).rejects.toThrow(
      "Pipeline install agent selection requires --agent or --yes when running without an interactive TTY."
    );

    expect(resolvePipelineLoopAgentMock).not.toHaveBeenCalled();
  });

  it("rejects missing install scope selection in non-interactive mode", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await expect(
      withMockedTerminal(
        () => program.parseAsync(["node", "cli", "pipeline", "install", "--agent", "claude-code"]),
        { stdin: false }
      )
    ).rejects.toThrow(
      "Pipeline install scope selection requires --local, --global, or --yes when running without an interactive TTY."
    );
  });

  it("reports already installed instead of claiming an install when every step is skipped", async () => {
    const logs: string[] = [];
    const fs = createMemFs({
      "/repo/.poe-code/pipeline/steps.yaml": pipelineStepsTemplate,
      "/repo/.claude/skills/poe-code-pipeline-plan/SKILL.md":
        pipelineSkillPlan + "\n\n" + skillPlanConfigSection("pipeline")
    });
    await fs.mkdir("/repo/.poe-code/pipeline/plans", { recursive: true });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
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

    expect(logs.some((message) => message.includes("Installed Pipeline skill"))).toBe(false);
    expect(
      logs.some((message) =>
        message.includes(
          "Pipeline skill for claude-code and local pipeline files already installed (nothing to do)"
        )
      )
    ).toBe(true);
  });

  it("reports an install when the skill and pipeline files are created", async () => {
    const logs: string[] = [];
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
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

    expect(
      logs.some((message) =>
        message.includes(
          "Installed Pipeline skill for claude-code and scaffolded local pipeline files"
        )
      )
    ).toBe(true);
  });

  it("does not claim a would-install dry run when every step is skipped", async () => {
    const logs: string[] = [];
    const fs = createMemFs({
      "/repo/.poe-code/pipeline/steps.yaml": pipelineStepsTemplate,
      "/repo/.claude/skills/poe-code-pipeline-plan/SKILL.md":
        pipelineSkillPlan + "\n\n" + skillPlanConfigSection("pipeline")
    });
    await fs.mkdir("/repo/.poe-code/pipeline/plans", { recursive: true });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "pipeline",
      "install",
      "--agent",
      "claude-code",
      "--local"
    ]);

    expect(logs.some((message) => message.includes("Would install Pipeline skill"))).toBe(false);
    expect(logs.some((message) => message.includes("already installed (nothing to do)"))).toBe(
      true
    );
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

    await expect(fs.readFile("/repo/.poe-code/pipeline/steps.yaml", "utf8")).resolves.toBe(
      "EXISTING_STEPS"
    );

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

    await expect(fs.readFile("/repo/.poe-code/pipeline/steps.yaml", "utf8")).resolves.toBe(
      pipelineStepsTemplate
    );
  });

  it("overwrites an existing pipeline skill with --force and shows the diff", async () => {
    const skillPath = "/repo/.claude/skills/poe-code-pipeline-plan/SKILL.md";
    const fs = createMemFs({ [skillPath]: "# Customized\n" });
    const logs: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
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

    await expect(fs.readFile(skillPath, "utf8")).resolves.toBe("# Customized\n");
    expect(
      logs.some((message) =>
        message.includes("Skip: .claude/skills/poe-code-pipeline-plan/SKILL.md (already exists)")
      )
    ).toBe(true);

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

    await expect(fs.readFile(skillPath, "utf8")).resolves.toBe(
      pipelineSkillPlan + "\n\n" + skillPlanConfigSection("pipeline")
    );
    expect(
      logs.some((message) =>
        message.includes("Overwrite: .claude/skills/poe-code-pipeline-plan/SKILL.md")
      )
    ).toBe(true);
    expect(logs.some((message) => message.includes("# Customized"))).toBe(true);
  });

  it("cleans a partial steps.yaml when initial scaffold creation fails", async () => {
    const stepsPath = "/repo/.poe-code/pipeline/steps.yaml";
    const fs = createMemFs();
    const originalWriteFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (String(filePath) === stepsPath) {
        await originalWriteFile(filePath, "partial steps\n", options);
        throw new Error("injected partial steps write failure");
      }
      await originalWriteFile(filePath, data, options);
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await withObjectPrototypeCode("EEXIST", async () => {
      await expect(
        program.parseAsync([
          "node",
          "cli",
          "pipeline",
          "install",
          "--agent",
          "claude-code",
          "--local"
        ])
      ).rejects.toThrow("injected partial steps write failure");
    });

    await expect(fs.readFile(stepsPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.readFile("/repo/.claude/skills/poe-code-pipeline-plan/SKILL.md", "utf8")
    ).rejects.toThrow();
    await expect(fs.stat("/repo/.poe-code/pipeline/plans")).rejects.toThrow();
  });

  it("cleans a partial forced steps temp file and restores the prior steps.yaml", async () => {
    const stepsPath = "/repo/.poe-code/pipeline/steps.yaml";
    const fs = createMemFs({
      [stepsPath]: "EXISTING_STEPS"
    });
    const originalWriteFile = fs.writeFile.bind(fs);
    let temporaryPath: string | undefined;
    vi.spyOn(fs, "writeFile").mockImplementation(async (filePath, data, options) => {
      const filePathText = String(filePath);
      if (
        temporaryPath === undefined &&
        filePathText.startsWith(`${stepsPath}.${process.pid}.`) &&
        filePathText.endsWith(".tmp")
      ) {
        temporaryPath = filePathText;
        await originalWriteFile(filePath, "partial forced steps\n", options);
        throw new Error("injected forced steps write failure");
      }
      await originalWriteFile(filePath, data, options);
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await withObjectPrototypeCode("EEXIST", async () => {
      await expect(
        program.parseAsync([
          "node",
          "cli",
          "pipeline",
          "install",
          "--agent",
          "claude-code",
          "--local",
          "--force"
        ])
      ).rejects.toThrow("injected forced steps write failure");
    });

    expect(temporaryPath).toBeDefined();
    await expect(fs.readFile(stepsPath, "utf8")).resolves.toBe("EXISTING_STEPS");
    await expect(fs.readFile(temporaryPath as string, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(
      fs.readFile("/repo/.claude/skills/poe-code-pipeline-plan/SKILL.md", "utf8")
    ).rejects.toThrow();
    await expect(fs.stat("/repo/.poe-code/pipeline/plans")).rejects.toThrow();
  });

  it("does not install the skill or plans directory when steps creation fails", async () => {
    const fs = createMemFs();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);
    const originalWriteFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (String(filePath) === "/repo/.poe-code/pipeline/steps.yaml") {
        throw new Error("injected steps.yaml write failure");
      }
      await originalWriteFile(filePath, data, options);
    });

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "pipeline",
        "install",
        "--agent",
        "claude-code",
        "--local"
      ])
    ).rejects.toThrow("injected steps.yaml write failure");

    await expect(
      fs.readFile("/repo/.claude/skills/poe-code-pipeline-plan/SKILL.md", "utf8")
    ).rejects.toThrow();
    await expect(fs.stat("/repo/.poe-code/pipeline/plans")).rejects.toThrow();
  });

  it("does not follow a steps.yaml symlink inserted before pipeline scaffolding", async () => {
    const stepsPath = "/repo/.poe-code/pipeline/steps.yaml";
    const outsidePath = "/outside/steps.yaml";
    const fs = createMemFs({
      [outsidePath]: "outside-state\n"
    });
    const originalWriteFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (String(filePath) === stepsPath) {
        await replaceWithSymlink(fs, stepsPath, outsidePath);
      }
      await originalWriteFile(filePath, data, options);
    });
    const container = createCliContainer({
      fs,
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
        "install",
        "--agent",
        "claude-code",
        "--local"
      ])
    ).rejects.toMatchObject({ code: "EEXIST" });

    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("outside-state\n");
    await expect(
      fs.readFile("/repo/.claude/skills/poe-code-pipeline-plan/SKILL.md", "utf8")
    ).rejects.toThrow();
    await expect(fs.stat("/repo/.poe-code/pipeline/plans")).rejects.toThrow();
  });

  it("does not recover malformed config while dry-running install defaults", async () => {
    const fs = createMemFs({
      [`${homeDir}/.poe-code/config.json`]: "{ invalid json\n"
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPipelineCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "--yes", "pipeline", "install", "--local"])
    ).rejects.toThrow();

    expect(await fs.readFile(`${homeDir}/.poe-code/config.json`, "utf8")).toBe("{ invalid json\n");
    expect(await fs.readdir(`${homeDir}/.poe-code`)).toEqual(["config.json"]);
  });
});
