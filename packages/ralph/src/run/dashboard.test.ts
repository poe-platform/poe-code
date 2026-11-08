import { expect, it, vi } from "vitest";
import { createRalphDashboardCallbacks } from "./dashboard.js";

it("shows iteration order and records failure without marking later iterations complete", () => {
  const updateRun = vi.fn();
  const callbacks = createRalphDashboardCallbacks({ updateRun });
  callbacks.onIterationStart(2, 4, "codex");
  expect(updateRun).toHaveBeenLastCalledWith(expect.objectContaining({ agent: "codex", activeTaskId: "iteration-2", tasks: [
    { id: "iteration-1", title: "Iteration 1", status: "completed" },
    { id: "iteration-2", title: "Iteration 2", status: "running" },
    { id: "iteration-3", title: "Iteration 3", status: "pending" },
    { id: "iteration-4", title: "Iteration 4", status: "pending" }
  ] }));
  callbacks.onIterationComplete(2, 100, false);
  expect(updateRun.mock.calls.at(-1)?.[0].tasks.map((task: { status: string }) => task.status)).toEqual(["completed", "failed", "pending", "pending"]);
});
