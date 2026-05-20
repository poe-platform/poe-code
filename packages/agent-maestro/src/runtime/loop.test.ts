import type { ResolvedStepsConfig } from "@poe-code/pipeline";
import type { Task, TaskList } from "@poe-code/task-list";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { tick, type TickDeps } from "./loop.js";
import { createState, markRunning, scheduleRetry } from "./state.js";
import type { ResolvedConfig } from "../config/schema.js";
import { pipelineDriver } from "../drivers/pipeline.js";
import { registerDriver } from "../drivers/registry.js";

describe("tick", () => {
  beforeEach(() => {
    registerDriver(pipelineDriver);
  });

  it("reconciles before preflight, dispatches, and schedules retry after worker exit", async () => {
    const task = createTask("tasks/next", {
      state: "planned",
      metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
    });
    const state = createState(createConfig({ maxConcurrentAgents: 2 }));
    markRunning(state, { taskId: "tasks/running", attempt: 1 });
    const events: string[] = [];
    const deps = createDeps({
      tasks: createTaskList([task]),
      validateDispatch: async () => {
        events.push("preflight");
        return { ok: true };
      },
      reconcileRunning: async () => {
        events.push("reconcile");
        return [{ taskId: "tasks/running", action: "refresh_failed" }];
      },
      ensureWorkspace: async () => {
        events.push("workspace");
        return { path: "/repo/workspaces/tasks_next", createdNow: true };
      },
      runAttempt: async () => {
        events.push("runAttempt");
        return { reason: "abnormal", failure: "step_failed" };
      },
      now: () => 1_000,
      onEvent: (event) => events.push(event.type)
    });

    await tick(state, deps);
    await waitForWorkers();

    expect(events).toEqual([
      "tick_started",
      "reconcile",
      "reconcile",
      "preflight",
      "workspace",
      "dispatch",
      "runAttempt",
      "worker_exit",
      "retry_scheduled"
    ]);
    expect(state.retry_attempts.get("tasks/next")).toEqual({
      taskId: "tasks/next",
      attempt: 2,
      dueAt: 11_000
    });
  });

  it("sorts active candidates by priority, createdAt, and qualifiedId", async () => {
    const dispatched: string[] = [];
    const state = createState(createConfig({ maxConcurrentAgents: 10 }));
    const tasks = [
      createTask("tasks/no-priority", {
        state: "planned",
        metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
      }),
      createTask("tasks/priority-two", {
        state: "in-progress",
        metadata: { priority: 2, createdAt: "2026-01-01T00:00:00.000Z" }
      }),
      createTask("tasks/priority-one-b", {
        state: "planned",
        metadata: { priority: 1, createdAt: "2026-01-02T00:00:00.000Z" }
      }),
      createTask("tasks/priority-one-a", {
        state: "in-progress",
        metadata: { priority: 1, createdAt: "2026-01-01T00:00:00.000Z" }
      }),
      createTask("tasks/priority-one-c", {
        state: "planned",
        metadata: { priority: 1, createdAt: "2026-01-02T00:00:00.000Z" }
      })
    ];

    await tick(
      state,
      createDeps({
        tasks: createTaskList(tasks),
        ensureWorkspace: async (_root, qualifiedId) => {
          dispatched.push(qualifiedId);
          return { path: `/repo/workspaces/${qualifiedId}`, createdNow: true };
        },
        runAttempt: async () => ({ reason: "abnormal", failure: "canceled" })
      })
    );

    expect(dispatched).toEqual([
      "tasks/priority-one-a",
      "tasks/priority-one-b",
      "tasks/priority-one-c",
      "tasks/priority-two",
      "tasks/no-priority"
    ]);
  });

  it("keeps reconciling but skips candidate fetch and dispatch when preflight fails", async () => {
    const state = createState(createConfig());
    markRunning(state, { taskId: "tasks/running", attempt: 1 });
    const allTasks = vi.fn();
    const ensureWorkspace = vi.fn();
    const events: string[] = [];

    await tick(
      state,
      createDeps({
        tasks: createTaskList([], { allTasks }),
        validateDispatch: async () => ({ ok: false, code: "missing_steps_config" }),
        reconcileRunning: async () => [{ taskId: "tasks/running", action: "update" }],
        ensureWorkspace,
        onEvent: (event) => events.push(event.type)
      })
    );

    expect(allTasks).not.toHaveBeenCalled();
    expect(ensureWorkspace).not.toHaveBeenCalled();
    expect(events).toEqual(["tick_started", "reconcile", "validation_failed"]);
  });

  it("dispatches only up to the available concurrency", async () => {
    const state = createState(createConfig({ maxConcurrentAgents: 3 }));
    markRunning(state, { taskId: "tasks/already-running", attempt: 1 });
    const dispatched: string[] = [];

    await tick(
      state,
      createDeps({
        tasks: createTaskList([
          createTask("tasks/one", {
            metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
          }),
          createTask("tasks/two", {
            metadata: { createdAt: "2026-01-02T00:00:00.000Z" }
          }),
          createTask("tasks/three", {
            metadata: { createdAt: "2026-01-03T00:00:00.000Z" }
          })
        ]),
        ensureWorkspace: async (_root, qualifiedId) => {
          dispatched.push(qualifiedId);
          return { path: `/repo/workspaces/${qualifiedId}`, createdNow: true };
        },
        runAttempt: async () => ({ reason: "abnormal", failure: "canceled" })
      })
    );

    expect(dispatched).toEqual(["tasks/one", "tasks/two"]);
    expect(state.running.has("tasks/one")).toBe(true);
    expect(state.running.has("tasks/two")).toBe(true);
    expect(state.running.has("tasks/three")).toBe(false);
  });

  it("does not dispatch a retry before it is due", async () => {
    const state = createState(createConfig());
    const task = createTask("tasks/retry", {
      metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
    });
    scheduleRetry(state, { taskId: task.qualifiedId, attempt: 2, dueAt: 2_000 });
    const ensureWorkspace = vi.fn();

    await tick(
      state,
      createDeps({
        tasks: createTaskList([task]),
        ensureWorkspace,
        now: () => 1_999
      })
    );

    expect(ensureWorkspace).not.toHaveBeenCalled();
    expect(state.retry_attempts.get(task.qualifiedId)).toEqual({
      taskId: task.qualifiedId,
      attempt: 2,
      dueAt: 2_000
    });
  });

  it("dispatches a due retry with its scheduled attempt", async () => {
    const state = createState(createConfig());
    const task = createTask("tasks/retry", {
      metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
    });
    scheduleRetry(state, { taskId: task.qualifiedId, attempt: 3, dueAt: 2_000 });
    const attempts: number[] = [];

    await tick(
      state,
      createDeps({
        tasks: createTaskList([task]),
        runAttempt: async ({ attempt }) => {
          attempts.push(attempt);
          return { reason: "abnormal", failure: "canceled" };
        },
        now: () => 2_000
      })
    );
    await waitForWorkers();

    expect(attempts).toEqual([3]);
    expect(state.retry_attempts.has(task.qualifiedId)).toBe(false);
  });

  it("refreshes the task immediately before rendering each dispatch prompt", async () => {
    let now = 0;
    const state = createState(createConfig());
    const staleCandidate = createTask("tasks/refresh", {
      metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
    });
    const currentTask = { ...staleCandidate, description: "first body" };
    const prompts: string[] = [];
    const workerPromises: Promise<void>[] = [];

    const tasks = createTaskList([], {
      allTasks: async (filter) => (staleCandidate.state === filter?.state ? [staleCandidate] : []),
      get: async (qualifiedId) => {
        if (qualifiedId !== currentTask.qualifiedId) {
          throw new Error(`not found: ${qualifiedId}`);
        }

        return { ...currentTask };
      }
    });

    await tick(
      state,
      createDeps({
        tasks,
        taskPromptTemplate: "{{ task.description }}",
        runAttempt: undefined,
        spawn: async (_agent, options) => {
          prompts.push(options.prompt);
          return { stdout: "", stderr: "", exitCode: 0 };
        },
        trackWorker: (worker) => {
          workerPromises.push(worker.promise);
        },
        now: () => now
      })
    );
    await workerPromises.at(-1);

    currentTask.description = "second body";
    now = 1_000;

    await tick(
      state,
      createDeps({
        tasks,
        taskPromptTemplate: "{{ task.description }}",
        runAttempt: undefined,
        spawn: async (_agent, options) => {
          prompts.push(options.prompt);
          return { stdout: "", stderr: "", exitCode: 0 };
        },
        trackWorker: (worker) => {
          workerPromises.push(worker.promise);
        },
        now: () => now
      })
    );
    await workerPromises.at(-1);

    expect(prompts).toEqual(["first body", "second body"]);
  });

  it("schedules a backoff retry when workspace creation fails", async () => {
    const state = createState(createConfig());
    const task = createTask("tasks/workspace-fails", {
      metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
    });
    const events: string[] = [];

    await tick(
      state,
      createDeps({
        tasks: createTaskList([task]),
        ensureWorkspace: async () => {
          throw new Error("disk full");
        },
        runAttempt: async () => {
          throw new Error("runAttempt should not be called");
        },
        now: () => 5_000,
        onEvent: (event) => events.push(event.type)
      })
    );
    await waitForWorkers();

    expect(events).toEqual(["tick_started", "worker_exit", "retry_scheduled"]);
    expect(state.retry_attempts.get(task.qualifiedId)).toEqual({
      taskId: task.qualifiedId,
      attempt: 2,
      dueAt: 15_000
    });
  });

  it("schedules a continuation retry after a successful attempt", async () => {
    const state = createState(createConfig());
    const task = createTask("tasks/success", {
      metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
    });
    const events: string[] = [];

    await tick(
      state,
      createDeps({
        tasks: createTaskList([task]),
        runAttempt: async () => ({ reason: "normal" }),
        now: () => 5_000,
        onEvent: (event) => events.push(event.type)
      })
    );
    await waitForWorkers();

    expect(events).toEqual(["tick_started", "dispatch", "worker_exit", "retry_scheduled"]);
    expect(state.running.has(task.qualifiedId)).toBe(false);
    expect(state.retry_attempts.get(task.qualifiedId)).toEqual({
      taskId: task.qualifiedId,
      attempt: 2,
      dueAt: 6_000
    });
  });

  it("cleans up a retry-queued task that became terminal before retry dispatch", async () => {
    const state = createState(createConfig());
    const task = createTask("tasks/done", {
      state: "done",
      metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
    });
    const removed: string[] = [];
    const events: string[] = [];
    scheduleRetry(state, { taskId: task.qualifiedId, attempt: 2, dueAt: 10_000 });

    await tick(
      state,
      createDeps({
        tasks: createTaskList([task]),
        removeWorkspace: async (_root, qualifiedId) => {
          removed.push(qualifiedId);
        },
        now: () => 5_000,
        onEvent: (event) => events.push(event.type === "reconcile" ? event.action : event.type)
      })
    );

    expect(removed).toEqual([task.qualifiedId]);
    expect(events).toEqual(["tick_started", "stop_clean"]);
    expect(state.completed.has(task.qualifiedId)).toBe(true);
    expect(state.retry_attempts.has(task.qualifiedId)).toBe(false);
  });

  it("deduplicates candidates returned by multiple active states", async () => {
    const state = createState(createConfig({ maxConcurrentAgents: 2 }));
    const duplicate = createTask("tasks/duplicate", {
      metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
    });
    const dispatched: string[] = [];

    await tick(
      state,
      createDeps({
        tasks: createTaskList([], {
          allTasks: async () => [duplicate]
        }),
        ensureWorkspace: async (_root, qualifiedId) => {
          dispatched.push(qualifiedId);
          return { path: `/repo/workspaces/${qualifiedId}`, createdNow: true };
        },
        runAttempt: async () => ({ reason: "abnormal", failure: "canceled" })
      })
    );

    expect(dispatched).toEqual(["tasks/duplicate"]);
  });

  it("fails validation without fetching candidates when steps are missing after preflight passes", async () => {
    const state = createState(createConfig());
    const allTasks = vi.fn();
    const events: string[] = [];

    await tick(
      state,
      createDeps({
        tasks: createTaskList([], { allTasks }),
        steps: undefined,
        validateDispatch: async () => ({ ok: true }),
        onEvent: (event) => events.push(event.type)
      })
    );

    expect(allTasks).not.toHaveBeenCalled();
    expect(events).toEqual(["tick_started", "validation_failed"]);
  });

  it("dispatches pipeline tasks when the pipeline driver is registered", async () => {
    const task = createTask("tasks/pipeline", {
      metadata: { kind: "pipeline", createdAt: "2026-01-01T00:00:00.000Z" }
    });
    const state = createState(createConfig());
    const dispatched: string[] = [];

    await tick(
      state,
      createDeps({
        tasks: createTaskList([task]),
        ensureWorkspace: async (_root, qualifiedId) => {
          dispatched.push(qualifiedId);
          return { path: `/repo/workspaces/${qualifiedId}`, createdNow: true };
        },
        runAttempt: async () => ({ reason: "abnormal", failure: "canceled" })
      })
    );

    expect(dispatched).toEqual(["tasks/pipeline"]);
    expect(state.running.has("tasks/pipeline")).toBe(true);
  });

  it("skips tasks whose workflow kind has no registered driver", async () => {
    const task = createTask("tasks/ralph", {
      metadata: { kind: "ralph", createdAt: "2026-01-01T00:00:00.000Z" }
    });
    const state = createState(createConfig());
    const ensureWorkspace = vi.fn();
    const events: Array<Parameters<NonNullable<TickDeps["onEvent"]>>[0]> = [];

    await tick(
      state,
      createDeps({
        tasks: createTaskList([task]),
        ensureWorkspace,
        onEvent: (event) => events.push(event)
      })
    );

    expect(ensureWorkspace).not.toHaveBeenCalled();
    expect(state.running.has("tasks/ralph")).toBe(false);
    expect(events).toContainEqual({
      type: "task_skipped",
      task_id: "tasks/ralph",
      reason: "unsupported_kind",
      kind: "ralph"
    });
  });

  it("dispatches tasks with no workflow kind through the default pipeline driver", async () => {
    const task = createTask("tasks/default-kind", {
      metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
    });
    const state = createState(createConfig());
    const dispatched: string[] = [];

    await tick(
      state,
      createDeps({
        tasks: createTaskList([task]),
        ensureWorkspace: async (_root, qualifiedId) => {
          dispatched.push(qualifiedId);
          return { path: `/repo/workspaces/${qualifiedId}`, createdNow: true };
        },
        runAttempt: async () => ({ reason: "abnormal", failure: "canceled" })
      })
    );

    expect(dispatched).toEqual(["tasks/default-kind"]);
    expect(state.running.has("tasks/default-kind")).toBe(true);
  });
});

