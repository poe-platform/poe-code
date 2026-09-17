import { createDashboard, type dashboard } from "toolcraft-design";
import type { RunQueue, RunQueueSnapshot } from "./run-queue.js";

/** One view for an entire harness sequence, including work added while it runs. */
export function createHarnessDashboard(options: {
  title: string;
  agent: string;
  model?: string;
  cwd: string;
  queue: RunQueue;
  validatePlan?: (path: string) => Promise<string>;
}) {
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let startedAt = Date.now();
  let tokensIn = 0;
  let tokensOut = 0;
  let usageAvailable = false;
  let activeItemId: string | undefined;
  let run: dashboard.DashboardRunState = {
    agent: options.agent, model: options.model, cwd: options.cwd,
    phase: "Preparing plan", tasks: []
  };
  const view = createDashboard({
    title: options.title,
    appearance: "conversation",
    async onSubmit(input) {
      if (disposed) throw new Error("This run has finished.");
      if (input.kind === "plan") {
        if (options.validatePlan) {
          await options.queue.enqueueValidatedPlan(input.text, async (inputPath) => {
            const path = await options.validatePlan!(inputPath);
            if (disposed) throw new Error("This run has finished.");
            return path;
          });
        } else options.queue.enqueuePlan(input.text);
      } else {
        options.queue.enqueueMessage(input.text, input.afterPlanId);
      }
    }
  });

  function sync(snapshot = options.queue.getSnapshot()): void {
    if (disposed) return;
    const statuses: Record<RunQueueSnapshot["status"], dashboard.DashboardStats["status"]> = {
      idle: "idle", running: "running", completed: "done", failed: "error", cancelled: "paused", paused: "paused"
    };
    view.updateStats({
      status: statuses[snapshot.status],
      iterations: run.tasks?.filter((task) => task.status === "completed").length ?? 0,
      iterationsLabel: "Tasks", tokensIn, tokensOut, usageAvailable,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      currentAction: run.activity ?? run.phase,
      run: { ...run, queue: snapshot.items, activePlanId: snapshot.activePlanId }
    });
  }

  const unsubscribe = options.queue.onChange((snapshot) => {
    if (disposed) return;
    if (snapshot.activeItemId && snapshot.activeItemId !== activeItemId) {
      activeItemId = snapshot.activeItemId;
      const active = snapshot.items.find((item) => item.id === activeItemId);
      run = { ...run, activity: undefined, activeTaskId: undefined, activeStep: undefined,
        phase: active?.kind === "message" ? "Follow-up" : "Preparing plan",
        ...(active?.kind === "plan" ? { tasks: [] } : {}) };
      if (active?.kind === "message") view.appendOutput({ kind: "info", role: "user", text: active.text, ts: Date.now() });
    }
    if (snapshot.status !== "idle" && snapshot.status !== "running") {
      const phase = { completed: "Completed", failed: "Failed", cancelled: "Cancelled", paused: "Paused" }[snapshot.status];
      run = { ...run, phase, activity: undefined, activeTaskId: undefined, activeStep: undefined };
    }
    sync(snapshot);
  });

  return {
    dashboard: view,
    start(): void {
      if (timer !== undefined || disposed) return;
      startedAt = Date.now();
      view.start();
      sync();
      timer = setInterval(sync, 1000);
    },
    updateRun(update: Partial<dashboard.DashboardRunState>): void {
      run = { ...run, ...update };
      sync();
    },
    addUsage(usage: { inputTokens: number; outputTokens: number }): void {
      tokensIn += usage.inputTokens;
      tokensOut += usage.outputTokens;
      usageAvailable = true;
      sync();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      unsubscribe();
      view.stop();
      view.destroy();
    }
  };
}

export type HarnessDashboard = ReturnType<typeof createHarnessDashboard>;
