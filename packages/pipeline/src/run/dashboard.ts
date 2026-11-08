import type { HarnessDashboard } from "@poe-code/agent-harness-tools";
import type { dashboard } from "toolcraft-design";
import type { PipelineRunOptions, PipelineStatus, TaskProgress } from "../types.js";

/** Project persisted pipeline state and live step events into the shared harness view. */
export function createPipelineDashboardCallbacks(view: HarnessDashboard): Pick<PipelineRunOptions,
  "onPlanProgress" | "onTaskStart" | "onTaskComplete" | "onLockWait" | "onPlanReloadError"
> {
  let tasks: dashboard.DashboardTask[] = [];
  let current: TaskProgress | undefined;
  const status = (value: PipelineStatus): dashboard.DashboardWorkStatus => value === "done" ? "completed" : value === "failed" ? "failed" : "pending";
  function publish(): void {
    view.updateRun({
      tasks,
      phase: current?.phase === "setup" ? "Setup" : current?.phase === "teardown" ? "Teardown" : current?.taskTitle,
      activeTaskId: current?.phase ? undefined : current?.taskId,
      activeStep: current?.phase ? undefined : current?.stepName
    });
  }
  return {
    onPlanProgress(progress) {
      tasks = progress.tasks.map((task) => {
        const steps = typeof task.status === "string" ? undefined : Object.entries(task.status).map(([name, value]) => ({ name, status: status(value) }));
        const taskStatus = typeof task.status === "string" ? status(task.status)
          : steps!.some((step) => step.status === "failed") ? "failed"
          : steps!.every((step) => step.status === "completed") ? "completed" : "pending";
        return { id: task.id, title: task.title, status: taskStatus, ...(steps ? { steps } : {}) };
      });
      view.updateRun({ tasks });
    },
    onTaskStart(progress) {
      current = progress;
      if (!progress.phase) tasks = tasks.map((task) => task.id !== progress.taskId ? task : {
        ...task, status: "running",
        ...(task.steps ? { steps: task.steps.map((step) => step.name === progress.stepName ? { ...step, status: "running" } : step) } : {})
      });
      publish();
    },
    onTaskComplete(progress) {
      const outcome = progress.cancelled ? "cancelled" : progress.success ? "completed" : "failed";
      if (!progress.phase) tasks = tasks.map((task) => task.id !== progress.taskId ? task : {
        ...task,
        status: progress.success && !progress.taskCompleted ? "pending" : outcome,
        ...(task.steps ? { steps: task.steps.map((step) => step.name === progress.stepName ? { ...step, status: outcome } : step) } : {})
      });
      if (progress.phase || progress.taskCompleted || !progress.success) {
        view.dashboard.appendOutput({ kind: progress.cancelled ? "status" : progress.success ? "success" : "error",
          role: "action", text: `${progress.taskTitle} · ${outcome}`, ts: Date.now() });
      }
      current = undefined;
      publish();
    },
    onLockWait(planPath) {
      view.updateRun({ phase: "Waiting for another run", activeTaskId: undefined, activeStep: undefined });
      view.dashboard.appendOutput({ kind: "status", role: "action", text: `Waiting for ${planPath}`, ts: Date.now() });
    },
    onPlanReloadError(error) {
      view.dashboard.appendOutput({ kind: "error", role: "action", text: `Plan reload failed; continuing with the last valid task list: ${error.message}`, ts: Date.now() });
    }
  };
}
