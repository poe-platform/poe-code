import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  return {
    ...actual,
    spawn: spawnMock
  };
});

const { runPipelineHarness } = await import("./harness.js");

const cwd = "/repo";
const homeDir = "/home/test";

describe("runPipelineHarness", () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(cwd, { recursive: true });
    vol.mkdirSync(homeDir, { recursive: true });
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs a markdown pipeline plan through runHarness with the registered modules", async () => {
    vol.fromJSON({
      "/repo/docs/plans/plan.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "agents:",
        "  builder:",
        "    agent: codex",
        "tasks:",
        "  - id: build",
        "    title: Build",
        "    prompt: Ship it.",
        "    status: open",
        "---",
        "",
        "```js",
        'import { spawn } from "agent";',
        'import { meta } from "harness";',
        'return (await spawn("codex", { prompt: meta.kind })).summary;',
        "```",
        ""
      ].join("\n")
    });

    spawnMock.mockResolvedValueOnce({
      stdout: "implemented",
      stderr: "",
      exitCode: 0,
      durationMs: 25
    });

    const result = await runPipelineHarness({
      agent: "codex",
      cwd,
      homeDir,
      plan: "docs/plans/plan.md"
    });

    expect(result).toEqual(
      expect.objectContaining({
        stopReason: "completed",
        planPath: "docs/plans/plan.md",
        runsCompleted: 1
      })
    );
  });

  it("deletes the existing snapshot before running when reset is enabled", async () => {
    vol.fromJSON({
      "/repo/docs/plans/plan.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "tasks: []",
        "---",
        "",
        "```js",
        "return 1;",
        "```",
        ""
      ].join("\n"),
      "/repo/docs/plans/plan.md.snapshot.json": '{"stale":true}'
    });

    const result = await runPipelineHarness({
      agent: "codex",
      cwd,
      homeDir,
      plan: "docs/plans/plan.md",
      reset: true
    });

    expect(result.stopReason).toBe("completed");
    expect(vol.existsSync("/repo/docs/plans/plan.md.snapshot.json")).toBe(false);
  });

  it("maps harness failures to a failed pipeline result", async () => {
    vol.fromJSON({
      "/repo/docs/plans/plan.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "tasks: []",
        "---",
        "",
        "```js",
        'import fail from "fail";',
        'fail("stop now");',
        "```",
        ""
      ].join("\n")
    });

    const result = await runPipelineHarness({
      agent: "codex",
      cwd,
      homeDir,
      plan: "docs/plans/plan.md"
    });

    expect(result).toEqual(
      expect.objectContaining({
        stopReason: "failed",
        planPath: "docs/plans/plan.md",
        runsCompleted: 0
      })
    );
  });

  it("filters tasks, honors CLI agent and model overrides, and reports task callbacks from log events", async () => {
    const onPlanResolved = vi.fn();
    const onTaskStart = vi.fn();
    const onTaskComplete = vi.fn();
    const runAgent = vi.fn().mockResolvedValue({
      stdout: "implemented",
      stderr: "",
      exitCode: 0,
      usage: {
        inputTokens: 12,
        outputTokens: 4,
        cachedTokens: 3
      }
    });

    vol.fromJSON({
      "/repo/docs/plans/plan.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "agents:",
        "  builder:",
        "    agent: claude-code",
        "    model: frontmatter-model",
        "tasks:",
        "  - id: first-task",
        "    title: First task",
        "    prompt: First prompt.",
        "    status: open",
        "  - id: second-task",
        "    title: Second task",
        "    prompt: Second prompt.",
        "    status: open",
        "---",
        "",
        "```js",
        'import { spawn } from "agent";',
        'import { tasks, agents } from "harness";',
        'import { event } from "log";',
        "",
        "await tasks.reduce(async (previous, task) => {",
        "  await previous;",
        '  event("task.started", { id: task.id, title: task.title });',
        '  event("task.completed", {',
        "    id: task.id,",
        "    title: task.title,",
        "    durationMs: (await spawn(agents.builder, {",
        "      prompt: task.prompt,",
        '      mode: "edit",',
        '      cwd: "/tmp/task-run"',
        "    })).durationMs",
        "  });",
        "}, (async () => {})());",
        "```",
        ""
      ].join("\n")
    });

    const result = await runPipelineHarness({
      agent: "codex",
      cwd,
      homeDir,
      model: "openai/gpt-5.2",
      plan: "docs/plans/plan.md",
      task: "second-task",
      runAgent,
      onPlanResolved,
      onTaskStart,
      onTaskComplete
    });

    expect(result).toEqual(
      expect.objectContaining({
        stopReason: "completed",
        planPath: "docs/plans/plan.md",
        runsCompleted: 1,
        metrics: {
          totalInputTokens: 12,
          totalOutputTokens: 4,
          totalCachedTokens: 3,
          tasksCompleted: 1,
          tasksFailed: 0,
          stepsCompleted: 1
        }
      })
    );
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgent).toHaveBeenCalledWith({
      agent: "codex",
      prompt: "Second prompt.",
      cwd: "/tmp/task-run",
      mode: "edit",
      model: "openai/gpt-5.2",
      signal: undefined
    });
    expect(onPlanResolved).toHaveBeenCalledWith({
      planPath: "docs/plans/plan.md",
      done: 0,
      failed: 0,
      open: 1,
      total: 1
    });
    expect(onTaskStart).toHaveBeenCalledWith({
      taskId: "second-task",
      taskTitle: "Second task",
      taskIndex: 1,
      totalTasks: 1
    });
    expect(onTaskComplete).toHaveBeenCalledWith({
      taskId: "second-task",
      taskTitle: "Second task",
      taskIndex: 1,
      totalTasks: 1,
      durationMs: expect.any(Number),
      success: true,
      taskCompleted: true
    });
  });

  it("returns cancellation when the injected runner aborts", async () => {
    const abortError = new Error("cancelled");
    abortError.name = "AbortError";

    vol.fromJSON({
      "/repo/docs/plans/plan.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: build",
        "    title: Build",
        "    prompt: Ship it.",
        "    status: open",
        "---",
        "",
        "```js",
        'import { spawn } from "agent";',
        'await spawn("claude-code", { prompt: "Ship it." });',
        "```",
        ""
      ].join("\n")
    });

    const result = await runPipelineHarness({
      agent: "codex",
      cwd,
      homeDir,
      plan: "docs/plans/plan.md",
      runAgent: vi.fn().mockRejectedValue(abortError)
    });

    expect(result).toEqual(
      expect.objectContaining({
        stopReason: "cancelled",
        planPath: "docs/plans/plan.md",
        runsCompleted: 0
      })
    );
  });

  it("captures the last started task when a spawned agent fails", async () => {
    vol.fromJSON({
      "/repo/docs/plans/plan.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: build",
        "    title: Build",
        "    prompt: Ship it.",
        "    status: open",
        "---",
        "",
        "```js",
        'import { spawn } from "agent";',
        'import { tasks } from "harness";',
        'import { event } from "log";',
        "",
        "await tasks.reduce(async (previous, task) => {",
        "  await previous;",
        '  event("task.started", { id: task.id, title: task.title });',
        '  await spawn("claude-code", { prompt: task.prompt });',
        "}, (async () => {})());",
        "```",
        ""
      ].join("\n")
    });

    const result = await runPipelineHarness({
      agent: "codex",
      cwd,
      homeDir,
      plan: "docs/plans/plan.md",
      runAgent: vi.fn().mockResolvedValue({
        stdout: "",
        stderr: "boom",
        exitCode: 1
      })
    });

    expect(result).toEqual(
      expect.objectContaining({
        stopReason: "failed",
        planPath: "docs/plans/plan.md",
        runsCompleted: 1,
        lastTaskId: "build",
        metrics: expect.objectContaining({
          tasksFailed: 1
        })
      })
    );
  });

  it("returns nothing_to_run when every selected task is already done", async () => {
    vol.fromJSON({
      "/repo/docs/plans/plan.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: build",
        "    title: Build",
        "    prompt: Ship it.",
        "    status: done",
        "---",
        "",
        "```js",
        "return 1;",
        "```",
        ""
      ].join("\n")
    });

    const result = await runPipelineHarness({
      agent: "codex",
      cwd,
      homeDir,
      plan: "docs/plans/plan.md"
    });

    expect(result).toEqual(
      expect.objectContaining({
        stopReason: "nothing_to_run",
        planPath: "docs/plans/plan.md",
        runsCompleted: 0
      })
    );
  });

  it("stops at the configured max runs", async () => {
    vol.fromJSON({
      "/repo/docs/plans/plan.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: first-task",
        "    title: First task",
        "    prompt: First prompt.",
        "    status: open",
        "  - id: second-task",
        "    title: Second task",
        "    prompt: Second prompt.",
        "    status: open",
        "---",
        "",
        "```js",
        'import { spawn } from "agent";',
        'import { tasks } from "harness";',
        'await tasks.reduce(async (previous, task) => {',
        "  await previous;",
        '  await spawn("claude-code", { prompt: task.prompt });',
        "}, (async () => {})());",
        "```",
        ""
      ].join("\n")
    });

    const result = await runPipelineHarness({
      agent: "codex",
      cwd,
      homeDir,
      plan: "docs/plans/plan.md",
      maxRuns: 1,
      runAgent: vi.fn().mockResolvedValue({
        stdout: "ok",
        stderr: "",
        exitCode: 0
      })
    });

    expect(result).toEqual(
      expect.objectContaining({
        stopReason: "max_runs",
        planPath: "docs/plans/plan.md",
        runsCompleted: 1
      })
    );
  });
});
