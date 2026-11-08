import type { Task } from "@poe-code/task-list";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AttemptOutcome } from "./agent/runner.js";
import { maestroTaskStateMachine } from "./state-machine.js";
import {
  assertEventually,
  assertNoLeakedWorkers,
  createConfig,
  createMockSpawn,
  createMockTaskList,
  createTask,
  type MockTaskList
} from "./__test_utils__/index.js";
import { tick, type TickDeps, type TickEvent, type TrackedWorker } from "./runtime/loop.js";
import { reconcileRunning } from "./runtime/reconcile.js";
import { createState } from "./runtime/state.js";
import "./drivers/index.js";

describe("agent maestro integration stress harness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs 50 one-attempt tasks at capacity five and preserves allTasks dispatch order", async () => {
    await expectUnder500ms(async () => {
      const ids = descendingTaskIds(50);
      const harness = createStressHarness({
        tasks: ids.map((id) => stressTask(id)),
        capacity: 5,
        runAttempt: ({ complete }) => complete()
      });
      const expectedOrder = (await harness.taskList.allTasks({ state: "queued" })).map(
        (task) => task.qualifiedId
      );

      const ticks = await harness.runUntilAllDone({ ticks: 10 });

      expect(ticks).toBe(10);
      await expect(harness.doneTaskIds()).resolves.toHaveLength(50);
      expect(harness.dispatchTaskIds()).toEqual(expectedOrder);
      harness.assertNoLeaks();
    });
  });

  it("retries 50 retryable first-attempt failures and completes after the expected ticks", async () => {
    await expectUnder500ms(async () => {
      const harness = createStressHarness({
        tasks: ascendingTaskIds(50).map((id) => stressTask(id)),
        capacity: 5,
        runAttempt: ({ attempt, complete }) => (attempt === 1 ? failed("step_failed") : complete())
      });

      const ticks = await harness.runUntilAllDone({ ticks: 20 });

      expect(ticks).toBe(20);
      await expect(harness.doneTaskIds()).resolves.toHaveLength(50);
      expect(harness.retryCount()).toBe(50);
      expect(harness.attemptCount()).toBe(100);
      harness.assertNoLeaks();
    });
  });

  it("records timeout, crash, failure, and success attempts for 20 tasks", async () => {
    await expectUnder500ms(async () => {
      const failures = ["step_timeout", "agent_crashed", "step_failed"] as const;
      const harness = createStressHarness({
        tasks: ascendingTaskIds(20).map((id) => stressTask(id)),
        capacity: 20,
        runAttempt: ({ attempt, complete }) => {
          const failure = failures[attempt - 1];
          return failure === undefined ? complete() : failed(failure);
        }
      });

      const ticks = await harness.runUntilAllDone({ ticks: 4 });

      expect(ticks).toBe(4);
      await expect(harness.doneTaskIds()).resolves.toHaveLength(20);
      expect([...harness.attemptRecords.values()]).toEqual(
        Array.from({ length: 20 }, () => ["step_timeout", "agent_crashed", "step_failed", "done"])
      );
      harness.assertNoLeaks();
    });
  });

  it("picks up tasks injected between ticks on the next tick", async () => {
    await expectUnder500ms(async () => {
      const harness = createStressHarness({
        tasks: ascendingTaskIds(10).map((id) => stressTask(id)),
        capacity: 15,
        runAttempt: ({ block }) => block()
      });

      await harness.tickOnce({ drainWorkers: false });
      expect(harness.state.running.size).toBe(10);

      const injected = ascendingTaskIds(5, "injected").map((id) => stressTask(id));
      harness.taskList.mutate((store) => {
        for (const task of injected) {
          store.set(task);
        }
      });

      await harness.tickOnce({ drainWorkers: false });

      expect(harness.dispatchTaskIds().slice(-5)).toEqual(injected.map((task) => task.qualifiedId));
      expect(harness.state.running.size).toBe(15);

      await harness.completeBlockedAttempts();
      harness.assertNoLeaks();
      await expect(harness.doneTaskIds()).resolves.toHaveLength(15);
    });
  });

  it("stops a running worker when its task is deleted mid-run", async () => {
    await expectUnder500ms(async () => {
      const harness = createStressHarness({
        tasks: [stressTask("delete-me")],
        capacity: 1,
        runAttempt: ({ block }) => block()
      });

      await harness.tickOnce({ drainWorkers: false });
      expect(harness.state.running.has("tasks/delete-me")).toBe(true);

      harness.taskList.mutate((store) => {
        store.delete("tasks/delete-me");
      });
      await harness.tickOnce();

      expect(harness.state.completed.has("tasks/delete-me")).toBe(true);
      harness.assertNoLeaks();
    });
  });

  it("drains seeded random spawn, refresh, and workspace faults without leaks", async () => {
    await expectUnder500ms(async () => {
      const spawnRng = seededRandom(0x5eed);
      const refreshRng = seededRandom(0xf00d);
      const workspaceRng = seededRandom(0xcafe);
      const mockSpawn = createMockSpawn(() =>
        spawnRng() < 0.2
          ? [{ kind: "throw", error: "agent_startup_error" }]
          : [{ kind: "exit", exitCode: 0 }]
      );
      const harness = createStressHarness({
        tasks: ascendingTaskIds(60).map((id) => stressTask(id)),
        capacity: 10,
        taskListGet: async (taskList, qualifiedId) => {
          if (refreshRng() < 0.05) {
            throw new Error("seeded refresh fault");
          }
          return taskList.refresh(qualifiedId);
        },
        ensureWorkspace: async (_root, qualifiedId) => {
          if (workspaceRng() < 0.01) {
            throw new Error(`seeded workspace fault: ${qualifiedId}`);
          }
          return {
            path: `/__memfs__/workspaces/${qualifiedId.replaceAll("/", "_")}`,
            createdNow: true
          };
        },
        runAttempt: async ({ task, complete }) => {
          try {
            await mockSpawn.spawn("codex", { prompt: task.qualifiedId });
          } catch {
            return failed("agent_startup_error");
          }

          return complete();
        }
      });

      await harness.runUntil(
        async () =>
          (await harness.doneTaskIds()).length === 60 &&
          harness.state.retry_attempts.size === 0 &&
          harness.state.running.size === 0,
        { ticks: 300 }
      );

      await expect(harness.doneTaskIds()).resolves.toHaveLength(60);
      expect(mockSpawn.calls.length).toBeGreaterThanOrEqual(60);
      expect(harness.state.retry_attempts.size).toBe(0);
      harness.assertNoLeaks();
    });
  });
});

