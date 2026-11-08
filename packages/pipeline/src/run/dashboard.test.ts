import { describe, expect, it, vi } from "vitest";
import type { HarnessDashboard } from "@poe-code/agent-harness-tools";
import { createPipelineDashboardCallbacks } from "./dashboard.js";

describe("pipeline dashboard progress", () => {
  it("shows all tasks during setup and the real active task and step during execution", () => {
    const updateRun = vi.fn();
    const callbacks = createPipelineDashboardCallbacks({ updateRun, dashboard: { appendOutput: vi.fn() } } as unknown as HarnessDashboard);
    callbacks.onPlanProgress!({ planPath: "one.md", tasks: [
      { id: "done", title: "Previous task", status: "done" },
      { id: "work", title: "Verify exports", status: { implement: "done", verify: "open" } }
    ] });
    callbacks.onTaskStart!({ phase: "setup", taskId: "setup", taskTitle: "Setup", taskIndex: 0, totalTasks: 2 });
    expect(updateRun).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "Setup", activeTaskId: undefined, tasks: [expect.objectContaining({ status: "completed" }), expect.objectContaining({ status: "pending" })] }));
    callbacks.onTaskStart!({ taskId: "work", taskTitle: "Verify exports", taskIndex: 2, totalTasks: 2, stepName: "verify", stepIndex: 2, totalSteps: 2 });
    expect(updateRun).toHaveBeenLastCalledWith(expect.objectContaining({ activeTaskId: "work", activeStep: "verify", tasks: [expect.objectContaining({ status: "completed" }), expect.objectContaining({ status: "running", steps: [ { name: "implement", status: "completed" }, { name: "verify", status: "running" } ] })] }));
    callbacks.onTaskComplete!({ taskId: "work", taskTitle: "Verify exports", taskIndex: 2, totalTasks: 2, stepName: "verify", durationMs: 200, success: false });
    expect(updateRun).toHaveBeenLastCalledWith(expect.objectContaining({ tasks: [expect.objectContaining({ status: "completed" }), expect.objectContaining({ status: "failed" })] }));
  });
});
