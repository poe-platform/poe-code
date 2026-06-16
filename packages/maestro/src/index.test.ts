import crypto from "node:crypto";
import * as nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setImmediate as realSetImmediate, setTimeout as realSetTimeout } from "node:timers";
import { fs, vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RalphRunOptions } from "@poe-code/ralph";
import type { StateMachineDef, Task, TaskList, TaskListFs } from "@poe-code/task-list";
import { openTaskList } from "@poe-code/task-list";
import {
  createEventCollector,
  assertNoLeakedWorkers,
  createConfig,
  createMockSpawn,
  createMockTaskList,
  createTask,
  createTaskScriptSpawn,
  createTickDeps
} from "./__test_utils__/index.js";
import {
  createState,
  maestroTaskStateMachine,
  resolveWorkflowPath,
  runMaestro,
  tick,
  type MaestroEvent
} from "./index.js";
import type { TickDeps, TrackedWorker } from "./runtime/loop.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    default: fs.promises
  };
});

describe("runMaestro", () => {
  beforeEach(() => {
    vol.reset();
    vi.useRealTimers();
  });

  it("does not publish an unimplemented experiment workflow driver", async () => {
    const publicApi = await import("./index.js");

    expect(publicApi).not.toHaveProperty("experimentDriver");
  });

  it("resolves the default named workflow at the repository root", () => {
    expect(resolveWorkflowPath("default", "/repo")).toBe("/repo/WORKFLOW.md");
  });

  it("resolves a named workflow at the repository root", () => {
    expect(resolveWorkflowPath("bugs", "/repo")).toBe("/repo/BUGS.WORKFLOW.md");
  });

  it.each(["", "../bugs", "nested/bugs", "nested\\bugs", " bugs ", ".", "..", "two words", "\n"])(
    "rejects a workflow name that is not a root file id: %s",
    (name) => {
      expect(() => resolveWorkflowPath(name, "/repo")).toThrow(
        `Invalid workflow name "${name}". Expected a non-empty id without path separators.`
      );
    }
  );

  it("loads the default named workflow from the repository root", async () => {
    const cwd = vi.spyOn(process, "cwd").mockReturnValue("/repo");
    vol.fromJSON({
      "/repo/WORKFLOW.md": workflowFrontmatter({
        tasks: ["  type: yaml-file", "  path: /repo/tasks.yaml"],
        states: ["  planned:", "    prompt: Work.", "  done:", "    terminal: true"],
        agent: ["  list: tasks"]
      })
    });
    const taskList = createMockTaskList({ lists: ["tasks"] });

    try {
      await expect(runMaestro({ name: "default", dryRun: true, taskList })).resolves.toBeTypeOf(
        "function"
      );
    } finally {
      cwd.mockRestore();
    }
  });

  it("rejects both a workflow path and a workflow name", async () => {
    await expect(runMaestro({ workflowPath: "/repo/WORKFLOW.md", name: "bugs" })).rejects.toThrow(
      "Cannot specify both workflowPath and name for Maestro."
    );
  });

  it("reports a missing named workflow file", async () => {
    const cwd = vi.spyOn(process, "cwd").mockReturnValue("/repo");

    try {
      await expect(runMaestro({ name: "bugs" })).rejects.toThrow(
        "Missing workflow file at /repo/BUGS.WORKFLOW.md."
      );
    } finally {
      cwd.mockRestore();
    }
  });

  it("runs the default state machine, emits phases and agent events, and cleans a completed task workspace", async () => {
    vi.useFakeTimers();
    vol.fromJSON({
      "/repo/WORKFLOW.md": workflowFrontmatter({
        tasks: ["  type: yaml-file", "  path: /repo/tasks.yaml"],
        states: [
          "  planned:",
          "    prompt: Work on {{ task.name }}.",
          "  in-progress:",
          "    prompt: Continue {{ task.name }}.",
          "  done:",
          "    terminal: true",
          "  archived:",
          "    terminal: true"
        ],
        agent: ["  list: tasks"],
        workspace: ["  root: /repo/workspaces"],
        polling: ["  interval_ms: 25"]
      })
    });
    const taskList = await createYamlTaskList(
      "/repo/tasks.yaml",
      fs.promises as unknown as TaskListFs
    );
    const tasks = taskList.list("tasks");
    await tasks.create({ id: "one", name: "One", description: "Do the work" });
    await tasks.fire("one", "plan");
    const events = createEventCollector();
    let spawnCount = 0;
    const spawn = createMockSpawn(() => {
      spawnCount += 1;
      return [
        { kind: "emit", event: { event: "session_start", threadId: `session-${spawnCount}` } },
        { kind: "exit", exitCode: 0 }
      ];
    });
    const stop = await runMaestro({
      workflowPath: "/repo/WORKFLOW.md",
      taskList,
      agentSpawn: spawn.spawn,
      onEvent: events.onEvent
    });
    await vi.advanceTimersByTimeAsync(25);
    await flushMicrotasks();
    await waitForCondition(() => events.events.some((event) => event.type === "worker_exit"));

    await tasks.fire("one", "complete");
    await vi.advanceTimersByTimeAsync(25);
    await waitForCondition(() =>
      events.events.some((event) => event.type === "reconcile" && event.action === "stop_clean")
    );

    expect(
      events.events.filter((event) => event.type === "attempt_phase").map((event) => event.to)
    ).toEqual(["preparing-workspace", "running-step", "succeeded"]);
    expect(
      events.events.filter((event) => event.type === "agent_event").map((event) => event.step)
    ).toEqual(["in-progress"]);
    await expect(tasks.get("one")).resolves.toMatchObject({ state: "done" });
    expect(vol.existsSync("/repo/workspaces/tasks_one")).toBe(false);

    await stop();
  });

  it("runs the recommended state machine handoff path as terminal with cleanup and no retry", async () => {
    vi.useFakeTimers();
    vol.fromJSON({
      "/repo/WORKFLOW.md": workflowFrontmatter({
        tasks: ["  type: yaml-file", "  path: /repo/recommended.yaml"],
        states: [
          "  queued:",
          "    prompt: Work on {{ task.name }}.",
          "  agent-running:",
          "    prompt: Continue {{ task.name }}.",
          "  human-review:",
          "    terminal: true",
          "  failed:",
          "    terminal: true",
          "  archived:",
          "    terminal: true",
          "  done:",
          "    terminal: true"
        ],
        agent: ["  list: maestro"],
        workspace: ["  root: /repo/workspaces"],
        polling: ["  interval_ms: 25"]
      })
    });
    const taskList = await createYamlTaskList(
      "/repo/recommended.yaml",
      fs.promises as unknown as TaskListFs,
      maestroTaskStateMachine
    );
    const tasks = taskList.list("maestro");
    await tasks.create({ id: "handoff", name: "Handoff" });
    const events = createEventCollector();
    const spawn = createMockSpawn({
      codex: [
        {
          kind: "run",
          fn: async () => {
            await tasks.fire("handoff", "handoff");
          }
        },
        { kind: "emit", event: { event: "session_start", threadId: "handoff-session" } },
        { kind: "exit", exitCode: 0 }
      ]
    });

    const stop = await runMaestro({
      workflowPath: "/repo/WORKFLOW.md",
      taskList,
      agentSpawn: spawn.spawn,
      onEvent: events.onEvent
    });
    await vi.advanceTimersByTimeAsync(25);
    await waitForCondition(() =>
      events.events.some((event) => event.type === "reconcile" && event.action === "stop_clean")
    );

    expect(spawn.calls).toHaveLength(1);
    expect(
      events.events.filter((event) => event.type === "attempt_phase").map((event) => event.to)
    ).toEqual(["preparing-workspace", "running-step", "canceled"]);
    expect(events.events.some((event) => event.type === "retry_scheduled")).toBe(false);
    await expect(tasks.get("handoff")).resolves.toMatchObject({ state: "human-review" });
    expect(vol.existsSync("/repo/workspaces/maestro_handoff")).toBe(false);

    await stop();
  });

  it("dry-runs validation and exits without spawning", async () => {
    vol.fromJSON({
      "/repo/WORKFLOW.md": workflowFrontmatter({
        tasks: ["  type: yaml-file", "  path: /repo/tasks.yaml"],
        states: [
          "  planned:",
          "    prompt: Work on {{ task.name }}.",
          "  in-progress:",
          "    prompt: Continue {{ task.name }}.",
          "  done:",
          "    terminal: true",
          "  archived:",
          "    terminal: true"
        ],
        agent: ["  list: tasks"],
        workspace: ["  root: /repo/workspaces"],
        polling: ["  interval_ms: 25"]
      })
    });
    const taskList = await createYamlTaskList(
      "/repo/tasks.yaml",
      fs.promises as unknown as TaskListFs
    );
    const tasks = taskList.list("tasks");
    await tasks.create({ id: "one", name: "One", description: "Do the work" });
    await tasks.fire("one", "plan");
    const spawn = createMockSpawn();
    const logger = { info: vi.fn(), error: vi.fn() };
    const stop = await runMaestro({
      workflowPath: "/repo/WORKFLOW.md",
      dryRun: true,
      taskList,
      agentSpawn: spawn.spawn,
      logger
    });

    expect(spawn.calls).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith("maestro config OK", {
      tasks: "yaml-file",
      list: "tasks"
    });
    expect(logger.info).toHaveBeenCalledWith("maestro task store open OK", {
      candidates: 1,
      candidateIds: ["tasks/one"],
      skipped: 0,
      skippedKinds: []
    });
    expect(logger.info).toHaveBeenCalledWith("maestro dry-run complete");

    await expect(stop()).resolves.toBeUndefined();
  });

  it("reports unsupported workflow kinds in dry-run candidate logs", async () => {
    vol.fromJSON({
      "/repo/WORKFLOW.md": workflowFrontmatter({
        tasks: ["  type: yaml-file", "  path: /repo/tasks.yaml"],
        states: [
          "  planned:",
          "    prompt: Work on {{ task.name }}.",
          "  in-progress:",
          "    prompt: Continue {{ task.name }}.",
          "  done:",
          "    terminal: true",
          "  archived:",
          "    terminal: true"
        ],
        agent: ["  list: tasks"],
        workspace: ["  root: /repo/workspaces"],
        polling: ["  interval_ms: 25"]
      })
    });
    const activeTasks = [
      createTask({
        qualifiedId: "tasks/one",
        name: "One",
        state: "planned",
        description: "Do the work",
        metadata: { kind: "pipeline" }
      }),
      createTask({
        qualifiedId: "tasks/two",
        name: "Two",
        state: "planned",
        description: "Coordinate the work",
        sourcePath: "/repo/tasks/two.md",
        metadata: { kind: "superintendent" }
      })
    ];
    const taskList = createMockTaskList({ lists: ["tasks"], tasks: activeTasks });
    const spawn = createMockSpawn();
    const logger = { info: vi.fn(), error: vi.fn() };

    await runMaestro({
      workflowPath: "/repo/WORKFLOW.md",
      dryRun: true,
      taskList,
      agentSpawn: spawn.spawn,
      logger
    });

    expect(logger.info).toHaveBeenCalledWith("maestro task store open OK", {
      candidates: 2,
      candidateIds: ["tasks/one", "tasks/two"],
      skipped: 1,
      skippedKinds: ["superintendent"]
    });
  });

  it("opens configured file task lists with an any-to-any machine from state order", async () => {
    vol.fromJSON({
      "/repo/WORKFLOW.md": workflowFrontmatter({
        tasks: ["  type: yaml-file", "  path: /repo/tasks.yaml"],
        states: [
          "  queued:",
          "    prompt: Work on {{ task.name }}.",
          "  done:",
          "    terminal: true"
        ],
        agent: ["  list: tasks"]
      }),
      "/repo/tasks.yaml": [
        "$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json",
        "kind: task-store",
        "version: 1",
        "lists:",
        "  tasks:",
        "    one:",
        "      name: One",
        "      state: queued",
        "      description: Do the work",
        ""
      ].join("\n")
    });
    const logger = { info: vi.fn(), error: vi.fn() };

    const stop = await runMaestro({
      workflowPath: "/repo/WORKFLOW.md",
      dryRun: true,
      logger
    });

    expect(logger.info).toHaveBeenCalledWith("maestro task store open OK", {
      candidates: 1,
      candidateIds: ["tasks/one"],
      skipped: 0,
      skippedKinds: []
    });
    await stop();
  });
});

