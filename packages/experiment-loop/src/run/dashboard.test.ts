import { expect, it, vi } from "vitest";
import { createExperimentDashboardCallbacks } from "./dashboard.js";

it("shows experiment order, retained work, and discarded iterations", async () => {
  const view = { updateRun: vi.fn(), dashboard: { appendOutput: vi.fn() } };
  const callbacks = createExperimentDashboardCallbacks(view);
  await callbacks.onPlanResolved({ docPath: "plan.md", agent: "codex", model: "chosen", maxExperiments: 3, experimentsCompleted: 1, logDir: "/logs" });
  await callbacks.onExperimentStart(2, "codex");
  expect(view.updateRun.mock.calls.at(-1)?.[0]).toMatchObject({ activeTaskId: "experiment-2", tasks: [
    { id: "experiment-1", status: "completed" }, { id: "experiment-2", status: "running" }, { id: "experiment-3", status: "pending" }
  ] });
  await callbacks.onExperimentDiscarded(2, "No journal result");
  expect(view.updateRun.mock.calls.at(-1)?.[0]).toMatchObject({ tasks: [
    { id: "experiment-1", status: "completed" }, { id: "experiment-2", status: "completed", title: "Experiment 2 · discarded" }, { id: "experiment-3", status: "pending" }
  ] });
});

it("grows the visible experiment history without allocating an infinite task list", async () => {
  const view = { updateRun: vi.fn(), dashboard: { appendOutput: vi.fn() } };
  const callbacks = createExperimentDashboardCallbacks(view);
  await callbacks.onPlanResolved({ docPath: "plan.md", agent: "codex", maxExperiments: Infinity, experimentsCompleted: 0, logDir: "/logs" });
  await callbacks.onExperimentStart(1, "codex");
  expect(view.updateRun.mock.calls.at(-1)?.[0].tasks).toHaveLength(1);
});
