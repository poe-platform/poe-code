import { createFsFromVolume, Volume } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadResolvedSteps, type ResolvedStepsConfig } from "@poe-code/pipeline";
import type { SpawnResult } from "@poe-code/agent-spawn";
import type { Task } from "@poe-code/task-list";

import { runAttempt, type AttemptDeps } from "./runner.js";
import type { ResolvedConfig } from "../config/schema.js";
import { pipelineDriver } from "../drivers/pipeline.js";

type TestFs = ReturnType<typeof createFsFromVolume>["promises"];

describe("runAttempt", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs three declared steps with step agent, model, mode, prompt body, and phase events", async () => {
    const steps = await loadSteps(`
steps:
  implement:
    agent: codex
    model: openai/gpt-5.4
    mode: edit
    prompt: "Implement step sees {{ prompt }}"
  test:
    agent: claude-code
    model: anthropic/claude-sonnet-4.6
    mode: read
    prompt: "Test step sees {{ prompt }}"
  commit:
    agent: opencode
    model: openai/gpt-5.2
    mode: yolo
    prompt: "Commit step sees {{ prompt }}"
`);
    const deps = createDeps();

    const outcome = await runAttempt({
      task: createTask(),
      attempt: 2,
      cfg: createConfig(),
      steps,
      deps,
      abort: new AbortController().signal
    });

    expect(outcome).toEqual({ reason: "normal" });
    expect(deps.spawn).toHaveBeenCalledTimes(3);
    expect(deps.spawn.mock.calls.map(([agent, options]) => ({
      agent,
      model: options.model,
      mode: options.mode,
      prompt: options.prompt
    }))).toEqual([
      {
        agent: "codex",
        model: "openai/gpt-5.4",
        mode: "edit",
        prompt: "Implement step sees tasks/task-1: Build runner\n\nRender this task body"
      },
      {
        agent: "claude-code",
        model: "anthropic/claude-sonnet-4.6",
        mode: "read",
        prompt: "Test step sees tasks/task-1: Build runner\n\nRender this task body"
      },
      {
        agent: "opencode",
        model: "openai/gpt-5.2",
        mode: "yolo",
        prompt: "Commit step sees tasks/task-1: Build runner\n\nRender this task body"
      }
    ]);
    expect(deps.reconcile).toHaveBeenCalledTimes(3);
    expect(deps.events.map((event) => event.to)).toEqual([
      "preparing-workspace",
      "running-step",
      "running-step",
      "running-step",
      "succeeded"
    ]);
    expect(deps.events.map((event) => event.step)).toEqual([
      undefined,
      "implement",
      "test",
      "commit",
      undefined
    ]);
  });

  it("cancels after a mid-step abort and skips remaining steps", async () => {
    const steps = await loadSteps(`
steps:
  implement:
    mode: edit
    prompt: "Implement {{ prompt }}"
  test:
    mode: read
    prompt: "Test {{ prompt }}"
  commit:
    mode: yolo
    prompt: "Commit {{ prompt }}"
`);
    const controller = new AbortController();
    const deps = createDeps();
    deps.spawn.mockImplementationOnce(async () => {
      controller.abort();
      return successSpawn();
    });

    const outcome = await runAttempt({
      task: createTask(),
      attempt: 1,
      cfg: createConfig(),
      steps,
      deps,
      abort: controller.signal
    });

    expect(outcome).toEqual({ reason: "abnormal", failure: "canceled" });
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(deps.events.map((event) => event.to)).toEqual([
      "preparing-workspace",
      "running-step",
      "canceled"
    ]);
  });

  it("cancels after a mid-step abort and skips teardown", async () => {
    const steps = await loadSteps(`
steps:
  implement:
    agent: implement-agent
    mode: edit
    prompt: "Implement {{ prompt }}"
  test:
    agent: test-agent
    mode: read
    prompt: "Test {{ prompt }}"
teardown:
  agent: teardown-agent
  mode: read
  prompt: "Teardown {{ prompt }}"
`);
    const controller = new AbortController();
    const deps = createDeps();
    deps.spawn.mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });

    const outcome = await runAttempt({
      task: createTask(),
      attempt: 1,
      cfg: createConfig(),
      steps,
      deps,
      abort: controller.signal
    });

    expect(outcome).toEqual({ reason: "abnormal", failure: "canceled" });
    expect(deps.spawn.mock.calls.map(([agent]) => agent)).toEqual(["implement-agent"]);
    expect(deps.events.map((event) => event.to)).toEqual([
      "preparing-workspace",
      "running-step",
      "canceled"
    ]);
  });

  it("runs teardown best-effort when setup fails and skips declared steps", async () => {
    const steps = await loadSteps(`
setup:
  agent: setup-agent
  mode: yolo
  prompt: "Setup {{ prompt }}"
steps:
  implement:
    agent: step-agent
    mode: edit
    prompt: "Implement {{ prompt }}"
teardown:
  agent: teardown-agent
  mode: read
  prompt: "Teardown {{ prompt }}"
`);
    const deps = createDeps();
    deps.spawn.mockResolvedValueOnce(failedSpawn()).mockResolvedValueOnce(successSpawn());

    const outcome = await runAttempt({
      task: createTask(),
      attempt: 1,
      cfg: createConfig(),
      steps,
      deps,
      abort: new AbortController().signal
    });

    expect(outcome).toEqual({
      reason: "abnormal",
      failure: "step_failed",
      failedStep: "setup",
      error: "exitCode=1"
    });
    expect(deps.spawn.mock.calls.map(([agent]) => agent)).toEqual(["setup-agent", "teardown-agent"]);
    expect(deps.events.map((event) => event.to)).toEqual([
      "preparing-workspace",
      "running-setup",
      "running-teardown",
      "failed"
    ]);
  });

  it("cancels when reconcile reports terminal state after setup", async () => {
    const steps = await loadSteps(`
setup:
  agent: setup-agent
  mode: yolo
  prompt: "Setup {{ prompt }}"
steps:
  implement:
    agent: implement-agent
    mode: edit
    prompt: "Implement {{ prompt }}"
teardown:
  agent: teardown-agent
  mode: read
  prompt: "Teardown {{ prompt }}"
`);
    const deps = createDeps();
    deps.reconcile.mockResolvedValueOnce("canceled");

    const outcome = await runAttempt({
      task: createTask(),
      attempt: 1,
      cfg: createConfig(),
      steps,
      deps,
      abort: new AbortController().signal
    });

    expect(outcome).toEqual({ reason: "abnormal", failure: "canceled" });
    expect(deps.spawn.mock.calls.map(([agent]) => agent)).toEqual(["setup-agent"]);
    expect(deps.events.map((event) => event.to)).toEqual([
      "preparing-workspace",
      "running-setup",
      "canceled"
    ]);
  });

  it("runs teardown best-effort when a step fails and skips remaining steps", async () => {
    const steps = await loadSteps(`
steps:
  implement:
    agent: implement-agent
    mode: edit
    prompt: "Implement {{ prompt }}"
  test:
    agent: test-agent
    mode: read
    prompt: "Test {{ prompt }}"
  commit:
    agent: commit-agent
    mode: yolo
    prompt: "Commit {{ prompt }}"
teardown:
  agent: teardown-agent
  mode: read
  prompt: "Teardown {{ prompt }}"
`);
    const deps = createDeps();
    deps.spawn
      .mockResolvedValueOnce(successSpawn())
      .mockResolvedValueOnce(failedSpawn())
      .mockResolvedValueOnce(successSpawn());

    const outcome = await runAttempt({
      task: createTask(),
      attempt: 1,
      cfg: createConfig(),
      steps,
      deps,
      abort: new AbortController().signal
    });

    expect(outcome).toEqual({
      reason: "abnormal",
      failure: "step_failed",
      failedStep: "test",
      error: "exitCode=1"
    });
    expect(deps.spawn.mock.calls.map(([agent]) => agent)).toEqual([
      "implement-agent",
      "test-agent",
      "teardown-agent"
    ]);
  });

  it("logs and ignores teardown failure", async () => {
    const steps = await loadSteps(`
steps:
  implement:
    mode: edit
    prompt: "Implement {{ prompt }}"
teardown:
  mode: read
  prompt: "Teardown {{ prompt }}"
`);
    const deps = createDeps();
    deps.spawn.mockResolvedValueOnce(successSpawn()).mockResolvedValueOnce(failedSpawn());

    const outcome = await runAttempt({
      task: createTask(),
      attempt: 1,
      cfg: createConfig(),
      steps,
      deps,
      abort: new AbortController().signal
    });

    expect(outcome).toEqual({ reason: "normal" });
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "teardown failed",
      expect.objectContaining({ failure: "step_failed", failedStep: "teardown" })
    );
    expect(deps.events.map((event) => event.to)).toEqual([
      "preparing-workspace",
      "running-step",
      "running-teardown",
      "succeeded"
    ]);
  });

  it("cancels when reconcile reports terminal state between steps", async () => {
    const steps = await loadSteps(`
steps:
  implement:
    mode: edit
    prompt: "Implement {{ prompt }}"
  test:
    mode: read
    prompt: "Test {{ prompt }}"
`);
    const deps = createDeps();
    deps.reconcile.mockResolvedValueOnce("canceled");

    const outcome = await runAttempt({
      task: createTask(),
      attempt: 1,
      cfg: createConfig(),
      steps,
      deps,
      abort: new AbortController().signal
    });

    expect(outcome).toEqual({ reason: "abnormal", failure: "canceled" });
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(deps.events.map((event) => event.to)).toEqual([
      "preparing-workspace",
      "running-step",
      "canceled"
    ]);
  });

  it("routes explicit and default pipeline tasks through the pipeline driver", async () => {
    const steps = await loadSteps(`
steps:
  implement:
    mode: edit
    prompt: "Implement {{ prompt }}"
`);
    const driverRun = vi
      .spyOn(pipelineDriver, "run")
      .mockResolvedValue({ reason: "normal" });

    await runAttempt({
      task: createTask({ metadata: { kind: "pipeline" } }),
      attempt: 1,
      cfg: createConfig(),
      steps,
      deps: createDeps(),
      abort: new AbortController().signal
    });
    await runAttempt({
      task: createTask(),
      attempt: 1,
      cfg: createConfig(),
      steps,
      deps: createDeps(),
      abort: new AbortController().signal
    });

    expect(driverRun).toHaveBeenCalledTimes(2);
    expect(driverRun.mock.calls.map(([ctx]) => ctx.task.metadata.kind)).toEqual([
      "pipeline",
      undefined
    ]);
  });

  it("passes task sourcePath as the workflow driver planPath", async () => {
    const steps = await loadSteps(`
steps:
  implement:
    mode: edit
    prompt: "Implement {{ prompt }}"
`);
    const driverRun = vi
      .spyOn(pipelineDriver, "run")
      .mockResolvedValue({ reason: "normal" });

    await runAttempt({
      task: createTask({ sourcePath: "/repo/docs/plans/source.md" }),
      attempt: 1,
      cfg: createConfig(),
      steps,
      planPath: "/repo/docs/plans/legacy.md",
      deps: createDeps(),
      abort: new AbortController().signal
    });

    expect(driverRun).toHaveBeenCalledWith(
      expect.objectContaining({
        planPath: "/repo/docs/plans/source.md"
      })
    );
  });
});