describe("shutdown", () => {
  beforeEach(() => {
    vol.reset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns within 50ms of virtual time when no workers are active", async () => {
    vol.fromJSON({
      "/repo/WORKFLOW.md": shutdownWorkflow()
    });
    const taskList = createMockTaskList({ lists: ["tasks"] });
    const stop = await runMaestro({
      workflowPath: "/repo/WORKFLOW.md",
      taskList,
      agentSpawn: createMockSpawn().spawn
    });

    const startedAt = Date.now();
    await stop();

    expect(Date.now() - startedAt).toBeLessThan(50);
  });

  it("aborts all active workers and waits for their promises to settle within the stop budget", async () => {
    vol.fromJSON({
      "/repo/WORKFLOW.md": shutdownWorkflow({ maxConcurrentAgents: 5 })
    });
    const taskList = createMockTaskList({
      lists: ["tasks"],
      tasks: Array.from({ length: 5 }, (_, index) =>
        createTask({
          qualifiedId: `tasks/worker-${index + 1}`,
          metadata: { createdAt: `2026-01-01T00:00:0${index}.000Z` }
        })
      )
    });
    const events = createEventCollector();
    const spawn = createMockSpawn({
      codex: [
        {
          kind: "run",
          fn: async (call) => {
            await onceAborted(call.signal);
          }
        }
      ]
    });
    const stop = await runMaestro({
      workflowPath: "/repo/WORKFLOW.md",
      taskList,
      maxConcurrent: 5,
      agentSpawn: spawn.spawn,
      onEvent: events.onEvent
    });
    await advancePoll();
    await waitForCondition(() => spawn.calls.length === 5);

    const stoppedAt = Date.now();
    const stopPromise = stop();
    await flushMicrotasks();

    expect(spawn.calls).toHaveLength(5);
    expect(spawn.calls.every((call) => call.signal?.aborted === true)).toBe(true);
    await stopPromise;
    expect(Date.now() - stoppedAt).toBeLessThan(STOP_BUDGET_MS);
  });

  it("returns after the stop budget when a worker ignores abort and still attempts workspace cleanup", async () => {
    vol.fromJSON({
      "/repo/WORKFLOW.md": shutdownWorkflow()
    });
    const taskList = createMockTaskList({
      lists: ["tasks"],
      tasks: [createTask({ qualifiedId: "tasks/blocked" })]
    });
    const events = createEventCollector();
    const spawn = createMockSpawn({
      codex: [{ kind: "wait", ms: STOP_BUDGET_MS + 1, ignoreAbort: true }]
    });
    const stop = await runMaestro({
      workflowPath: "/repo/WORKFLOW.md",
      taskList,
      agentSpawn: spawn.spawn,
      onEvent: events.onEvent
    });
    await advancePoll();
    await waitForEventCount(events.events, 2);

    const stopPromise = stop();
    await flushMicrotasks();
    expect(await promiseSettled(stopPromise)).toBe(false);
    await vi.advanceTimersByTimeAsync(STOP_BUDGET_MS - 1);
    expect(await promiseSettled(stopPromise)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopPromise;

    expect(vol.existsSync(shutdownWorkspacePath("blocked"))).toBe(false);
  });

  it("waits for an active tick to finish before stop returns", async () => {
    vol.fromJSON({
      "/repo/WORKFLOW.md": shutdownWorkflow()
    });
    const plannedTasks = deferred<Task[]>();
    const taskList = createMockTaskList({
      lists: ["tasks"],
      tasks: [createTask({ qualifiedId: "tasks/delayed" })],
      readers: {
        allTasks: (filter) => {
          if (filter?.state === "planned") {
            return plannedTasks.promise;
          }

          return [];
        }
      }
    });
    const events = createEventCollector();
    const stop = await runMaestro({
      workflowPath: "/repo/WORKFLOW.md",
      taskList,
      agentSpawn: createMockSpawn().spawn,
      onEvent: events.onEvent
    });
    await advancePoll();
    await waitForEventCount(events.events, 1);

    const stopPromise = stop();
    await flushMicrotasks();
    expect(await promiseSettled(stopPromise)).toBe(false);

    plannedTasks.resolve([]);
    await stopPromise;

    expect(stripUndefined(events.events)).toEqual([tickEvent(25)]);
  });

  it("logs workspace cleanup failures during stop and still resolves", async () => {
    vol.fromJSON({
      "/repo/WORKFLOW.md": shutdownWorkflow()
    });
    const taskList = createMockTaskList({
      lists: ["tasks"],
      tasks: [createTask({ qualifiedId: "tasks/cleanup-fails" })]
    });
    const logger = { warn: vi.fn(), error: vi.fn() };
    const rmSpy = vi.spyOn(fs.promises, "rm").mockRejectedValueOnce(new Error("rm failed"));
    const events = createEventCollector();
    const stop = await runMaestro({
      workflowPath: "/repo/WORKFLOW.md",
      taskList,
      agentSpawn: createMockSpawn({
        codex: [{ kind: "wait", ms: STOP_BUDGET_MS + 1, ignoreAbort: true }]
      }).spawn,
      logger,
      onEvent: events.onEvent
    });
    await advancePoll();
    await waitForEventCount(events.events, 2);

    const stopPromise = stop();
    await vi.advanceTimersByTimeAsync(STOP_BUDGET_MS);
    await expect(stopPromise).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith("maestro workspace cleanup failed", {
      taskId: "tasks/cleanup-fails",
      error: "rm failed"
    });
    expect(rmSpy).toHaveBeenCalled();
  });

  it("can be invoked from a SIGTERM-style signal handler without awaiting in the handler", async () => {
    vol.fromJSON({
      "/repo/WORKFLOW.md": shutdownWorkflow()
    });
    const taskList = createMockTaskList({ lists: ["tasks"] });
    const stop = await runMaestro({
      workflowPath: "/repo/WORKFLOW.md",
      taskList,
      agentSpawn: createMockSpawn().spawn
    });
    process.once("SIGTERM", stop);

    try {
      expect(process.emit("SIGTERM", "SIGTERM")).toBe(true);
    } finally {
      process.removeListener("SIGTERM", stop);
    }
  });

  it("releases state, applies retry, and does not leak workers when runAttempt throws synchronously", async () => {
    const state = createState(
      createConfig({
        states: {
          planned: { prompt: "Plan {{ prompt }}" },
          done: { terminal: true }
        },
        activeStateNames: ["planned"],
        terminalStateNames: ["done"],
        stateOrder: ["planned", "done"],
        workspace: { root: "/repo/workspaces" }
      })
    );
    const task = createTask({ qualifiedId: "tasks/sync-throw" });
    const workers = new Map<string, TrackedWorker>();
    const workerPromises: Promise<void>[] = [];
    const logger = { error: vi.fn() };

    await tick(
      state,
      createTickDeps({
        tasks: createMockTaskList({ lists: ["tasks"], tasks: [task] }),
        runAttempt: (() => {
          throw new Error("sync boom");
        }) as NonNullable<TickDeps["runAttempt"]>,
        trackWorker: (worker) => {
          workers.set(worker.taskId, worker);
          workerPromises.push(worker.promise);
          void worker.promise.finally(() => {
            workers.delete(worker.taskId);
          });
        },
        logger,
        now: () => 5_000
      })
    );
    await Promise.allSettled(workerPromises);

    expect(logger.error).toHaveBeenCalledWith("maestro worker rejected", {
      taskId: "tasks/sync-throw",
      attempt: 1,
      error: "sync boom"
    });
    expect(state.retry_attempts.get("tasks/sync-throw")).toEqual({
      taskId: "tasks/sync-throw",
      attempt: 2,
      dueAt: 15_000
    });
    expect(state.running.has("tasks/sync-throw")).toBe(false);
    assertNoLeakedWorkers(state, workers);
  });
});

describe("integration", () => {
  const tempRoots: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const root of tempRoots.splice(0)) {
      nodeFs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs one task from planned to done after one full tick", async () => {
    const { runMaestro } = await importRealMaestro();
    const fixture = createIntegrationFixture("happy");
    tempRoots.push(fixture.root);
    const taskList = createIntegrationTaskList([
      integrationTask("one", { metadata: { createdAt: "2026-01-01T00:00:00.000Z" } })
    ]);
    const spawn = createTaskScriptSpawn(taskList, {
      one: [{ kind: "complete" }]
    });
    const events = createEventCollector();
    const stop = await runMaestro({
      workflowPath: fixture.workflowPath,
      taskList,
      agentSpawn: spawn.spawn,
      onEvent: events.onEvent
    });

    await advancePoll();
    await waitForEventCount(events.events, 8);

    expect(stripUndefined(events.events)).toEqual([
      tickEvent(25),
      dispatchEvent(fixture, "one"),
      { type: "attempt_phase", task_id: "tasks/one", from: null, to: "preparing-workspace" },
      {
        type: "attempt_phase",
        task_id: "tasks/one",
        from: "preparing-workspace",
        to: "running-step",
        step: "in-progress"
      },
      {
        type: "agent_event",
        task_id: "tasks/one",
        step: "in-progress",
        session_id: "thread-one-1",
        event: "exit",
        payload: { exitCode: 0 }
      },
      { type: "attempt_phase", task_id: "tasks/one", from: "running-step", to: "succeeded" },
      { type: "worker_exit", task_id: "tasks/one", reason: "normal" },
      { type: "reconcile", task_id: "tasks/one", action: "stop_clean" }
    ]);
    await expect(taskList.get("tasks/one")).resolves.toMatchObject({ state: "done" });

    await stop();
  });

  it("dispatches three tasks with capacity two across three ticks", async () => {
    const { runMaestro } = await importRealMaestro();
    const fixture = createIntegrationFixture("capacity");
    tempRoots.push(fixture.root);
    const taskList = createIntegrationTaskList([
      integrationTask("one", { metadata: { createdAt: "2026-01-01T00:00:00.000Z" } }),
      integrationTask("two", { metadata: { createdAt: "2026-01-01T00:00:01.000Z" } }),
      integrationTask("three", { metadata: { createdAt: "2026-01-01T00:00:02.000Z" } })
    ]);
    const spawn = createTaskScriptSpawn(taskList, {
      one: [{ kind: "complete" }],
      two: [{ kind: "complete" }],
      three: [{ kind: "complete" }]
    });
    const events = createEventCollector();
    const stop = await runMaestro({
      workflowPath: fixture.workflowPath,
      maxConcurrent: 2,
      taskList,
      agentSpawn: spawn.spawn,
      onEvent: events.onEvent
    });

    await advancePoll();
    await waitForEventCount(events.events, 15);
    await advancePoll();
    await waitForEventCount(events.events, 23);
    await advancePoll();
    await waitForEventCount(events.events, 24);

    const capturedEvents = stripUndefined(events.events);
    const tick50Index = capturedEvents.findIndex(
      (event) => event.type === "tick_started" && event.at === tickEvent(50).at
    );
    const dispatches = capturedEvents.filter((event) => event.type === "dispatch");

    expect(capturedEvents[0]).toEqual(tickEvent(25));
    expect(tick50Index).toBeGreaterThan(0);
    expect(capturedEvents.at(-1)).toEqual(tickEvent(75));
    expect(
      dispatches
        .slice(0, 2)
        .map((event) => event.task_id)
        .sort()
    ).toEqual(["tasks/one", "tasks/two"]);
    expect(dispatches[2]).toEqual(dispatchEvent(fixture, "three"));
    expect(capturedEvents.findIndex((event) => event === dispatches[2])).toBeGreaterThan(
      tick50Index
    );
    expect(taskEvents(capturedEvents, "one")).toEqual([
      dispatchEvent(fixture, "one"),
      ...successEvents("one")
    ]);
    expect(taskEvents(capturedEvents, "two")).toEqual([
      dispatchEvent(fixture, "two"),
      ...successEvents("two")
    ]);
    expect(taskEvents(capturedEvents, "three")).toEqual([
      dispatchEvent(fixture, "three"),
      ...successEvents("three")
    ]);
    expect(spawn.calls.map((call) => taskIdFromPrompt(call.prompt)).sort()).toEqual([
      "one",
      "three",
      "two"
    ]);

    await stop();
  });

  it("handles success, retryable failure, and non-retryable failure in chronological order", async () => {
    const { runMaestro } = await importRealMaestro();
    const fixture = createIntegrationFixture("mixed");
    tempRoots.push(fixture.root);
    const taskList = createIntegrationTaskList([
      integrationTask("success", { metadata: { createdAt: "2026-01-01T00:00:00.000Z" } }),
      integrationTask("retry", { metadata: { createdAt: "2026-01-01T00:00:01.000Z" } }),
      integrationTask("cancel", { metadata: { createdAt: "2026-01-01T00:00:02.000Z" } })
    ]);
    const spawn = createTaskScriptSpawn(taskList, {
      success: [{ kind: "complete" }],
      retry: [{ kind: "exit", exitCode: 1 }, { kind: "complete" }],
      cancel: [{ kind: "fail" }]
    });
    const events = createEventCollector();
    const stop = await runMaestro({
      workflowPath: fixture.workflowPath,
      maxConcurrent: 1,
      pollIntervalMs: 10_000,
      taskList,
      agentSpawn: spawn.spawn,
      onEvent: events.onEvent
    });

    await advanceBy(10_000);
    await waitForEventCount(events.events, 8);
    await advanceBy(10_000);
    await waitForEventCount(events.events, 16);
    await advanceBy(10_000);
    await waitForEventCount(events.events, 24);
    await advanceBy(10_000);
    await waitForEventCount(events.events, 33);

    expect(stripUndefined(events.events)).toEqual([
      tickEvent(10_000),
      dispatchEvent(fixture, "success"),
      ...successEvents("success"),
      tickEvent(20_000),
      dispatchEvent(fixture, "retry"),
      ...failedRetryEvents("retry"),
      tickEvent(30_000),
      { type: "reconcile", task_id: "tasks/retry", action: "update" },
      dispatchEvent(fixture, "cancel"),
      ...cancelEvents("cancel"),
      tickEvent(40_000),
      { type: "reconcile", task_id: "tasks/retry", action: "update" },
      dispatchEvent(fixture, "retry"),
      ...successEvents("retry", 2)
    ]);
    expect(
      stripUndefined(events.events).filter(
        (event) => event.type === "retry_scheduled" && event.task_id === "tasks/cancel"
      )
    ).toEqual([]);
    await expect(taskList.get("tasks/retry")).resolves.toMatchObject({ state: "done" });
    await expect(taskList.get("tasks/cancel")).resolves.toMatchObject({ state: "failed" });

    await stop();
  });

  it("honors the stop budget during an in-flight dispatch and releases resources", async () => {
    const { runMaestro } = await importRealMaestro();
    const fixture = createIntegrationFixture("abort-dispatch");
    tempRoots.push(fixture.root);
    const taskList = createIntegrationTaskList([integrationTask("blocked")]);
    const spawn = createTaskScriptSpawn(taskList, { blocked: [{ kind: "block" }] });
    const events = createEventCollector();
    const stop = await runMaestro({
      workflowPath: fixture.workflowPath,
      taskList,
      agentSpawn: spawn.spawn,
      onEvent: events.onEvent
    });

    await advanceBy(25);
    await waitForEventCount(events.events, 4);
    const stopPromise = stop();
    await flushMicrotasks();
    expect(await promiseSettled(stopPromise)).toBe(false);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(await promiseSettled(stopPromise)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopPromise;

    expect(stripUndefined(events.events)).toEqual([
      tickEvent(25),
      dispatchEvent(fixture, "blocked"),
      { type: "attempt_phase", task_id: "tasks/blocked", from: null, to: "preparing-workspace" },
      {
        type: "attempt_phase",
        task_id: "tasks/blocked",
        from: "preparing-workspace",
        to: "running-step",
        step: "in-progress"
      }
    ]);
    expect(nodeFs.existsSync(workspacePath(fixture, "blocked"))).toBe(false);
  });

  it("stops before the first interval tick without spawning workers", async () => {
    const { runMaestro } = await importRealMaestro();
    const fixture = createIntegrationFixture("abort-before-tick");
    tempRoots.push(fixture.root);
    const taskList = createIntegrationTaskList([integrationTask("one")]);
    const spawn = createTaskScriptSpawn(taskList, { one: [{ kind: "complete" }] });
    const events = createEventCollector();
    const stop = await runMaestro({
      workflowPath: fixture.workflowPath,
      taskList,
      agentSpawn: spawn.spawn,
      onEvent: events.onEvent
    });

    await stop();

    expect(stripUndefined(events.events)).toEqual([]);
    expect(spawn.calls).toEqual([]);
  });

  it("allows stop to be called twice without double cleanup", async () => {
    const { runMaestro } = await importRealMaestro();
    const fixture = createIntegrationFixture("reentrant-stop");
    tempRoots.push(fixture.root);
    const taskList = createIntegrationTaskList([integrationTask("one")]);
    const spawn = createTaskScriptSpawn(taskList, { one: [{ kind: "complete" }] });
    const events = createEventCollector();
    const stop = await runMaestro({
      workflowPath: fixture.workflowPath,
      taskList,
      agentSpawn: spawn.spawn,
      onEvent: events.onEvent
    });

    await advancePoll();
    await waitForEventCount(events.events, 8);
    await expect(stop()).resolves.toBeUndefined();
    await expect(stop()).resolves.toBeUndefined();

    expect(stripUndefined(events.events)).toEqual([
      tickEvent(25),
      dispatchEvent(fixture, "one"),
      ...successEvents("one")
    ]);
  });

  it("dry-runs a mock task list, reports candidates, and does not dispatch", async () => {
    const { runMaestro } = await importRealMaestro();
    const fixture = createIntegrationFixture("dry-run");
    tempRoots.push(fixture.root);
    const taskList = createIntegrationTaskList(["one", "two"].map(integrationTask));
    const spawn = createTaskScriptSpawn(taskList, {
      one: [{ kind: "complete" }],
      two: [{ kind: "complete" }]
    });
    const logger = { info: vi.fn(), error: vi.fn() };
    const events = createEventCollector();

    const stop = await runMaestro({
      workflowPath: fixture.workflowPath,
      dryRun: true,
      taskList,
      agentSpawn: spawn.spawn,
      logger,
      onEvent: events.onEvent
    });

    expect(stripUndefined(events.events)).toEqual([]);
    expect(spawn.calls).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith("maestro task store open OK", {
      candidates: 2,
      candidateIds: ["tasks/one", "tasks/two"],
      skipped: 0,
      skippedKinds: []
    });
    await expect(stop()).resolves.toBeUndefined();
  });

  it("dry-runs validation failure, emits validation_failed, and throws", async () => {
    const { runMaestro } = await importRealMaestro();
    const fixture = createIntegrationFixture("dry-run-validation", { list: "missing" });
    tempRoots.push(fixture.root);
    const taskList = createIntegrationTaskList([integrationTask("one")]);
    const spawn = createTaskScriptSpawn(taskList, { one: [{ kind: "complete" }] });
    const events = createEventCollector();

    await expect(
      runMaestro({
        workflowPath: fixture.workflowPath,
        dryRun: true,
        taskList,
        agentSpawn: spawn.spawn,
        onEvent: events.onEvent
      })
    ).rejects.toThrow("list_not_found");

    expect(stripUndefined(events.events)).toEqual([
      { type: "validation_failed", reason: "list_not_found" }
    ]);
    expect(spawn.calls).toEqual([]);
  });

  it("routes mixed pipeline and ralph tasks through their resolved workflow kinds", async () => {
    const { runMaestro } = await importRealMaestro();
    const fixture = createIntegrationFixture("driver-mix");
    tempRoots.push(fixture.root);
    const pipelineTask = integrationTask("pipeline", {
      metadata: { kind: "pipeline", createdAt: "2026-01-01T00:00:00.000Z" }
    });
    const ralphPath = path.join(fixture.root, "ralph.md");
    nodeFs.writeFileSync(ralphPath, "ralph plan", "utf8");
    const ralphTask = integrationTask("ralph", {
      sourcePath: ralphPath,
      metadata: { kind: "ralph", createdAt: "2026-01-01T00:00:01.000Z" }
    } as Partial<Task>);
    const taskList = createIntegrationTaskList([pipelineTask, ralphTask]);
    const spawn = createTaskScriptSpawn(taskList, {
      pipeline: [{ kind: "complete" }],
      ralph: [{ kind: "complete" }]
    });
    const events = createEventCollector();
    const stop = await runMaestro({
      workflowPath: fixture.workflowPath,
      maxConcurrent: 2,
      taskList,
      agentSpawn: spawn.spawn,
      onEvent: events.onEvent
    });

    await advancePoll();
    await waitForEventCount(events.events, 13);

    const eventSnapshot = stripUndefined(events.events);
    const nonReconcileEventsForTask = (id: string) =>
      eventsForTask(eventSnapshot, id).filter((event) => event.type !== "reconcile");
    expect(eventSnapshot[0]).toEqual(tickEvent(25));
    expect(nonReconcileEventsForTask("pipeline")).toEqual([
      dispatchEvent(fixture, "pipeline"),
      ...successEvents("pipeline", 1, { reconcile: false })
    ]);
    expect(nonReconcileEventsForTask("ralph")).toEqual([
      dispatchEvent(fixture, "ralph"),
      {
        type: "attempt_phase",
        task_id: "tasks/ralph",
        from: null,
        to: "running-step",
        step: "ralph"
      },
      {
        type: "agent_event",
        task_id: "tasks/ralph",
        step: "ralph",
        session_id: "",
        event: "iteration_complete",
        payload: { iteration: 1, durationMs: 0, success: true }
      },
      {
        type: "attempt_phase",
        task_id: "tasks/ralph",
        from: "running-step",
        to: "succeeded"
      },
      { type: "worker_exit", task_id: "tasks/ralph", reason: "normal" }
    ]);
    expect(spawn.calls.map((call) => taskIdFromPrompt(call.prompt))).toEqual(["pipeline", "ralph"]);

    await stop();
  });
});

