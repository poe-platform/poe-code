import { describe, expect, it, vi } from "vitest";
import type { HarnessDashboard } from "@poe-code/agent-harness-tools";
import { createGaslightDashboardObserver } from "./dashboard.js";

describe("Gaslight dashboard rounds", () => {
  it("shows setup, implementation, configured follow-ups, and teardown in order", () => {
    const updateRun = vi.fn();
    const observer = createGaslightDashboardObserver({ updateRun } as unknown as HarnessDashboard, { setup: "Prepare workspace", prompt: "Implement", followups: ["Verify all tests"], teardown: "Clean up" });
    observer({ type: "round.started", round: 3, total: 4, prompt: "Verify all tests", planPath: "one.md", planIndex: 1, totalPlans: 2 });
    expect(updateRun).toHaveBeenLastCalledWith(expect.objectContaining({ activeTaskId: "round-3", phase: "Verify all tests", tasks: [
      { id: "round-1", title: "Setup", status: "completed" },
      { id: "round-2", title: "Implement plan", status: "completed" },
      { id: "round-3", title: "Verify all tests", status: "running" },
      { id: "round-4", title: "Teardown", status: "pending" }
    ] }));
    observer({ type: "round.finished", round: 4, total: 4, summary: "Done", planPath: "one.md", planIndex: 1, totalPlans: 2 });
    expect(updateRun).toHaveBeenLastCalledWith(expect.objectContaining({ activeTaskId: undefined, tasks: expect.arrayContaining([expect.objectContaining({ id: "round-4", status: "completed" })]) }));
  });
});
