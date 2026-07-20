import type { SpawnMode } from "@poe-code/agent-spawn";
import { beforeAll, describe, expect, it } from "vitest";

import { createMockSpawn } from "../__test_utils__/mock-spawn.js";
import { createMockTaskList } from "../__test_utils__/mock-task-list.js";
import {
  createConfig,
  createDriverContext,
  createTickDeps,
  createTask
} from "../__test_utils__/fixtures.js";
import type { AttemptEvent, AttemptOutcome } from "../agent/runner.js";
import { tick, type TickEvent } from "../runtime/loop.js";
import type { AttemptPhase } from "../runtime/phases.js";
import { createState } from "../runtime/state.js";
import { registerDriver } from "./registry.js";
import { pipelineDriver } from "./pipeline.js";

describe("pipelineDriver", () => {
  beforeAll(() => {
    registerDriver(pipelineDriver);
  });

  it("falls back to the workflow agent service and agent runner default model", async () => {
    const mockSpawn = createMockSpawn(successScript());
    const events: AttemptEvent[] = [];
    const ctx = createDriverContext({
      events,
      spawn: mockSpawn.spawn,
      cfg: createConfig({
        agent: { service: "workflow-agent" },
        states: {
          planned: { prompt: "Plan {{ task.id }}" },
          done: { terminal: true }
        }
      })
    });

    const outcome = await pipelineDriver.run(ctx);

    expect(outcome).toEqual({ reason: "normal" });
    expect(mockSpawn.calls).toEqual([
      {
        agent: "workflow-agent",
        prompt: "Plan task-1",
        model: undefined,
        cwd: undefined,
        signal: ctx.abort
      }
    ]);
    expect(events).toEqual(successEvents("planned", "thread-1"));
  });

  it("dispatches with state agent and model overrides over the workflow defaults", async () => {
    const mockSpawn = createMockSpawn(successScript());
    const events: AttemptEvent[] = [];
    const ctx = createDriverContext({
      events,
      task: createTask({ state: "implementation" }),
      spawn: mockSpawn.spawn,
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

    const outcome = await pipelineDriver.run(ctx);

    expect(outcome).toEqual({ reason: "normal" });
    expect(mockSpawn.calls).toEqual([
      {
        agent: "claude",
        prompt: "Implement task-1",
        model: "claude-sonnet-4-6",
        cwd: undefined,
        signal: ctx.abort
      }
    ]);
    expect(events).toEqual(successEvents("implementation", "thread-1"));
  });

  it("cancels before refresh when the attempt signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const mockSpawn = createMockSpawn(successScript());
    const events: AttemptEvent[] = [];
    const ctx = createDriverContext({
      events,
      abort: controller.signal,
      spawn: mockSpawn.spawn,
      refreshTask: async () => {
        throw new Error("refresh should not run");
      }
    });

    const outcome = await pipelineDriver.run(ctx);

    expect(outcome).toEqual({ reason: "abnormal", failure: "canceled" });
    expect(mockSpawn.calls).toEqual([]);
    expect(events).toEqual([
      phase(null, "preparing-workspace"),
      phase("preparing-workspace", "canceled")
    ]);
  });

  it.each([
    { state: "planned" },
    { state: "approval", mode: "auto", expectedMode: "auto" },
    { state: "review", mode: "read", expectedMode: "read" },
    { state: "implementation", mode: "edit", expectedMode: "edit" }
  ] satisfies Array<{ state: string; mode?: SpawnMode; expectedMode?: SpawnMode }>)(
    "defers or forwards mode for $state",
    async ({ state, mode, expectedMode }) => {
      const mockSpawn = createMockSpawn(successScript());
      const events: AttemptEvent[] = [];
      const ctx = createDriverContext({
        events,
        task: createTask({ state }),
        spawn: mockSpawn.spawn,
        cfg: createConfig({
          states: {
            [state]: {
              prompt: "Run {{ task.id }}",
              ...(mode === undefined ? {} : { mode })
            },
            done: { terminal: true }
          }
        })
      });

      const outcome = await pipelineDriver.run(ctx);

      expect(outcome).toEqual({ reason: "normal" });
      expect(mockSpawn.calls).toEqual([
        {
          agent: "codex",
          prompt: "Run task-1",
          model: undefined,
          cwd: undefined,
          signal: ctx.abort,
          ...(expectedMode === undefined ? {} : { mode: expectedMode })
        }
      ]);
      expect(events).toEqual(successEvents(state, "thread-1"));
    }
  );

  it.each([
    {
      name: "activity timeout",
      scriptError: "activity_timeout",
      outcome: {
        reason: "abnormal",
        failure: "step_timeout",
        failedStep: "planned",
        error: "Agent spawn activity timed out"
      },
      events: failedEvents("planned", "step_timeout")
    },
    {
      name: "agent startup error",
      scriptError: "agent_startup_error",
      outcome: {
        reason: "abnormal",
        failure: "agent_startup_error",
        failedStep: "planned",
        error: "Agent failed to start"
      },
      events: failedEvents("planned", "agent_startup_error")
    },
    {
      name: "agent startup tagged error",
      scriptError: Object.assign(new Error("bootstrap failed"), {
        failure: "agent_startup_error" as const
      }),
      outcome: {
        reason: "abnormal",
        failure: "agent_startup_error",
        failedStep: "planned",
        error: "bootstrap failed"
      },
      events: failedEvents("planned", "agent_startup_error")
    },
    {
      name: "plain error",
      scriptError: new Error("process exploded"),
      outcome: {
        reason: "abnormal",
        failure: "agent_crashed",
        failedStep: "planned",
        error: "process exploded"
      },
      events: failedEvents("planned", "agent_crashed")
    }
  ] as const)("maps spawn $name to the correct failure sequence", async (testCase) => {
    const mockSpawn = createMockSpawn({
      codex: [{ kind: "throw", error: testCase.scriptError }]
    });
    const events: AttemptEvent[] = [];
    const ctx = createDriverContext({ events, spawn: mockSpawn.spawn });

    const outcome = await pipelineDriver.run(ctx);

    expect(outcome).toEqual(testCase.outcome);
    expect(mockSpawn.calls).toHaveLength(1);
    expect(events).toEqual(testCase.events);
  });

  it("maps AbortError after signal abort to canceled without scheduling retry", async () => {
    const controller = new AbortController();
    const mockSpawn = createMockSpawn({
      codex: [
        {
          kind: "assert",
          fn: () => controller.abort()
        }
      ]
    });
    const events: AttemptEvent[] = [];
    const ctx = createDriverContext({
      events,
      abort: controller.signal,
      spawn: mockSpawn.spawn
    });

    const outcome = await pipelineDriver.run(ctx);

    expect(outcome).toEqual({ reason: "abnormal", failure: "canceled" });
    expect(mockSpawn.calls).toHaveLength(1);
    expect(events).toEqual([
      phase(null, "preparing-workspace"),
      phase("preparing-workspace", "running-step", "planned"),
      phase("running-step", "canceled")
    ]);
  });

  it("maps an abort observed after successful spawn return to canceled", async () => {
    const controller = new AbortController();
    const mockSpawn = createMockSpawn(successScript(), {
      afterResult: () => controller.abort()
    });
    const events: AttemptEvent[] = [];
    const ctx = createDriverContext({
      events,
      abort: controller.signal,
      spawn: mockSpawn.spawn
    });

    const outcome = await pipelineDriver.run(ctx);

    expect(outcome).toEqual({ reason: "abnormal", failure: "canceled" });
    expect(mockSpawn.calls).toHaveLength(1);
    expect(events).toEqual([
      phase(null, "preparing-workspace"),
      phase("preparing-workspace", "running-step", "planned"),
      agentExit("planned", "thread-1", 0),
      phase("running-step", "canceled")
    ]);
  });

  it("maps reconciliation cancellation to canceled after a successful spawn", async () => {
    const mockSpawn = createMockSpawn(successScript());
    const events: AttemptEvent[] = [];
    const ctx = createDriverContext({
      events,
      spawn: mockSpawn.spawn,
      reconcile: async () => "canceled"
    });

    const outcome = await pipelineDriver.run(ctx);

    expect(outcome).toEqual({ reason: "abnormal", failure: "canceled" });
    expect(mockSpawn.calls).toHaveLength(1);
    expect(events).toEqual([
      phase(null, "preparing-workspace"),
      phase("preparing-workspace", "running-step", "planned"),
      agentExit("planned", "thread-1", 0),
      phase("running-step", "canceled")
    ]);
  });

  it("does not schedule a retry when the runtime receives a canceled pipeline attempt", async () => {
    const task = createTask({
      metadata: { createdAt: "2026-01-01T00:00:00.000Z" }
    });
    const cfg = createConfig();
    const state = createState(cfg);
    const mockSpawn = createMockSpawn({ codex: [{ kind: "throw", error: "abort" }] });
    const events: TickEvent[] = [];
    const workers: Array<Promise<void>> = [];

    await tick(
      state,
      createTickDeps({
        tasks: createMockTaskList({ tasks: [task] }),
        ensureWorkspace: async () => ({ path: "/repo/workspaces/tasks_task-1", createdNow: true }),
        spawn: mockSpawn.spawn,
        runAttempt: async (args) =>
          pipelineDriver.run(
            createDriverContext({
              task: args.task,
              attempt: args.attempt,
              cfg: args.cfg,
              abort: args.abort,
              spawn: args.deps.spawn ?? mockSpawn.spawn,
              refreshTask: args.deps.refreshTask,
              reconcile: args.deps.reconcile,
              emit: (event) => args.deps.onEvent?.(event)
            })
          ),
        now: () => 5_000,
        trackWorker: (worker) => workers.push(worker.promise),
        onEvent: (event) => events.push(event)
      })
    );
    await Promise.all(workers);

    expect(events).toEqual([
      { type: "tick_started", running: 0 },
      {
        type: "dispatch",
        task_id: "tasks/task-1",
        attempt: 1,
        workspace: "/repo/workspaces/tasks_task-1"
      },
      phase(null, "preparing-workspace"),
      phase("preparing-workspace", "running-step", "planned"),
      phase("running-step", "canceled"),
      {
        type: "worker_exit",
        task_id: "tasks/task-1",
        attempt: 1,
        phase: "canceled",
        outcome: { reason: "abnormal", failure: "canceled" }
      }
    ]);
    expect(state.retry_attempts.has("tasks/task-1")).toBe(false);
  });

  it("maps non-zero spawn exit to step_failed after emitting the exit event", async () => {
    const mockSpawn = createMockSpawn({ codex: [{ kind: "exit", exitCode: 27 }] });
    const events: AttemptEvent[] = [];
    const ctx = createDriverContext({ events, spawn: mockSpawn.spawn });

    const outcome = await pipelineDriver.run(ctx);

    expect(outcome).toEqual({
      reason: "abnormal",
      failure: "step_failed",
      failedStep: "planned",
      error: "exitCode=27"
    });
    expect(mockSpawn.calls).toHaveLength(1);
    expect(events).toEqual([
      phase(null, "preparing-workspace"),
      phase("preparing-workspace", "running-step", "planned"),
      agentExit("planned", "", 27),
      phase("running-step", "failed", undefined, "step_failed")
    ]);
  });

  it("maps zero spawn exit to succeeded with the full phase sequence", async () => {
    const mockSpawn = createMockSpawn(successScript());
    const events: AttemptEvent[] = [];
    const ctx = createDriverContext({ events, spawn: mockSpawn.spawn });

    const outcome = await pipelineDriver.run(ctx);

    expect(outcome).toEqual({ reason: "normal" });
    expect(mockSpawn.calls).toHaveLength(1);
    expect(events).toEqual(successEvents("planned", "thread-1"));
  });

  it("fails with prompt_render_error when prompt rendering throws", async () => {
    const mockSpawn = createMockSpawn(successScript());
    const events: AttemptEvent[] = [];
    const ctx = createDriverContext({
      events,
      task: createTask({ metadata: { count: 1n } }),
      spawn: mockSpawn.spawn,
      cfg: createConfig({
        states: {
          planned: { prompt: "Plan {{ task.metadata }}" },
          done: { terminal: true }
        }
      })
    });

    const outcome = await pipelineDriver.run(ctx);

    expect(outcome).toEqual({
      reason: "abnormal",
      failure: "prompt_render_error",
      failedStep: "planned",
      error: "Do not know how to serialize a BigInt"
    });
    expect(mockSpawn.calls).toEqual([]);
    expect(events).toEqual([
      phase(null, "preparing-workspace"),
      phase("preparing-workspace", "failed", undefined, "prompt_render_error")
    ]);
  });

  it("skips terminal states without spawning", async () => {
    const mockSpawn = createMockSpawn(successScript());
    const events: AttemptEvent[] = [];
    const ctx = createDriverContext({
      events,
      task: createTask({ state: "done" }),
      spawn: mockSpawn.spawn
    });

    const outcome = await pipelineDriver.run(ctx);

    expect(outcome).toEqual({ reason: "skip", skipReason: "terminal_state" });
    expect(mockSpawn.calls).toEqual([]);
    expect(events).toEqual([phase(null, "preparing-workspace")]);
  });

  it("emits unconfigured_state and skips when the task state is missing from config", async () => {
    const mockSpawn = createMockSpawn(successScript());
    const events: AttemptEvent[] = [];
    const ctx = createDriverContext({
      events,
      task: createTask({ state: "reviewing" }),
      spawn: mockSpawn.spawn
    });

    const outcome = await pipelineDriver.run(ctx);

    expect(outcome).toEqual({ reason: "skip", skipReason: "unconfigured_state" });
    expect(mockSpawn.calls).toEqual([]);
    expect(events).toEqual([
      phase(null, "preparing-workspace"),
      { type: "unconfigured_state", task_id: "tasks/task-1", state: "reviewing" }
    ]);
  });

  it("does not run inherited prompts for prototype-named task states", async () => {
    const originalPrompt = Object.getOwnPropertyDescriptor(Object.prototype, "prompt");
    Object.defineProperty(Object.prototype, "prompt", {
      configurable: true,
      value: "Polluted {{ task.id }}"
    });
    const mockSpawn = createMockSpawn(successScript());
    const events: AttemptEvent[] = [];
    const ctx = createDriverContext({
      events,
      task: createTask({ state: "constructor" }),
      spawn: mockSpawn.spawn
    });

    try {
      const outcome = await pipelineDriver.run(ctx);

      expect(outcome).toEqual({ reason: "skip", skipReason: "unconfigured_state" });
      expect(mockSpawn.calls).toEqual([]);
      expect(events).toEqual([
        phase(null, "preparing-workspace"),
        { type: "unconfigured_state", task_id: "tasks/task-1", state: "constructor" }
      ]);
    } finally {
      if (originalPrompt === undefined) {
        delete (Object.prototype as Record<string, unknown>).prompt;
      } else {
        Object.defineProperty(Object.prototype, "prompt", originalPrompt);
      }
    }
  });

  it("emits unconfigured_state and skips when a configured state has no runnable prompt", async () => {
    const mockSpawn = createMockSpawn(successScript());
    const events: AttemptEvent[] = [];
    const ctx = createDriverContext({
      events,
      task: createTask({ state: "blocked" }),
      spawn: mockSpawn.spawn,
      cfg: createConfig({
        states: {
          planned: { prompt: "Plan {{ task.id }}" },
          blocked: {},
          done: { terminal: true }
        }
      })
    });

    const outcome = await pipelineDriver.run(ctx);

    expect(outcome).toEqual({ reason: "skip", skipReason: "unconfigured_state" });
    expect(mockSpawn.calls).toEqual([]);
    expect(events).toEqual([
      phase(null, "preparing-workspace"),
      { type: "unconfigured_state", task_id: "tasks/task-1", state: "blocked" }
    ]);
  });

  it("expands every supported task variable into the rendered prompt", async () => {
    const mockSpawn = createMockSpawn(successScript());
    const events: AttemptEvent[] = [];
    const task = createTask({
      list: "bugs",
      id: "bug-7",
      qualifiedId: "bugs/bug-7",
      name: "Fix login",
      state: "planned",
      description: "Repair OAuth callback",
      metadata: { url: "https://tracker.local/bugs/7", priority: 1 }
    });
    const ctx = createDriverContext({
      events,
      task,
      spawn: mockSpawn.spawn,
      cfg: createConfig({
        states: {
          planned: {
            prompt: [
              "id={{ task.id }}",
              "qualifiedId={{ task.qualifiedId }}",
              "url={{ task.url }}",
              "description={{ task.description }}",
              "name={{ task.name }}",
              "state={{ task.state }}",
              "metadata={{ task.metadata }}",
              "list={{ task.list }}"
            ].join("\n")
          },
          done: { terminal: true }
        }
      })
    });

    const outcome = await pipelineDriver.run(ctx);

    expect(outcome).toEqual({ reason: "normal" });
    expect(mockSpawn.calls.map((call) => call.prompt)).toEqual([
      [
        "id=bug-7",
        "qualifiedId=bugs/bug-7",
        "url=https://tracker.local/bugs/7",
        "description=Repair OAuth callback",
        "name=Fix login",
        "state=planned",
        'metadata={"priority":1,"url":"https://tracker.local/bugs/7"}',
        "list=bugs"
      ].join("\n")
    ]);
    expect(events).toEqual(successEvents("planned", "thread-1", "bugs/bug-7"));
  });

  it("maps task refresh failures to step_failed", async () => {
    const refreshError = new Error("refresh failed");
    const task = createTask();
    const tasks = createMockTaskList({
      tasks: [task],
      failures: {
        refreshError: () => refreshError
      }
    });
    const mockSpawn = createMockSpawn(successScript());
    const events: AttemptEvent[] = [];
    const ctx = createDriverContext({
      events,
      task,
      spawn: mockSpawn.spawn,
      refreshTask: (qualifiedId) => tasks.refresh(qualifiedId)
    });

    const outcome = await pipelineDriver.run(ctx);

    expect(outcome).toEqual({
      reason: "abnormal",
      failure: "step_failed",
      failedStep: "planned",
      error: "refresh failed"
    });
    expect(mockSpawn.calls).toEqual([]);
    expect(events).toEqual([
      phase(null, "preparing-workspace"),
      phase("preparing-workspace", "failed", undefined, "step_failed")
    ]);
  });

  it("preserves non-Error task refresh failures as step_failed", async () => {
    const mockSpawn = createMockSpawn(successScript());
    const events: AttemptEvent[] = [];
    const ctx = createDriverContext({
      events,
      spawn: mockSpawn.spawn,
      refreshTask: async () => Promise.reject("refresh failed")
    });

    const outcome = await pipelineDriver.run(ctx);

    expect(outcome).toEqual({
      reason: "abnormal",
      failure: "step_failed",
      failedStep: "planned",
      error: "refresh failed"
    });
    expect(mockSpawn.calls).toEqual([]);
    expect(events).toEqual([
      phase(null, "preparing-workspace"),
      phase("preparing-workspace", "failed", undefined, "step_failed")
    ]);
  });

  it("keeps sequential two-state dispatches ordered with distinct prompts and spawn calls", async () => {
    const mockSpawn = createMockSpawn(successScript());
    const firstEvents: AttemptEvent[] = [];
    const secondEvents: AttemptEvent[] = [];
    const cfg = createConfig({
      states: {
        planned: { prompt: "Plan {{ task.id }}" },
        review: { prompt: "Review {{ task.id }}" },
        done: { terminal: true }
      }
    });

    const first = await pipelineDriver.run(
      createDriverContext({
        events: firstEvents,
        task: createTask({ id: "first", qualifiedId: "tasks/first", state: "planned" }),
        spawn: mockSpawn.spawn,
        cfg
      })
    );
    const second = await pipelineDriver.run(
      createDriverContext({
        events: secondEvents,
        task: createTask({ id: "second", qualifiedId: "tasks/second", state: "review" }),
        spawn: mockSpawn.spawn,
        cfg
      })
    );

    expect([first, second]).toEqual([{ reason: "normal" }, { reason: "normal" }]);
    expect(mockSpawn.calls.map((call) => call.prompt)).toEqual(["Plan first", "Review second"]);
    expect(mockSpawn.calls.map((call) => call.agent)).toEqual(["codex", "codex"]);
    expect(firstEvents).toEqual(successEvents("planned", "thread-1", "tasks/first"));
    expect(secondEvents).toEqual(successEvents("review", "thread-1", "tasks/second"));
  });
});

function successScript() {
  return () =>
    [
      { kind: "emit", event: { event: "session_start", threadId: "thread-1" } },
      { kind: "exit", exitCode: 0 }
    ] as const;
}

function successEvents(step: string, sessionId: string, taskId = "tasks/task-1"): AttemptEvent[] {
  return [
    phase(null, "preparing-workspace", undefined, undefined, taskId),
    phase("preparing-workspace", "running-step", step, undefined, taskId),
    agentExit(step, sessionId, 0, taskId),
    phase("running-step", "succeeded", undefined, undefined, taskId)
  ];
}

function failedEvents(
  step: string,
  failure: NonNullable<AttemptOutcome["failure"]>
): AttemptEvent[] {
  return [
    phase(null, "preparing-workspace"),
    phase("preparing-workspace", "running-step", step),
    phase("running-step", "failed", undefined, failure)
  ];
}

function phase(
  from: AttemptPhase | null,
  to: AttemptPhase,
  step?: string,
  failure?: NonNullable<AttemptOutcome["failure"]>,
  taskId?: string
): AttemptEvent {
  const event: AttemptEvent = {
    type: "attempt_phase",
    task_id: taskId ?? "tasks/task-1",
    from,
    to
  };

  if (from !== null) {
    return { ...event, step, failure };
  }

  return event;
}

function agentExit(
  step: string,
  sessionId: string,
  exitCode: number,
  taskId?: string
): AttemptEvent {
  return {
    type: "agent_event",
    task_id: taskId ?? "tasks/task-1",
    step,
    session_id: sessionId,
    event: "exit",
    payload: { exitCode }
  };
}