async function loadSteps(content: string): Promise<ResolvedStepsConfig> {
  const fs = createFs({ "/repo/.poe-code/pipeline/steps.yaml": content.trimStart() });
  return loadResolvedSteps({ cwd: "/repo", homeDir: "/home/test", fs });
}

function createFs(files: Record<string, string> = {}): TestFs {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises;
}

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    list: "tasks",
    id: "task-1",
    qualifiedId: "tasks/task-1",
    name: "Build runner",
    state: "in-progress",
    description: "Render this task body",
    metadata: {},
    ...overrides
  };
}

function createConfig(): ResolvedConfig {
  return {
    tasks: { type: "markdown-dir", path: "/repo/tasks" },
    active_states: ["planned", "in-progress"],
    terminal_states: ["done", "archived"],
    polling: { intervalMs: 30_000 },
    workspace: { root: "/tmp/poe-code-maestro" },
    agent: {
      service: "codex",
      list: "tasks",
      maxConcurrentAgents: 1,
      maxTurns: 20,
      maxRetryBackoffMs: 300_000
    },
    stepOverrides: {}
  };
}

function createDeps(): AttemptDeps & {
  spawn: ReturnType<typeof vi.fn>;
  reconcile: ReturnType<typeof vi.fn>;
  events: Array<Extract<Parameters<NonNullable<AttemptDeps["onEvent"]>>[0], { type: "attempt_phase" }>>;
  logger: { warn: ReturnType<typeof vi.fn> };
} {
  const events: Array<
    Extract<Parameters<NonNullable<AttemptDeps["onEvent"]>>[0], { type: "attempt_phase" }>
  > = [];

  return {
    spawn: vi.fn(async () => successSpawn()),
    reconcile: vi.fn(async () => "continue" as const),
    events,
    onEvent: (event) => {
      if (event.type === "attempt_phase") {
        events.push(event);
      }
    },
    logger: {
      warn: vi.fn()
    }
  };
}

function successSpawn(): SpawnResult {
  return { stdout: "", stderr: "", exitCode: 0 };
}

function failedSpawn(): SpawnResult {
  return { stdout: "", stderr: "", exitCode: 1 };
}
