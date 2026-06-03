import { describe, expect, it, vi } from "vitest";

import {
  assertEventually,
  createConfig,
  createDriverContext,
  createTask,
  createTickDeps,
  createWorkflowDefinition
} from "./fixtures.js";

describe("fixtures", () => {
  it("creates a task with sensible defaults and derives ids from qualifiedId overrides", () => {
    expect(createTask()).toEqual({
      list: "tasks",
      id: "task-1",
      qualifiedId: "tasks/task-1",
      name: "Build runner",
      state: "planned",
      description: "Render this task body",
      metadata: {},
      url: undefined
    });

    expect(
      createTask({
        qualifiedId: "backlog/ship-it",
        state: "done",
        metadata: { priority: 1 },
        url: "https://example.test/tasks/ship-it"
      })
    ).toMatchObject({
      list: "backlog",
      id: "ship-it",
      qualifiedId: "backlog/ship-it",
      name: "ship-it",
      state: "done",
      metadata: { priority: 1 },
      url: "https://example.test/tasks/ship-it"
    });
  });

  it("creates a minimal config and derives state collections from state overrides", () => {
    expect(createConfig()).toMatchObject({
      tasks: { type: "markdown-dir", path: "/__memfs__/tasks" },
      states: {
        planned: { prompt: "Plan {{ prompt }}" },
        done: { terminal: true }
      },
      activeStateNames: ["planned"],
      terminalStateNames: ["done"],
      stateOrder: ["planned", "done"],
      workspace: { root: "/__memfs__/workspaces" },
      agent: {
        service: "codex",
        maxConcurrentAgents: 1,
        maxRetryBackoffMs: 300_000
      }
    });

    expect(
      createConfig({
        states: {
          queued: { prompt: "Queue {{ task.id }}" },
          failed: { terminal: true }
        },
        agent: { service: "claude", maxConcurrentAgents: 3 }
      })
    ).toMatchObject({
      activeStateNames: ["queued"],
      terminalStateNames: ["failed"],
      stateOrder: ["queued", "failed"],
      agent: { service: "claude", maxConcurrentAgents: 3 }
    });
  });

  it("creates tick deps with a mock task list and spawn while allowing overrides", async () => {
    const runAttempt = vi.fn(async () => ({ reason: "normal" as const }));
    const deps = createTickDeps({ runAttempt });

    await expect(deps.validateDispatch?.(createConfig(), deps.tasks)).resolves.toEqual({
      ok: true
    });
    await expect(deps.reconcileRunning?.({} as never)).resolves.toEqual([]);
    await expect(deps.tasks.allTasks({ state: "planned" })).resolves.toEqual([]);

    await deps.spawn?.("codex", { prompt: "hello" });
    await deps.runAttempt?.({} as never);

    expect(runAttempt).toHaveBeenCalledTimes(1);
  });

  it("creates driver contexts with event capture and overrides", async () => {
    const events: Parameters<ReturnType<typeof createDriverContext>["emit"]>[0][] = [];
    const ctx = createDriverContext({
      events,
      task: createTask({ qualifiedId: "tasks/custom" })
    });

    ctx.emit({ type: "attempt_phase", from: null, to: "running-step", step: "planned" });
    await ctx.spawn("codex", { prompt: "hello" });

    expect(ctx.task.qualifiedId).toBe("tasks/custom");
    expect(ctx.workspaceDir).toBe("/__memfs__/workspaces/task-1");
    expect(events).toEqual([
      { type: "attempt_phase", from: null, to: "running-step", step: "planned" }
    ]);
  });

  it("creates loadWorkflow-shaped definitions without fs", () => {
    expect(createWorkflowDefinition()).toEqual({
      sourcePath: "/__memfs__/WORKFLOW.md",
      config: createConfig(),
      promptTemplate: "{{ task.description }}"
    });

    expect(
      createWorkflowDefinition({
        sourcePath: "/repo/custom.md",
        config: { states: {} },
        promptTemplate: "custom"
      })
    ).toEqual({
      sourcePath: "/repo/custom.md",
      config: { states: {} },
      promptTemplate: "custom"
    });
  });

  it("assertEventually advances fake time and ticks until the predicate passes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    try {
      let ticks = 0;
      const observedTimes: number[] = [];

      const tickCount = await assertEventually(() => ticks === 3, {
        ticks: 5,
        advanceMs: 25,
        tick: () => {
          ticks += 1;
          observedTimes.push(Date.now());
        }
      });

      expect(tickCount).toBe(3);
      expect(ticks).toBe(3);
      expect(observedTimes).toEqual([25, 50, 75]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("assertEventually fails after exhausting the tick budget", async () => {
    vi.useFakeTimers();

    try {
      let ticks = 0;

      await expect(
        assertEventually(() => false, {
          ticks: 2,
          tick: () => {
            ticks += 1;
          }
        })
      ).rejects.toThrow();

      expect(ticks).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
