import type { HarnessDashboard } from "@poe-code/agent-harness-tools";
import type { RalphRunOptions } from "../types.js";

export function createRalphDashboardCallbacks(view: Pick<HarnessDashboard, "updateRun">): Required<Pick<RalphRunOptions, "onIterationStart" | "onIterationComplete">> {
  let total = 0;
  function update(iteration: number, status: "running" | "completed" | "failed", agent?: string): void {
    view.updateRun({
      ...(agent ? { agent } : {}),
      phase: `Iteration ${iteration}/${total}`,
      activeTaskId: status === "running" ? `iteration-${iteration}` : undefined,
      tasks: Array.from({ length: total }, (_, index) => ({
        id: `iteration-${index + 1}`, title: `Iteration ${index + 1}`,
        status: index + 1 < iteration ? "completed" : index + 1 === iteration ? status : "pending"
      }))
    });
  }
  return {
    onIterationStart(iteration, maxIterations, agent) {
      total = maxIterations;
      update(iteration, "running", agent);
    },
    onIterationComplete(iteration, _durationMs, success) {
      update(iteration, success ? "completed" : "failed");
    }
  };
}
