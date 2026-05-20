import { TaskNotFoundError } from "@poe-code/task-list";
import type { Task, TaskList } from "@poe-code/task-list";

import { markCompleted, release, type MaestroState, type RunningEntry } from "./state.js";
import { removeWorkspace as removeWorkspaceDir } from "../workspace/manager.js";

export type ReconcileAction = "stop_clean" | "stop_keep" | "update" | "refresh_failed";

export interface ReconcileResult {
  taskId: string;
  action: ReconcileAction;
}

export interface ReconcileDeps {
  tasks: Pick<TaskList, "get">;
  stopWorker?: (
    entry: RunningEntry,
    action: Extract<ReconcileAction, "stop_clean" | "stop_keep">
  ) => void | Promise<void>;
  removeWorkspace?: (root: string, qualifiedId: string) => Promise<void>;
  logger?: {
    warn?(message: string, meta?: Record<string, unknown>): void;
  };
  onEvent?: (event: {
    type: "reconcile";
    task_id: string;
    action: ReconcileAction;
  }) => void;
}

export async function reconcileRunning(
  state: MaestroState,
  deps: ReconcileDeps
): Promise<ReconcileResult[]> {
  const results: ReconcileResult[] = [];

  for (const entry of [...state.running.values()]) {
    const refreshed = await refreshTask(deps.tasks, entry.taskId);

    if (refreshed.kind === "failed") {
      deps.onEvent?.({ type: "reconcile", task_id: entry.taskId, action: "refresh_failed" });
      results.push({ taskId: entry.taskId, action: "refresh_failed" });
      continue;
    }

    if (refreshed.kind === "missing" || isTerminal(state, refreshed.task)) {
      await stopClean(state, deps, entry, refreshed.kind === "task" ? refreshed.task : undefined);
      results.push({ taskId: entry.taskId, action: "stop_clean" });
      continue;
    }

    if (isActive(state, refreshed.task)) {
      state.running.set(entry.taskId, { ...entry, task: refreshed.task });
      deps.onEvent?.({ type: "reconcile", task_id: entry.taskId, action: "update" });
      results.push({ taskId: entry.taskId, action: "update" });
      continue;
    }

    await stopKeep(state, deps, entry);
    results.push({ taskId: entry.taskId, action: "stop_keep" });
  }

  return results;
}

async function refreshTask(
  tasks: Pick<TaskList, "get">,
  taskId: string
): Promise<
  { kind: "task"; task: Task } | { kind: "missing" } | { kind: "failed"; error: unknown }
> {
  try {
    return { kind: "task", task: await tasks.get(taskId) };
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      return { kind: "missing" };
    }

    return { kind: "failed", error };
  }
}

async function stopClean(
  state: MaestroState,
  deps: ReconcileDeps,
  entry: RunningEntry,
  refreshedTask?: Task
): Promise<void> {
  await deps.stopWorker?.(entry, "stop_clean");
  const workspaceTaskId = refreshedTask?.qualifiedId ?? entry.task?.qualifiedId ?? entry.taskId;

  try {
    await (deps.removeWorkspace ?? removeWorkspaceDir)(state.cfg.workspace.root, workspaceTaskId);
  } catch (error) {
    deps.logger?.warn?.("maestro workspace cleanup failed", {
      taskId: entry.taskId,
      error: errorMessage(error)
    });
  }

  markCompleted(state, entry.taskId);
  deps.onEvent?.({ type: "reconcile", task_id: entry.taskId, action: "stop_clean" });
}

async function stopKeep(
  state: MaestroState,
  deps: ReconcileDeps,
  entry: RunningEntry
): Promise<void> {
  await deps.stopWorker?.(entry, "stop_keep");
  release(state, entry.taskId);
  deps.onEvent?.({ type: "reconcile", task_id: entry.taskId, action: "stop_keep" });
}

function isTerminal(state: MaestroState, task: Task): boolean {
  return state.cfg.terminalStateNames.includes(task.state);
}

function isActive(state: MaestroState, task: Task): boolean {
  return state.cfg.activeStateNames.includes(task.state);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