type IntegrationFixture = {
  root: string;
  workflowPath: string;
  workspaceRoot: string;
};

const STOP_BUDGET_MS = 10_000;

const integrationStateMachine: StateMachineDef = {
  initial: "planned",
  states: ["planned", "in-progress", "done", "failed", "archived"],
  events: {
    start: { from: ["planned"], to: "in-progress" },
    complete: { from: ["in-progress"], to: "done" },
    fail: { from: ["in-progress"], to: "failed" },
    archive: { from: ["done", "failed"], to: "archived" }
  }
};

async function importRealMaestro(): Promise<typeof import("./index.js")> {
  vi.resetModules();
  vi.doUnmock("node:fs/promises");
  vi.doMock("@poe-code/ralph", () => ({
    runRalph: vi.fn(async (options: RalphRunOptions) => {
      if (options.signal?.aborted) {
        return { stopReason: "cancelled" };
      }

      await options.runAgent({
        agent: "codex",
        cwd: options.cwd,
        prompt: "task:ralph driver:ralph",
        signal: options.signal
      });
      options.onIterationComplete(1, 0, true);
      return { stopReason: "completed" };
    })
  }));

  return import("./index.js");
}

function createIntegrationFixture(
  name: string,
  options: { list?: string } = {}
): IntegrationFixture {
  const root = nodeFs.mkdtempSync(path.join(nodeFs.realpathSync(os.tmpdir()), `maestro-${name}-`));
  const workflowPath = path.join(root, "WORKFLOW.md");
  const workspaceRoot = path.join(root, "workspaces");
  nodeFs.writeFileSync(
    workflowPath,
    workflowFrontmatter({
      tasks: ["  type: markdown-dir", "  path: ./tasks"],
      states: [
        "  planned:",
        '    prompt: "task:{{ task.id }} state:{{ task.state }}"',
        "  in-progress:",
        '    prompt: "task:{{ task.id }} state:{{ task.state }}"',
        "  done:",
        "    terminal: true",
        "  failed:",
        "    terminal: true",
        "  archived:",
        "    terminal: true"
      ],
      agent: [
        "  service: codex",
        `  list: ${options.list ?? "tasks"}`,
        "  max_concurrent_agents: 1"
      ],
      workspace: [`  root: ${workspaceRoot}`],
      polling: ["  interval_ms: 25"]
    }),
    "utf8"
  );

  return { root, workflowPath, workspaceRoot };
}