type Failure = NonNullable<AttemptOutcome["failure"]>;
type HarnessRunAttemptContext = {
  task: Task;
  attempt: number;
  complete(): Promise<AttemptOutcome>;
  block(): Promise<AttemptOutcome>;
};

type HarnessRunAttempt = (
  ctx: HarnessRunAttemptContext
) => AttemptOutcome | Promise<AttemptOutcome>;

interface StressHarnessOptions {
  tasks: readonly Task[];
  capacity: number;
  runAttempt: HarnessRunAttempt;
  taskListGet?: (taskList: MockTaskList, qualifiedId: string) => Promise<Task>;
  ensureWorkspace?: NonNullable<TickDeps["ensureWorkspace"]>;
}

interface TickOnceOptions {
  drainWorkers?: boolean;
}

function createStressHarness(options: StressHarnessOptions) {
  const taskList = createMockTaskList({
    tasks: options.tasks,
    lists: ["tasks"],
    stateMachine: maestroTaskStateMachine,
    readers: {
      get: (qualifiedId, store) =>
        options.taskListGet?.(taskList, qualifiedId) ?? store.get(qualifiedId)
    }
  });
  const cfg = createConfig({
    states: {
      queued: { prompt: "Run {{ prompt }}" },
      "agent-running": { prompt: "Continue {{ prompt }}" },
      done: { terminal: true },
      failed: { terminal: true }
    },
    activeStateNames: ["queued", "agent-running"],
    terminalStateNames: ["done", "failed"],
    stateOrder: ["queued", "agent-running", "done", "failed"],
    agent: { maxConcurrentAgents: options.capacity, maxRetryBackoffMs: 10_000 }
  });
  const state = createState(cfg);
  const events: TickEvent[] = [];
  const workers = new Map<string, TrackedWorker>();
  const attemptRecords = new Map<string, string[]>();
  const blocked = new Map<string, () => void>();

  const completeTask = async (task: Task): Promise<AttemptOutcome> => {
    await taskList.list(task.list).fire(task.id, "complete");
    return { reason: "normal" };
  };

  const runAttempt: NonNullable<TickDeps["runAttempt"]> = async ({ task, attempt, abort }) => {
    const outcome = await options.runAttempt({
      task,
      attempt: attempt ?? 1,
      complete: () => completeTask(task),
      block: () =>
        new Promise<AttemptOutcome>((resolve) => {
          let settled = false;
          const finish = (outcome: AttemptOutcome): void => {
            if (settled) {
              return;
            }
            settled = true;
            blocked.delete(task.qualifiedId);
            resolve(outcome);
          };

          blocked.set(task.qualifiedId, () => {
            void completeTask(task).then(finish);
          });
          abort.addEventListener(
            "abort",
            () => finish({ reason: "abnormal", failure: "canceled" }),
            { once: true }
          );
        })
    });
    recordAttempt(attemptRecords, task.qualifiedId, outcome);
    return outcome;
  };

  const trackWorker = (worker: TrackedWorker): void => {
    workers.set(worker.taskId, worker);
    worker.promise.then(
      () => workers.delete(worker.taskId),
      () => workers.delete(worker.taskId)
    );
  };

  const tickOnce = async (tickOptions: TickOnceOptions = {}): Promise<void> => {
    await tick(state, {
      tasks: taskList,
      validateDispatch: async () => ({ ok: true }),
      ensureWorkspace:
        options.ensureWorkspace ??
        (async (_root, qualifiedId) => ({
          path: `/__memfs__/workspaces/${qualifiedId.replaceAll("/", "_")}`,
          createdNow: true
        })),
      removeWorkspace: async () => undefined,
      runAttempt,
      now: () => Date.now(),
      onEvent: (event) => events.push(event),
      trackWorker,
      reconcileRunning: (currentState) =>
        reconcileRunning(currentState, {
          tasks: taskList,
          stopWorker: (entry) => workers.get(entry.taskId)?.controller.abort(),
          removeWorkspace: async () => undefined
        })
    });

    await flushMicrotasks();

    if (tickOptions.drainWorkers !== false) {
      await drainWorkers(workers);
    }
  };

  return {
    taskList,
    state,
    events,
    attemptRecords,
    tickOnce,
    runUntil: (
      predicate: () => boolean | Promise<boolean>,
      options: { ticks: number; advanceMs?: number }
    ) =>
      assertEventually(predicate, {
        ...options,
        advanceMs: options.advanceMs ?? 10_000,
        tick: tickOnce
      }),
    runUntilAllDone: (runOptions: { ticks: number; advanceMs?: number }) =>
      assertEventually(async () => (await doneTaskIds(taskList)).length === options.tasks.length, {
        ...runOptions,
        advanceMs: runOptions.advanceMs ?? 10_000,
        tick: tickOnce
      }),
    dispatchTaskIds: () =>
      events.filter((event) => event.type === "dispatch").map((event) => event.task_id),
    doneTaskIds: () => doneTaskIds(taskList),
    retryCount: () => events.filter((event) => event.type === "retry_scheduled").length,
    attemptCount: () =>
      [...attemptRecords.values()].reduce((sum, records) => sum + records.length, 0),
    completeBlockedAttempts: async () => {
      for (const complete of [...blocked.values()]) {
        complete();
      }
      await drainWorkers(workers);
    },
    assertNoLeaks: () => {
      assertNoLeakedWorkers(state, workers);
      expect(state.retry_attempts.size).toBe(0);
    }
  };
}

