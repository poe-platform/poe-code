import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createConfig,
  createEventCollector,
  createMockSpawn,
  createMockTaskList,
  createTask,
  createTickDeps
} from "../__test_utils__/index.js";
import type { MaestroEvent } from "../index.js";
import { tick, type TickDeps, type TickEvent } from "./loop.js";
import { createState, markRunning, scheduleRetry } from "./state.js";
import { pipelineDriver } from "../drivers/pipeline.js";
import { registerDriver } from "../drivers/registry.js";

const loopConfigOverrides = {
  tasks: { type: "markdown-dir", path: "/repo/tasks" },
  states: {
    planned: { prompt: "Plan {{ prompt }}" },
    "in-progress": { prompt: "Implement {{ prompt }}" },
    done: { terminal: true },
    archived: { terminal: true }
  },
  workspace: { root: "/repo/workspaces" },
  agent: { list: "tasks" }
} satisfies Parameters<typeof createConfig>[0];

describe("tick", () => {
  beforeEach(() => {
    registerDriver(pipelineDriver);
  });

  it("reconciles before preflight, dispatches, and schedules retry after worker exit", async () => {
    const task = createTask({
      qualifiedId: "tasks/next",
      state: "planned",
      metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
    });
    const state = createState(createConfig({ ...loopConfigOverrides, maxConcurrentAgents: 2 }));
    markRunning(state, { taskId: "tasks/running", attempt: 1 });
    const events: string[] = [];
    const deps = createTickDeps({
      tasks: createMockTaskList({ tasks: [task] }),
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

  it("preserves the backend allTasks order for active candidates", async () => {
    const dispatched: string[] = [];
    const state = createState(createConfig({ ...loopConfigOverrides, maxConcurrentAgents: 10 }));
    const tasks = [
      createTask({
        qualifiedId: "tasks/no-priority",
        state: "planned",
        metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
      }),
      createTask({
        qualifiedId: "tasks/priority-two",
        state: "in-progress",
        metadata: { priority: 2, createdAt: "2026-01-01T00:00:00.000Z" }
      }),
      createTask({
        qualifiedId: "tasks/priority-one-b",
        state: "planned",
        metadata: { priority: 1, createdAt: "2026-01-02T00:00:00.000Z" }
      }),
      createTask({
        qualifiedId: "tasks/priority-one-a",
        state: "in-progress",
        metadata: { priority: 1, createdAt: "2026-01-01T00:00:00.000Z" }
      }),
      createTask({
        qualifiedId: "tasks/priority-one-c",
        state: "planned",
        metadata: { priority: 1, createdAt: "2026-01-02T00:00:00.000Z" }
      })
    ];

    await tick(
      state,
      createTickDeps({
        tasks: createMockTaskList({ tasks }),
        ensureWorkspace: async (_root, qualifiedId) => {
          dispatched.push(qualifiedId);
          return { path: `/repo/workspaces/${qualifiedId}`, createdNow: true };
        },
        runAttempt: async () => ({ reason: "abnormal", failure: "canceled" })
      })
    );

    expect(dispatched).toEqual([
      "tasks/no-priority",
      "tasks/priority-one-b",
      "tasks/priority-one-c",
      "tasks/priority-two",
      "tasks/priority-one-a"
    ]);
  });

  it("keeps reconciling but skips candidate fetch and dispatch when preflight fails", async () => {
    const state = createState(createConfig(loopConfigOverrides));
    markRunning(state, { taskId: "tasks/running", attempt: 1 });
    const tasks = createMockTaskList();
    const ensureWorkspace = vi.fn();
    const events: string[] = [];

    await tick(
      state,
      createTickDeps({
        tasks,
        validateDispatch: async () => ({ ok: false, code: "list_not_found", list: "tasks" }),
        reconcileRunning: async () => [{ taskId: "tasks/running", action: "update" }],
        ensureWorkspace,
        onEvent: (event) => events.push(event.type)
      })
    );

    expect(tasks.events.filter((event) => event.method === "allTasks")).toEqual([]);
    expect(ensureWorkspace).not.toHaveBeenCalled();
    expect(events).toEqual(["tick_started", "reconcile", "validation_failed"]);
  });

  it("dispatches only up to the available concurrency", async () => {
    const state = createState(createConfig({ ...loopConfigOverrides, maxConcurrentAgents: 3 }));
    markRunning(state, { taskId: "tasks/already-running", attempt: 1 });
    const dispatched: string[] = [];

    await tick(
      state,
      createTickDeps({
        tasks: createMockTaskList({
          tasks: [
            createTask({
              qualifiedId: "tasks/one",
              metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
            }),
            createTask({
              qualifiedId: "tasks/two",
              metadata: { createdAt: "2026-01-02T00:00:00.000Z" }
            }),
            createTask({
              qualifiedId: "tasks/three",
              metadata: { createdAt: "2026-01-03T00:00:00.000Z" }
            })
          ]
        }),
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

  it("stops dispatching between candidates when the tick abort signal fires", async () => {
    const state = createState(createConfig({ ...loopConfigOverrides, maxConcurrentAgents: 3 }));
    const abort = new AbortController();
    const dispatched: string[] = [];

    await tick(
      state,
      createTickDeps({
        tasks: createMockTaskList({
          tasks: [
            createTask({
              qualifiedId: "tasks/one",
              metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
            }),
            createTask({
              qualifiedId: "tasks/two",
              metadata: { createdAt: "2026-01-02T00:00:00.000Z" }
            }),
            createTask({
              qualifiedId: "tasks/three",
              metadata: { createdAt: "2026-01-03T00:00:00.000Z" }
            })
          ]
        }),
        abort: abort.signal,
        ensureWorkspace: async (_root, qualifiedId) => {
          dispatched.push(qualifiedId);
          abort.abort();
          return { path: `/repo/workspaces/${qualifiedId}`, createdNow: true };
        },
        runAttempt: pendingAttempt
      })
    );

    expect(dispatched).toEqual(["tasks/one"]);
    expect(state.running.has("tasks/one")).toBe(true);
    expect(state.running.has("tasks/two")).toBe(false);
    expect(state.running.has("tasks/three")).toBe(false);
    expect(state.claimed.has("tasks/two")).toBe(false);
    expect(state.claimed.has("tasks/three")).toBe(false);
  });

  it("does not dispatch a retry before it is due", async () => {
    const state = createState(createConfig(loopConfigOverrides));
    const task = createTask({
      qualifiedId: "tasks/retry",
      metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
    });
    scheduleRetry(state, { taskId: task.qualifiedId, attempt: 2, dueAt: 2_000 });
    const ensureWorkspace = vi.fn();

    await tick(
      state,
      createTickDeps({
        tasks: createMockTaskList({ tasks: [task] }),
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
    const state = createState(createConfig(loopConfigOverrides));
    const task = createTask({
      qualifiedId: "tasks/retry",
      metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
    });
    scheduleRetry(state, { taskId: task.qualifiedId, attempt: 3, dueAt: 2_000 });
    const attempts: number[] = [];

    await tick(
      state,
      createTickDeps({
        tasks: createMockTaskList({ tasks: [task] }),
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
    const state = createState(createConfig(loopConfigOverrides));
    const staleCandidate = createTask({
      qualifiedId: "tasks/refresh",
      metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
    });
    const currentTask = { ...staleCandidate, description: "first body" };
    const workerPromises: Promise<void>[] = [];

    const tasks = createMockTaskList({
      tasks: [staleCandidate],
      readers: {
        allTasks: (filter) => (staleCandidate.state === filter?.state ? [staleCandidate] : []),
        get: (qualifiedId) => {
          if (qualifiedId !== currentTask.qualifiedId) {
            throw new Error(`not found: ${qualifiedId}`);
          }

          return { ...currentTask };
        }
      }
    });
    const spawn = createMockSpawn({ codex: [{ kind: "exit", exitCode: 0 }] });

    await tick(
      state,
      createTickDeps({
        tasks,
        taskPromptTemplate: "{{ task.description }}",
        runAttempt: undefined,
        spawn: spawn.spawn,
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
      createTickDeps({
        tasks,
        taskPromptTemplate: "{{ task.description }}",
        runAttempt: undefined,
        spawn: spawn.spawn,
        trackWorker: (worker) => {
          workerPromises.push(worker.promise);
        },
        now: () => now
      })
    );
    await workerPromises.at(-1);

    expect(spawn.calls.map((call) => call.prompt)).toEqual(["Plan first body", "Plan second body"]);
  });

  it("schedules a backoff retry when workspace creation fails", async () => {
    const state = createState(createConfig(loopConfigOverrides));
    const task = createTask({
      qualifiedId: "tasks/workspace-fails",
      metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
    });
    const events: string[] = [];

    await tick(
      state,
      createTickDeps({
        tasks: createMockTaskList({ tasks: [task] }),
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
    const state = createState(createConfig(loopConfigOverrides));
    const task = createTask({
      qualifiedId: "tasks/success",
      metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
    });
    const events: string[] = [];

    await tick(
      state,
      createTickDeps({
        tasks: createMockTaskList({ tasks: [task] }),
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
      attempt: 1,
      dueAt: 6_000
    });
  });

  it("cleans up a retry-queued task that became terminal before retry dispatch", async () => {
    const state = createState(createConfig(loopConfigOverrides));
    const task = createTask({
      qualifiedId: "tasks/done",
      state: "done",
      metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
    });
    const removed: string[] = [];
    const events: string[] = [];
    scheduleRetry(state, { taskId: task.qualifiedId, attempt: 2, dueAt: 10_000 });

    await tick(
      state,
      createTickDeps({
        tasks: createMockTaskList({ tasks: [task] }),
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
    const state = createState(createConfig({ ...loopConfigOverrides, maxConcurrentAgents: 2 }));
    const duplicate = createTask({
      qualifiedId: "tasks/duplicate",
      metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
    });
    const dispatched: string[] = [];

    await tick(
      state,
      createTickDeps({
        tasks: createMockTaskList({
          tasks: [duplicate],
          readers: {
            allTasks: () => [duplicate]
          }
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

  it("dispatches pipeline tasks when the pipeline driver is registered", async () => {
    const task = createTask({
      qualifiedId: "tasks/pipeline",
      metadata: { kind: "pipeline", createdAt: "2026-01-01T00:00:00.000Z" }
    });
    const state = createState(createConfig(loopConfigOverrides));
    const dispatched: string[] = [];

    await tick(
      state,
      createTickDeps({
        tasks: createMockTaskList({ tasks: [task] }),
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
    const task = createTask({
      qualifiedId: "tasks/ralph",
      sourcePath: "/repo/tasks/ralph.md",
      metadata: { kind: "ralph", createdAt: "2026-01-01T00:00:00.000Z" }
    });
    const state = createState(createConfig(loopConfigOverrides));
    const ensureWorkspace = vi.fn();
    const events: Array<Parameters<NonNullable<TickDeps["onEvent"]>>[0]> = [];

    await tick(
      state,
      createTickDeps({
        tasks: createMockTaskList({ tasks: [task] }),
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
    const task = createTask({
      qualifiedId: "tasks/default-kind",
      metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
    });
    const state = createState(createConfig(loopConfigOverrides));
    const dispatched: string[] = [];

    await tick(
      state,
      createTickDeps({
        tasks: createMockTaskList({ tasks: [task] }),
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

  describe("state space", () => {
    it("emits only tick_started when the task list is empty", async () => {
      const state = createState(createConfig(loopConfigOverrides));
      const events = createLoopEventCollector();

      await tick(
        state,
        createTickDeps({
          tasks: createMockTaskList(),
          onEvent: events.onEvent
        })
      );

      expect(events.collector.snapshot()).toEqual([
        { type: "tick_started", at: "1970-01-01T00:00:00.000Z" }
      ]);
    });

    it("dispatches one candidate when capacity is one", async () => {
      const state = createState(createConfig(loopConfigOverrides));
      const events = createLoopEventCollector();
      const task = createTask({
        qualifiedId: "tasks/one",
        metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
      });

      await tick(
        state,
        createTickDeps({
          tasks: createMockTaskList({ tasks: [task] }),
          runAttempt: pendingAttempt,
          onEvent: events.onEvent
        })
      );
      await events.collector.waitFor(isDispatch("tasks/one"), { timeoutMs: 50 });

      expect(eventTypes(events.collector.snapshot())).toEqual(["tick_started", "dispatch"]);
      expect(state.running.has("tasks/one")).toBe(true);
    });

    it("keeps the second candidate waiting until the first releases on a later tick", async () => {
      const state = createState(createConfig(loopConfigOverrides));
      const events = createLoopEventCollector();
      const releaseFirst = deferred<{ reason: "abnormal"; failure: "canceled" }>();
      const first = createTask({
        qualifiedId: "tasks/one",
        metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
      });
      const second = createTask({
        qualifiedId: "tasks/two",
        metadata: { createdAt: "2026-01-02T00:00:00.000Z" }
      });
      const tasks = createMockTaskList({ tasks: [first, second] });
      const workers: Promise<void>[] = [];

      await tick(
        state,
        createTickDeps({
          tasks,
          runAttempt: async ({ task }) => {
            if (task.qualifiedId === first.qualifiedId) {
              return releaseFirst.promise;
            }

            return new Promise(() => undefined);
          },
          trackWorker: (worker) => workers.push(worker.promise),
          onEvent: events.onEvent
        })
      );
      await events.collector.waitFor(isDispatch(first.qualifiedId), { timeoutMs: 50 });
      expect(
        events.collector
          .snapshot()
          .filter(isDispatchEvent)
          .map((event) => event.task_id)
      ).toEqual([first.qualifiedId]);

      tasks.mutate((store) => {
        store.set({ ...store.get(first.qualifiedId), state: "done" });
      });
      releaseFirst.resolve({ reason: "abnormal", failure: "canceled" });
      await workers.at(-1);

      await tick(
        state,
        createTickDeps({
          tasks,
          runAttempt: pendingAttempt,
          onEvent: events.onEvent
        })
      );
      await events.collector.waitFor(isDispatch(second.qualifiedId), { timeoutMs: 50 });

      expect(
        events.collector
          .snapshot()
          .filter(isDispatchEvent)
          .map((event) => event.task_id)
      ).toEqual([first.qualifiedId, second.qualifiedId]);
    });

    it("dispatches two candidates in the same tick when capacity is two", async () => {
      const state = createState(createConfig({ ...loopConfigOverrides, maxConcurrentAgents: 2 }));
      const events = createLoopEventCollector();
      const tasks = [
        createTask({
          qualifiedId: "tasks/one",
          metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
        }),
        createTask({
          qualifiedId: "tasks/two",
          metadata: { createdAt: "2026-01-02T00:00:00.000Z" }
        })
      ];

      await tick(
        state,
        createTickDeps({
          tasks: createMockTaskList({ tasks }),
          runAttempt: pendingAttempt,
          onEvent: events.onEvent
        })
      );
      await events.collector.waitFor(isDispatch("tasks/two"), { timeoutMs: 50 });

      expect(
        events.collector
          .snapshot()
          .filter(isDispatchEvent)
          .map((event) => event.task_id)
      ).toEqual(["tasks/one", "tasks/two"]);
    });

    it("does not claim past the capacity limit reached mid-tick", async () => {
      const state = createState(createConfig({ ...loopConfigOverrides, maxConcurrentAgents: 2 }));
      const events = createLoopEventCollector();

      await tick(
        state,
        createTickDeps({
          tasks: createMockTaskList({
            tasks: [
              createTask({
                qualifiedId: "tasks/one",
                metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
              }),
              createTask({
                qualifiedId: "tasks/two",
                metadata: { createdAt: "2026-01-02T00:00:00.000Z" }
              }),
              createTask({
                qualifiedId: "tasks/three",
                metadata: { createdAt: "2026-01-03T00:00:00.000Z" }
              })
            ]
          }),
          runAttempt: pendingAttempt,
          onEvent: events.onEvent
        })
      );
      await events.collector.waitFor(isDispatch("tasks/two"), { timeoutMs: 50 });

      expect(
        events.collector
          .snapshot()
          .filter(isDispatchEvent)
          .map((event) => event.task_id)
      ).toEqual(["tasks/one", "tasks/two"]);
      expect(state.claimed.has("tasks/three")).toBe(false);
      expect(state.running.has("tasks/three")).toBe(false);
    });

    it("skips a candidate already present in claimed state without re-claiming it", async () => {
      const state = createState(createConfig(loopConfigOverrides));
      const events = createLoopEventCollector();
      state.claimed.add("tasks/claimed");

      await tick(
        state,
        createTickDeps({
          tasks: createMockTaskList({
            tasks: [
              createTask({
                qualifiedId: "tasks/claimed",
                metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
              })
            ]
          }),
          onEvent: events.onEvent
        })
      );

      expect(events.collector.snapshot()).toEqual([
        { type: "tick_started", at: "1970-01-01T00:00:00.000Z" }
      ]);
      expect(state.claimed.has("tasks/claimed")).toBe(true);
      expect(state.running.has("tasks/claimed")).toBe(false);
    });

    it("emits task_skipped and does not claim an unsupported kind", async () => {
      const state = createState(createConfig(loopConfigOverrides));
      const events = createLoopEventCollector();

      await tick(
        state,
        createTickDeps({
          tasks: createMockTaskList({
            tasks: [
              createTask({
                qualifiedId: "tasks/unsupported",
                sourcePath: "/repo/tasks/unsupported.md",
                metadata: { kind: "unknown", createdAt: "2026-01-01T00:00:00.000Z" }
              })
            ]
          }),
          onEvent: events.onEvent
        })
      );

      expect(events.collector.snapshot()).toEqual([
        { type: "tick_started", at: "1970-01-01T00:00:00.000Z" },
        {
          type: "task_skipped",
          task_id: "tasks/unsupported",
          reason: "unsupported_kind",
          kind: "unknown"
        }
      ]);
      expect(state.claimed.has("tasks/unsupported")).toBe(false);
      expect(state.running.has("tasks/unsupported")).toBe(false);
    });

    it("backs off after workspace creation fails and dispatches only after the retry is due", async () => {
      let now = 5_000;
      const state = createState(createConfig(loopConfigOverrides));
      const events = createLoopEventCollector(() => now);
      const task = createTask({
        qualifiedId: "tasks/workspace",
        metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
      });
      const ensureWorkspace = vi
        .fn()
        .mockRejectedValueOnce(new Error("disk full"))
        .mockResolvedValue({ path: "/repo/workspaces/tasks_workspace", createdNow: true });

      await tick(
        state,
        createTickDeps({
          tasks: createMockTaskList({ tasks: [task] }),
          ensureWorkspace,
          runAttempt: pendingAttempt,
          now: () => now,
          onEvent: events.onEvent
        })
      );
      await events.collector.waitFor(isRetryScheduled(task.qualifiedId), { timeoutMs: 50 });

      now = 14_999;
      await tick(
        state,
        createTickDeps({
          tasks: createMockTaskList({ tasks: [task] }),
          ensureWorkspace,
          now: () => now,
          onEvent: events.onEvent
        })
      );

      expect(events.collector.snapshot().filter(isDispatchEvent)).toEqual([]);

      now = 15_000;
      await tick(
        state,
        createTickDeps({
          tasks: createMockTaskList({ tasks: [task] }),
          ensureWorkspace,
          runAttempt: pendingAttempt,
          now: () => now,
          onEvent: events.onEvent
        })
      );
      await events.collector.waitFor(isDispatch(task.qualifiedId), { timeoutMs: 50 });

      expect(ensureWorkspace).toHaveBeenCalledTimes(2);
      expect(
        events.collector.snapshot().filter((event) => event.type === "retry_scheduled")
      ).toEqual([
        { type: "retry_scheduled", task_id: task.qualifiedId, attempt: 2, due_in_ms: 10_000 }
      ]);
    });

    it("cancels a queued retry when the task becomes terminal before it is due", async () => {
      const state = createState(createConfig(loopConfigOverrides));
      const events = createLoopEventCollector();
      const task = createTask({
        qualifiedId: "tasks/done",
        state: "done",
        metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
      });
      scheduleRetry(state, { taskId: task.qualifiedId, attempt: 2, dueAt: 10_000 });

      await tick(
        state,
        createTickDeps({
          tasks: createMockTaskList({ tasks: [task] }),
          onEvent: events.onEvent,
          now: () => 5_000
        })
      );

      expect(events.collector.snapshot()).toEqual([
        { type: "tick_started", at: "1970-01-01T00:00:00.000Z" },
        { type: "reconcile", task_id: task.qualifiedId, action: "stop_clean" }
      ]);
      expect(state.retry_attempts.has(task.qualifiedId)).toBe(false);
      expect(state.completed.has(task.qualifiedId)).toBe(true);
    });

    it("emits validation_failed and dispatches nothing when startup validation fails", async () => {
      const state = createState(createConfig(loopConfigOverrides));
      const events = createLoopEventCollector();
      const ensureWorkspace = vi.fn();

      await tick(
        state,
        createTickDeps({
          tasks: createMockTaskList({
            tasks: [
              createTask({
                qualifiedId: "tasks/blocked",
                metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
              })
            ]
          }),
          validateDispatch: async () => ({ ok: false, code: "list_not_found", list: "tasks" }),
          ensureWorkspace,
          onEvent: events.onEvent
        })
      );

      expect(events.collector.snapshot()).toEqual([
        { type: "tick_started", at: "1970-01-01T00:00:00.000Z" },
        { type: "validation_failed", reason: "list_not_found" }
      ]);
      expect(ensureWorkspace).not.toHaveBeenCalled();
    });

    it("releases state and removes the workspace when a successful worker leaves the task terminal", async () => {
      const state = createState(createConfig(loopConfigOverrides));
      const events = createLoopEventCollector();
      const removed: string[] = [];
      const task = createTask({
        qualifiedId: "tasks/success",
        metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
      });
      const tasks = createMockTaskList({ tasks: [task] });
      const workers: Promise<void>[] = [];

      await tick(
        state,
        createTickDeps({
          tasks,
          runAttempt: async () => {
            tasks.mutate((store) => {
              store.set({ ...store.get(task.qualifiedId), state: "done" });
            });
            return { reason: "normal" };
          },
          removeWorkspace: async (_root, qualifiedId) => {
            removed.push(qualifiedId);
          },
          trackWorker: (worker) => workers.push(worker.promise),
          onEvent: events.onEvent
        })
      );
      await workers.at(-1);

      expect(events.collector.snapshot()).toEqual([
        { type: "tick_started", at: "1970-01-01T00:00:00.000Z" },
        {
          type: "dispatch",
          task_id: task.qualifiedId,
          qualified_id: task.qualifiedId,
          workspace: "/__memfs__/workspaces/tasks_success"
        },
        { type: "worker_exit", task_id: task.qualifiedId, reason: "normal" },
        { type: "reconcile", task_id: task.qualifiedId, action: "stop_clean" }
      ]);
      expect(state.running.has(task.qualifiedId)).toBe(false);
      expect(state.claimed.has(task.qualifiedId)).toBe(false);
      expect(removed).toEqual([task.qualifiedId]);
    });

    it("logs and completes terminal cleanup when a successful worker cleanup fails", async () => {
      const state = createState(createConfig(loopConfigOverrides));
      const events = createLoopEventCollector();
      const logger = { warn: vi.fn() };
      const task = createTask({
        qualifiedId: "tasks/cleanup-fails",
        metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
      });
      const tasks = createMockTaskList({ tasks: [task] });
      const workers: Promise<void>[] = [];

      await tick(
        state,
        createTickDeps({
          tasks,
          runAttempt: async () => {
            tasks.mutate((store) => {
              store.set({ ...store.get(task.qualifiedId), state: "done" });
            });
            return { reason: "normal" };
          },
          removeWorkspace: async () => {
            throw new Error("rm failed");
          },
          logger,
          trackWorker: (worker) => workers.push(worker.promise),
          onEvent: events.onEvent
        })
      );

      await expect(workers[0]).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith("maestro workspace cleanup failed", {
        taskId: task.qualifiedId,
        error: "rm failed"
      });
      expect(events.collector.snapshot()).toEqual([
        { type: "tick_started", at: "1970-01-01T00:00:00.000Z" },
        {
          type: "dispatch",
          task_id: task.qualifiedId,
          qualified_id: task.qualifiedId,
          workspace: "/__memfs__/workspaces/tasks_cleanup-fails"
        },
        { type: "worker_exit", task_id: task.qualifiedId, reason: "normal" },
        { type: "reconcile", task_id: task.qualifiedId, action: "stop_clean" }
      ]);
      expect(state.running.has(task.qualifiedId)).toBe(false);
      expect(state.claimed.has(task.qualifiedId)).toBe(false);
      expect(state.completed.has(task.qualifiedId)).toBe(true);
    });

    it("logs and completes terminal cleanup when retry-queue cleanup fails", async () => {
      const state = createState(createConfig(loopConfigOverrides));
      const events = createLoopEventCollector();
      const logger = { warn: vi.fn() };
      const task = createTask({
        qualifiedId: "tasks/retry-done",
        state: "done",
        metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
      });
      scheduleRetry(state, { taskId: task.qualifiedId, attempt: 2, dueAt: 10_000 });

      await expect(
        tick(
          state,
          createTickDeps({
            tasks: createMockTaskList({ tasks: [task] }),
            removeWorkspace: async () => {
              throw new Error("rm failed");
            },
            logger,
            onEvent: events.onEvent,
            now: () => 5_000
          })
        )
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith("maestro workspace cleanup failed", {
        taskId: task.qualifiedId,
        error: "rm failed"
      });
      expect(events.collector.snapshot()).toEqual([
        { type: "tick_started", at: "1970-01-01T00:00:00.000Z" },
        { type: "reconcile", task_id: task.qualifiedId, action: "stop_clean" }
      ]);
      expect(state.retry_attempts.has(task.qualifiedId)).toBe(false);
      expect(state.completed.has(task.qualifiedId)).toBe(true);
    });

    it("schedules retryable worker failures with monotonically growing due_in_ms", async () => {
      let now = 1_000;
      const state = createState(createConfig(loopConfigOverrides));
      const events = createLoopEventCollector(() => now);
      const task = createTask({
        qualifiedId: "tasks/retryable",
        metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
      });
      const workers: Promise<void>[] = [];

      await tick(
        state,
        createTickDeps({
          tasks: createMockTaskList({ tasks: [task] }),
          runAttempt: async () => ({ reason: "abnormal", failure: "step_failed" }),
          trackWorker: (worker) => workers.push(worker.promise),
          now: () => now,
          onEvent: events.onEvent
        })
      );
      await workers.at(-1);

      now = 11_000;
      await tick(
        state,
        createTickDeps({
          tasks: createMockTaskList({ tasks: [task] }),
          runAttempt: async () => ({ reason: "abnormal", failure: "step_failed" }),
          trackWorker: (worker) => workers.push(worker.promise),
          now: () => now,
          onEvent: events.onEvent
        })
      );
      await workers.at(-1);

      const retries = events.collector
        .snapshot()
        .filter(
          (event): event is Extract<MaestroEvent, { type: "retry_scheduled" }> =>
            event.type === "retry_scheduled"
        );
      expect(
        events.collector
          .snapshot()
          .filter(isWorkerExitEvent)
          .map((event) => event.reason)
      ).toEqual(["abnormal", "abnormal"]);
      expect(retries.map((event) => event.due_in_ms)).toEqual([10_000, 20_000]);
      expect(retries[1].due_in_ms).toBeGreaterThan(retries[0].due_in_ms);
    });

    it("releases state without retry for a non-retryable canceled worker failure", async () => {
      const state = createState(createConfig(loopConfigOverrides));
      const events = createLoopEventCollector();
      const task = createTask({
        qualifiedId: "tasks/canceled",
        metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
      });
      const workers: Promise<void>[] = [];

      await tick(
        state,
        createTickDeps({
          tasks: createMockTaskList({ tasks: [task] }),
          runAttempt: async () => ({ reason: "abnormal", failure: "canceled" }),
          trackWorker: (worker) => workers.push(worker.promise),
          onEvent: events.onEvent
        })
      );
      await workers.at(-1);

      expect(
        events.collector.snapshot().filter((event) => event.type === "retry_scheduled")
      ).toEqual([]);
      expect(events.collector.snapshot().filter(isWorkerExitEvent)).toEqual([
        { type: "worker_exit", task_id: task.qualifiedId, reason: "abnormal", failure: "canceled" }
      ]);
      expect(state.running.has(task.qualifiedId)).toBe(false);
      expect(state.claimed.has(task.qualifiedId)).toBe(false);
    });

    it("releases state and logs when a worker rejects outside the driver contract", async () => {
      const state = createState(createConfig(loopConfigOverrides));
      const events = createLoopEventCollector();
      const logger = { error: vi.fn() };
      const task = createTask({
        qualifiedId: "tasks/rejects",
        metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
      });
      const workers: Promise<void>[] = [];

      await tick(
        state,
        createTickDeps({
          tasks: createMockTaskList({ tasks: [task] }),
          runAttempt: async () => {
            throw new Error("driver exploded");
          },
          logger,
          trackWorker: (worker) => workers.push(worker.promise),
          onEvent: events.onEvent
        })
      );
      await workers.at(-1);

      expect(logger.error).toHaveBeenCalledWith("maestro worker rejected", {
        taskId: task.qualifiedId,
        attempt: 1,
        error: "driver exploded"
      });
      expect(events.collector.snapshot().filter(isWorkerExitEvent)).toEqual([
        {
          type: "worker_exit",
          task_id: task.qualifiedId,
          reason: "abnormal",
          failure: "agent_crashed",
          error: "driver exploded"
        }
      ]);
      expect(
        events.collector.snapshot().filter((event) => event.type === "retry_scheduled")
      ).toEqual([
        { type: "retry_scheduled", task_id: task.qualifiedId, attempt: 2, due_in_ms: 10_000 }
      ]);
      expect(state.running.has(task.qualifiedId)).toBe(false);
      expect(state.claimed.has(task.qualifiedId)).toBe(false);
      expect(state.retry_attempts.get(task.qualifiedId)).toEqual({
        taskId: task.qualifiedId,
        attempt: 2,
        dueAt: 10_000
      });
    });

    it("invokes injected reconcileRunning once per tick and forwards its events", async () => {
      const state = createState(createConfig(loopConfigOverrides));
      const events = createLoopEventCollector();
      const reconcileRunning = vi.fn(async () => [
        { taskId: "tasks/running", action: "update" as const }
      ]);

      await tick(
        state,
        createTickDeps({
          reconcileRunning,
          onEvent: events.onEvent
        })
      );

      expect(reconcileRunning).toHaveBeenCalledTimes(1);
      expect(events.collector.snapshot()).toEqual([
        { type: "tick_started", at: "1970-01-01T00:00:00.000Z" },
        { type: "reconcile", task_id: "tasks/running", action: "update" }
      ]);
    });
  });
});

async function waitForWorkers(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

function createLoopEventCollector(now: () => number = () => 0): {
  collector: ReturnType<typeof createEventCollector>;
  onEvent: NonNullable<TickDeps["onEvent"]>;
} {
  const collector = createEventCollector();

  return {
    collector,
    onEvent(event) {
      const mapped = mapTickEvent(event, now());
      if (mapped !== undefined) {
        collector.onEvent(mapped);
      }
    }
  };
}

function mapTickEvent(event: TickEvent, now: number): MaestroEvent | undefined {
  switch (event.type) {
    case "tick_started":
      return { type: "tick_started", at: "1970-01-01T00:00:00.000Z" };
    case "task_skipped":
      return event;
    case "dispatch":
      return {
        type: "dispatch",
        task_id: event.task_id,
        qualified_id: event.task_id,
        workspace: event.workspace
      };
    case "attempt_phase":
      return event;
    case "agent_event":
      return event;
    case "unconfigured_state":
      return event;
    case "worker_exit":
      return withoutUndefined({
        type: "worker_exit",
        task_id: event.task_id,
        reason: event.outcome.reason,
        skipReason: event.outcome.skipReason,
        failure: event.outcome.failure,
        failedStep: event.outcome.failedStep,
        error: event.outcome.error
      });
    case "reconcile":
      if (event.action === "refresh_failed") {
        return undefined;
      }
      return { type: "reconcile", task_id: event.task_id, action: event.action };
    case "retry_scheduled":
      return {
        type: "retry_scheduled",
        task_id: event.task_id,
        attempt: event.attempt,
        due_in_ms: Math.max(0, event.due_at - now)
      };
    case "validation_failed":
      return { type: "validation_failed", reason: event.result.code };
  }
}

function eventTypes(events: readonly MaestroEvent[]): string[] {
  return events.map((event) => event.type);
}

function isDispatch(taskId: string): (event: MaestroEvent) => boolean {
  return (event) => event.type === "dispatch" && event.task_id === taskId;
}

function isRetryScheduled(taskId: string): (event: MaestroEvent) => boolean {
  return (event) => event.type === "retry_scheduled" && event.task_id === taskId;
}

function isDispatchEvent(
  event: MaestroEvent
): event is Extract<MaestroEvent, { type: "dispatch" }> {
  return event.type === "dispatch";
}

function isWorkerExitEvent(
  event: MaestroEvent
): event is Extract<MaestroEvent, { type: "worker_exit" }> {
  return event.type === "worker_exit";
}

function pendingAttempt(): Promise<never> {
  return new Promise(() => undefined);
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

function withoutUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}