function createIntegrationTaskList(tasks: readonly Task[]): TaskList {
  return createMockTaskList({
    tasks,
    lists: ["tasks"],
    stateMachine: integrationStateMachine
  });
}

function integrationTask(id: string, overrides: Partial<Task> = {}): Task {
  return createTask({
    qualifiedId: `tasks/${id}`,
    state: "planned",
    name: id,
    description: `Task ${id}`,
    metadata: { createdAt: "2026-01-01T00:00:00.000Z", ...overrides.metadata },
    ...overrides
  });
}

function taskIdFromPrompt(prompt: string): string {
  const prefix = "task:";
  const start = prompt.indexOf(prefix);
  if (start < 0) {
    throw new Error(`Missing task id in prompt: ${prompt}`);
  }

  const rest = prompt.slice(start + prefix.length);
  const end = rest.indexOf(" ");
  return end < 0 ? rest : rest.slice(0, end);
}

async function advancePoll(): Promise<void> {
  await advanceBy(25);
}

async function advanceBy(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await flushMicrotasks();
}

async function waitForEventCount(events: readonly MaestroEvent[], count: number): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (events.length >= count) {
      return;
    }

    await vi.advanceTimersByTimeAsync(0);
    await new Promise<void>((resolve) => realSetImmediate(resolve));
    await flushMicrotasks();

    if (attempt % 20 === 19) {
      await new Promise<void>((resolve) => realSetTimeout(resolve, 1));
    }
  }

  if (events.length >= count) {
    return;
  }

  throw new Error(`Expected ${count} maestro events, received ${events.length}.`);
}

