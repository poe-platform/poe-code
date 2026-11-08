import type { HarnessDashboard } from "@poe-code/agent-harness-tools";
import type { dashboard } from "toolcraft-design";
import type { ExperimentRunOptions } from "../types.js";

type View = Pick<HarnessDashboard, "updateRun"> & { dashboard: Pick<HarnessDashboard["dashboard"], "appendOutput"> };

export function createExperimentDashboardCallbacks(view: View): Required<Pick<ExperimentRunOptions,
  "onPlanResolved" | "onExperimentStart" | "onExperimentComplete" | "onExperimentDiscarded" |
  "onBaselineCollected" | "onMetricResult" | "onCommit" | "onReset">> {
  let total = Infinity;
  let tasks: NonNullable<dashboard.DashboardRunState["tasks"]> = [];
  const append = (text: string) => view.dashboard.appendOutput({ kind: "status", role: "action", text, ts: Date.now() });
  function finish(index: number, kept: boolean): void {
    tasks = tasks.map((task) => task.id === `experiment-${index}`
      ? { ...task, status: "completed", title: `Experiment ${index} · ${kept ? "kept" : "discarded"}` } : task);
    view.updateRun({ tasks, activeTaskId: undefined, phase: kept ? "Changes kept" : "Experiment discarded" });
  }
  return {
    onPlanResolved(summary) {
      total = summary.maxExperiments;
      tasks = Array.from({ length: Number.isFinite(total) ? total : summary.experimentsCompleted }, (_, index) => ({
        id: `experiment-${index + 1}`, title: `Experiment ${index + 1}`,
        status: index < summary.experimentsCompleted ? "completed" : "pending"
      }));
      view.updateRun({ tasks, agent: summary.agent, model: summary.model, phase: "Preparing experiment" });
    },
    onExperimentStart(index, agent) {
      const count = Math.max(tasks.length, index);
      tasks = Array.from({ length: count }, (_, offset) => ({
        id: `experiment-${offset + 1}`, title: tasks[offset]?.title ?? `Experiment ${offset + 1}`,
        status: offset + 1 < index ? "completed" : offset + 1 === index ? "running" : "pending"
      }));
      view.updateRun({ tasks, agent, activeTaskId: `experiment-${index}`,
        phase: `Experiment ${index}${Number.isFinite(total) ? `/${total}` : ""}` });
    },
    onExperimentComplete(index, entry) { finish(index, entry.status === "keep"); },
    onExperimentDiscarded(index, reason) { finish(index, false); append(`Experiment ${index} discarded · ${reason}`); },
    onBaselineCollected(baseline) { append(`Baseline · ${Object.entries(baseline).map(([name, value]) => `${name} ${value}`).join(" · ")}`); },
    onMetricResult(metric, result) { append(`${metric.name} · ${result.passed ? "passed" : "failed"}${result.score === null ? "" : ` · ${result.score}`}`); },
    onCommit(hash) { append(`Changes kept · ${hash.slice(0, 7)}`); },
    onReset() { append("Restored previous result"); }
  };
}