function createDeps(overrides: Partial<TickDeps> = {}): TickDeps {
  return {
    tasks: createTaskList([]),
    steps: createSteps(),
    validateDispatch: async () => ({ ok: true }),
    reconcileRunning: async () => [],
    ensureWorkspace: async (_root, qualifiedId) => ({
      path: `/repo/workspaces/${qualifiedId}`,
      createdNow: true
    }),
    runAttempt: async () => ({ reason: "abnormal", failure: "canceled" }),
    now: () => 0,
    ...overrides
  };
}

function createTaskList(
  tasks: Task[],
  overrides: Partial<Pick<TaskList, "allTasks" | "get" | "list" | "lists">> = {}
): Pick<TaskList, "allTasks" | "get" | "list" | "lists"> {
  return {
    allTasks: async (filter) => tasks.filter((task) => task.state === filter?.state),
    get: async (qualifiedId) => {
      const task = tasks.find((entry) => entry.qualifiedId === qualifiedId);
      if (!task) {
        throw new Error(`not found: ${qualifiedId}`);
      }
      return task;
    },
    list: (name) => ({
      name,
      stateMachine: { initial: "planned", states: ["planned"], events: {} },
      all: async () => tasks.filter((task) => task.list === name),
      get: async (id) => {
        const task = tasks.find((entry) => entry.list === name && entry.id === id);
        if (!task) {
          throw new Error(`not found: ${name}/${id}`);
        }
        return task;
      },
      create: async () => {
        throw new Error("not implemented");
      },
      update: async () => {
        throw new Error("not implemented");
      },
      fire: async () => {
        throw new Error("not implemented");
      },
      canFire: async () => false,
      events: async () => [],
      delete: async () => undefined,
      move: async () => {
        throw new Error("not implemented");
      },
      reorder: async () => []
    }),
    lists: async () => ["tasks"],
    ...overrides
  };
}

function createTask(
  qualifiedId: string,
  overrides: Partial<Pick<Task, "state" | "metadata">> = {}
): Task {
  const id = qualifiedId.split("/").at(-1) ?? qualifiedId;

  return {
    list: "tasks",
    id,
    qualifiedId,
    name: id,
    state: overrides.state ?? "planned",
    description: "",
    metadata: overrides.metadata ?? {}
  };
}

function createConfig(overrides: { maxConcurrentAgents?: number } = {}): ResolvedConfig {
  return {
    tasks: { type: "markdown-dir", path: "/repo/tasks" },
    active_states: ["planned", "in-progress"],
    terminal_states: ["done", "archived"],
    polling: { intervalMs: 30_000 },
    workspace: { root: "/repo/workspaces" },
    agent: {
      service: "codex",
      list: "tasks",
      maxConcurrentAgents: overrides.maxConcurrentAgents ?? 1,
      maxTurns: 20,
      maxRetryBackoffMs: 300_000
    },
    stepOverrides: {}
  };
}

function createSteps(): ResolvedStepsConfig {
  return {
    steps: {
      implement: { mode: "edit", prompt: "{{ prompt }}" }
    }
  };
}

async function waitForWorkers(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