async function promiseSettled(promise: Promise<unknown>): Promise<boolean> {
  const pending = Symbol("pending");
  const result = await Promise.race([
    promise.then(
      () => true,
      () => true
    ),
    Promise.resolve(pending)
  ]);
  return result !== pending;
}

function tickEvent(ms: number): MaestroEvent {
  return { type: "tick_started", at: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, ms)).toISOString() };
}

function dispatchEvent(fixture: IntegrationFixture, id: string): MaestroEvent {
  return {
    type: "dispatch",
    task_id: `tasks/${id}`,
    qualified_id: `tasks/${id}`,
    workspace: workspacePath(fixture, id)
  };
}

function taskEvents(events: readonly MaestroEvent[], id: string): MaestroEvent[] {
  const taskId = `tasks/${id}`;
  return events.filter((event) => "task_id" in event && event.task_id === taskId);
}

function successEvents(
  id: string,
  attempt = 1,
  options: { reconcile?: boolean } = {}
): MaestroEvent[] {
  const events: MaestroEvent[] = [
    { type: "attempt_phase", task_id: `tasks/${id}`, from: null, to: "preparing-workspace" },
    {
      type: "attempt_phase",
      task_id: `tasks/${id}`,
      from: "preparing-workspace",
      to: "running-step",
      step: "in-progress"
    },
    {
      type: "agent_event",
      task_id: `tasks/${id}`,
      step: "in-progress",
      session_id: `thread-${id}-${attempt}`,
      event: "exit",
      payload: { exitCode: 0 }
    },
    { type: "attempt_phase", task_id: `tasks/${id}`, from: "running-step", to: "succeeded" },
    { type: "worker_exit", task_id: `tasks/${id}`, reason: "normal" }
  ];

  if (options.reconcile !== false) {
    events.push({ type: "reconcile", task_id: `tasks/${id}`, action: "stop_clean" });
  }

  return events;
}