function failed(failure: Failure): AttemptOutcome {
  return { reason: "abnormal", failure };
}

function stressTask(id: string): Task {
  return createTask({
    qualifiedId: `tasks/${id}`,
    state: "queued",
    name: id,
    description: `Stress task ${id}`,
    metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
  });
}

function ascendingTaskIds(count: number, prefix = "task"): string[] {
  return Array.from({ length: count }, (_value, index) => `${prefix}-${pad(index)}`);
}

function descendingTaskIds(count: number): string[] {
  return ascendingTaskIds(count).reverse();
}

function pad(value: number): string {
  return String(value).padStart(3, "0");
}

async function drainWorkers(workers: Map<string, TrackedWorker>): Promise<void> {
  while (workers.size > 0) {
    await Promise.allSettled([...workers.values()].map((worker) => worker.promise));
    await flushMicrotasks();
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

async function doneTaskIds(taskList: MockTaskList): Promise<string[]> {
  return (await taskList.allTasks({ state: "done" })).map((task) => task.qualifiedId);
}

function recordAttempt(
  attemptRecords: Map<string, string[]>,
  taskId: string,
  outcome: AttemptOutcome
): void {
  const records = attemptRecords.get(taskId) ?? [];
  records.push(outcome.reason === "normal" ? "done" : (outcome.failure ?? "unknown"));
  attemptRecords.set(taskId, records);
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296;
  };
}

async function expectUnder500ms(run: () => Promise<void>): Promise<void> {
  const started = vi.getRealSystemTime();
  await run();
  const elapsedMs = vi.getRealSystemTime() - started;
  expect(elapsedMs).toBeLessThan(500);
}
