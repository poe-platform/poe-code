import type { SpawnResult } from "@poe-code/agent-spawn";
import type { Task } from "@poe-code/task-list";
import { describe, expect, it, vi } from "vitest";

import type { AttemptEvent } from "../agent/runner.js";
import type { ResolvedConfig } from "../config/schema.js";
import { pipelineDriver } from "./pipeline.js";
import type { WorkflowDriverContext } from "./types.js";

describe("pipelineDriver", () => {
  it("dispatches a planned task with the planned prompt and workflow default agent/model", async () => {
    const spawn = vi.fn(async () => successSpawn());
    const ctx = createContext({ spawn });

    await expect(pipelineDriver.run(ctx)).resolves.toEqual({ reason: "normal" });

    expect(spawn).toHaveBeenCalledWith("codex", {
      prompt: "Plan tasks/task-1: Build runner\n\nRender this task body",
      model: undefined,
      mode: "yolo",
      signal: ctx.abort
    });
  });

  it("dispatches with state agent and model overrides over the workflow default", async () => {
    const spawn = vi.fn(async () => successSpawn());
    const ctx = createContext({
      task: createTask({ state: "implementation" }),
      spawn,
      cfg: createConfig({
        agent: { service: "codex" },
        states: {
          implementation: {
            prompt: "Implement {{ task.id }}",
            agent: "claude",
            model: "claude-sonnet-4-6"
          },
          done: { terminal: true }
        }
      })
    });

    await expect(pipelineDriver.run(ctx)).resolves.toEqual({ reason: "normal" });

    expect(spawn).toHaveBeenCalledWith("claude", {
      prompt: "Implement task-1",
      model: "claude-sonnet-4-6",
      mode: "yolo",
      signal: ctx.abort
    });
  });

  it("dispatches with the state mode override", async () => {
    const spawn = vi.fn(async () => successSpawn());
    const ctx = createContext({
      task: createTask({ state: "review" }),
      spawn,
      cfg: createConfig({
        states: {
          review: {
            prompt: "Review {{ task.id }}",
            mode: "read"
          },
          done: { terminal: true }
        }
      })
    });

    await expect(pipelineDriver.run(ctx)).resolves.toEqual({ reason: "normal" });

    expect(spawn).toHaveBeenCalledWith("codex", {
      prompt: "Review task-1",
      model: undefined,
      mode: "read",
      signal: ctx.abort
    });
  });

  it("does not dispatch terminal states", async () => {
    const spawn = vi.fn(async () => successSpawn());
    const ctx = createContext({
      task: createTask({ state: "done" }),
      spawn
    });

    await expect(pipelineDriver.run(ctx)).resolves.toEqual({ reason: "normal" });

    expect(spawn).not.toHaveBeenCalled();
  });

  it("warns and does not dispatch an unconfigured state", async () => {
    const spawn = vi.fn(async () => successSpawn());
    const logger = { warn: vi.fn() };
    const ctx = createContext({
      task: createTask({ state: "reviewing" }),
      spawn,
      logger
    });

    await expect(pipelineDriver.run(ctx)).resolves.toEqual({ reason: "normal" });

    expect(spawn).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith("unconfigured state", {
      task_id: "tasks/task-1",
      state: "reviewing"
    });
  });
});

function createContext(
  overrides: Partial<WorkflowDriverContext> & {
    events?: AttemptEvent[];
    spawn?: ReturnType<typeof vi.fn>;
  } = {}
): WorkflowDriverContext {
  const events = overrides.events ?? [];

  return {
    task: createTask(),
    attempt: 1,
    workspaceDir: "/repo/workspaces/task-1",
    planPath: "/repo/tasks/task-1.md",
    cfg: createConfig(),
    abort: new AbortController().signal,
    emit: (event) => events.push(event),
    spawn: vi.fn(async () => successSpawn()),
    logger: { warn: vi.fn() },
    ...overrides
  };
}

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    list: "tasks",
    id: "task-1",
    qualifiedId: "tasks/task-1",
    name: "Build runner",
    state: "planned",
    description: "Render this task body",
    metadata: {},
    ...overrides
  };
}

function createConfig(
  overrides: {
    agent?: Partial<ResolvedConfig["agent"]>;
    states?: ResolvedConfig["states"];
  } = {}
): ResolvedConfig {
  const states = overrides.states ?? {
    planned: { prompt: "Plan {{ prompt }}" },
    implementation: { prompt: "Implement {{ prompt }}" },
    done: { terminal: true }
  };

  return {
    tasks: { type: "markdown-dir", path: "/repo/tasks" },
    states,
    activeStateNames: Object.entries(states)
      .filter(([, state]) => state.prompt !== undefined)
      .map(([name]) => name),
    terminalStateNames: Object.entries(states)
      .filter(([, state]) => state.terminal === true)
      .map(([name]) => name),
    stateOrder: Object.keys(states),
    polling: { intervalMs: 30_000 },
    workspace: { root: "/tmp/poe-code-maestro" },
    agent: {
      service: "codex",
      list: "tasks",
      maxConcurrentAgents: 1,
      maxTurns: 20,
      maxRetryBackoffMs: 300_000,
      ...overrides.agent
    }
  };
}

function successSpawn(): SpawnResult {
  return { stdout: "", stderr: "", exitCode: 0 };
}