function failedRetryEvents(id: string): MaestroEvent[] {
  return [
    { type: "attempt_phase", task_id: `tasks/${id}`, from: null, to: "preparing-workspace" },
    {
      type: "attempt_phase",
      task_id: `tasks/${id}`,
      from: "preparing-workspace",
      to: "running-step",
      step: "in-progress"
    },
    {
      type: "agent_event",
      task_id: `tasks/${id}`,
      step: "in-progress",
      session_id: `thread-${id}-1`,
      event: "exit",
      payload: { exitCode: 1 }
    },
    {
      type: "attempt_phase",
      task_id: `tasks/${id}`,
      from: "running-step",
      to: "failed",
      failure: "step_failed"
    },
    {
      type: "worker_exit",
      task_id: `tasks/${id}`,
      reason: "abnormal",
      failure: "step_failed",
      failedStep: "in-progress",
      error: "exitCode=1"
    },
    { type: "retry_scheduled", task_id: `tasks/${id}`, attempt: 2, due_in_ms: 10_000 }
  ];
}

function cancelEvents(id: string, options: { reconcile?: boolean } = {}): MaestroEvent[] {
  const events: MaestroEvent[] = [
    { type: "attempt_phase", task_id: `tasks/${id}`, from: null, to: "preparing-workspace" },
    {
      type: "attempt_phase",
      task_id: `tasks/${id}`,
      from: "preparing-workspace",
      to: "running-step",
      step: "in-progress"
    },
    { type: "attempt_phase", task_id: `tasks/${id}`, from: "running-step", to: "canceled" },
    { type: "worker_exit", task_id: `tasks/${id}`, reason: "abnormal", failure: "canceled" }
  ];

  if (options.reconcile !== false) {
    events.push({ type: "reconcile", task_id: `tasks/${id}`, action: "stop_clean" });
  }

  return events;
}

function workspacePath(fixture: IntegrationFixture, id: string): string {
  const qualifiedId = `tasks/${id}`;
  return path.join(fixture.workspaceRoot, `tasks_${id}-${workspaceHash(qualifiedId)}`);
}

function shutdownWorkspacePath(id: string): string {
  const qualifiedId = `tasks/${id}`;
  return `/repo/workspaces/tasks_${id}-${workspaceHash(qualifiedId)}`;
}

function workspaceHash(qualifiedId: string): string {
  return crypto.createHash("sha256").update(qualifiedId).digest("hex").slice(0, 16);
}

function stripUndefined(events: readonly MaestroEvent[]): MaestroEvent[] {
  return events.map((event) => JSON.parse(JSON.stringify(event)) as MaestroEvent);
}

function eventsForTask(events: readonly MaestroEvent[], id: string): MaestroEvent[] {
  return events.filter((event) => "task_id" in event && event.task_id === `tasks/${id}`);
}

async function createYamlTaskList(
  filePath: string,
  fs: TaskListFs,
  stateMachine?: StateMachineDef
): Promise<TaskList> {
  return openTaskList({
    type: "yaml-file",
    path: filePath,
    create: true,
    fs,
    ...(stateMachine ? { stateMachine } : {})
  });
}

function workflowFrontmatter(parts: Record<string, string[]>): string {
  const lines = ["---"];

  for (const [key, value] of Object.entries(parts)) {
    lines.push(`${key}:`, ...value);
  }

  lines.push("---", "", "Work on {{ task.name }}.");
  return lines.join("\n");
}

function shutdownWorkflow(options: { maxConcurrentAgents?: number } = {}): string {
  return workflowFrontmatter({
    tasks: ["  type: markdown-dir", "  path: /repo/tasks"],
    states: [
      "  planned:",
      '    prompt: "task:{{ task.id }} state:{{ task.state }}"',
      "  done:",
      "    terminal: true"
    ],
    agent: [
      "  service: codex",
      "  list: tasks",
      `  max_concurrent_agents: ${options.maxConcurrentAgents ?? 1}`
    ],
    workspace: ["  root: /repo/workspaces"],
    polling: ["  interval_ms: 25"]
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await Promise.resolve();
  }
}

async function onceAborted(signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) {
    return;
  }

  if (signal?.aborted === true) {
    return;
  }

  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });

  return { promise, resolve };
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await flushMicrotasks();

    if (condition()) {
      return;
    }

    await vi.advanceTimersByTimeAsync(1);
  }

  throw new Error("Condition was not met.");
}
