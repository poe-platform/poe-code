import type { Task, TaskList } from "@poe-code/task-list";
import { spawn as defaultSpawn } from "@poe-code/agent-spawn";

import {
  runAttempt as defaultRunAttempt,
  type AttemptEvent,
  type AttemptOutcome
} from "../agent/runner.js";
import type { DispatchValidationResult } from "../config/validate.js";
import { validateDispatch as defaultValidateDispatch } from "../config/validate.js";
import { resolveWorkflowKind } from "../drivers/kind.js";
import { getDriver } from "../drivers/registry.js";
import {
  ensureWorkspace as defaultEnsureWorkspace,
  removeWorkspace as defaultRemoveWorkspace,
  type EnsureWorkspaceResult
} from "../workspace/manager.js";
import type { AttemptPhase } from "./phases.js";
import { reconcileRunning as defaultReconcileRunning, type ReconcileResult } from "./reconcile.js";
import { backoffMs, shouldRetry } from "./retry.js";
import {
  cancelRetry,
  claim,
  markCompleted,
  markRunning,
  release,
  scheduleRetry,
  type MaestroState
} from "./state.js";

export type TickEvent =
  | { type: "tick_started"; running: number }
  | { type: "task_skipped"; task_id: string; reason: "unsupported_kind"; kind: string }
  | { type: "dispatch"; task_id: string; attempt: number; workspace: string }
  | {
      type: "worker_exit";
      task_id: string;
      attempt: number;
      phase: Extract<AttemptPhase, "succeeded" | "failed" | "canceled">;
      outcome: AttemptOutcome;
    }
  | { type: "retry_scheduled"; task_id: string; attempt: number; due_at: number }
  | { type: "reconcile"; task_id: string; action: ReconcileResult["action"] }
  | { type: "validation_failed"; result: Exclude<DispatchValidationResult, { ok: true }> }
  | AttemptEvent;

export interface TrackedWorker {
  taskId: string;
  controller: AbortController;
  promise: Promise<void>;
}

export interface TickDeps {
  tasks: Pick<TaskList, "allTasks" | "get" | "list" | "lists">;
  validateDispatch?: (
    cfg: MaestroState["cfg"],
    taskList: Pick<TaskList, "lists">
  ) => Promise<DispatchValidationResult>;
  reconcileRunning?: (state: MaestroState) => Promise<ReconcileResult[]>;
  ensureWorkspace?: (root: string, qualifiedId: string) => Promise<EnsureWorkspaceResult>;
  removeWorkspace?: (root: string, qualifiedId: string) => Promise<void>;
  runAttempt?: typeof defaultRunAttempt;
  spawn?: typeof defaultSpawn;
  taskPromptTemplate?: string;
  trackWorker?: (worker: TrackedWorker) => void;
  now?: () => number;
  onEvent?: (event: TickEvent) => void;
}

export async function tick(state: MaestroState, deps: TickDeps): Promise<void> {
  const now = deps.now?.() ?? Date.now();
  deps.onEvent?.({ type: "tick_started", running: state.running.size });

  const reconcileResults = await (deps.reconcileRunning ?? defaultReconcileRunning)(state, {
    tasks: deps.tasks
  });

  for (const result of reconcileResults) {
    deps.onEvent?.({ type: "reconcile", task_id: result.taskId, action: result.action });
  }

  const retryReconcileResults = await reconcileRetryQueue(state, deps);
  for (const result of retryReconcileResults) {
    deps.onEvent?.({ type: "reconcile", task_id: result.taskId, action: result.action });
  }

  const validateDispatch = deps.validateDispatch ?? defaultValidateDispatch;
  const validation = await validateDispatch(state.cfg, deps.tasks);

  if (!validation.ok) {
    deps.onEvent?.({ type: "validation_failed", result: validation });
    return;
  }

  const capacity = Math.max(0, state.cfg.agent.maxConcurrentAgents - state.running.size);
  if (capacity === 0) {
    return;
  }

  const candidates = await activeCandidates(state, deps.tasks);
  let dispatched = 0;

  for (const task of candidates) {
    if (dispatched >= capacity) {
      return;
    }

    const kind = resolveWorkflowKind(task);
    if (getDriver(kind) === undefined) {
      deps.onEvent?.({
        type: "task_skipped",
        task_id: task.qualifiedId,
        reason: "unsupported_kind",
        kind
      });
      continue;
    }

    const attempt = acquireDispatchSlot(state, task, now);
    if (attempt === undefined) {
      continue;
    }

    dispatched += 1;
    startWorker(state, deps, task, attempt);
  }
}

async function startTaskIfSupported(
  tasks: Pick<TaskList, "list">,
  task: Task
): Promise<Task> {
  const list = tasks.list(task.list);

  if (!(await list.canFire(task.id, "start"))) {
    return task;
  }

  return list.fire(task.id, "start");
}

async function activeCandidates(
  state: MaestroState,
  tasks: Pick<TaskList, "allTasks">
): Promise<Task[]> {
  const byId = new Map<string, Task>();

  for (const activeState of state.cfg.activeStateNames) {
    for (const task of await tasks.allTasks({ state: activeState })) {
      byId.set(task.qualifiedId, task);
    }
  }

  return [...byId.values()].sort(compareTasks);
}

async function reconcileRetryQueue(
  state: MaestroState,
  deps: TickDeps
): Promise<Array<{ taskId: string; action: "stop_clean" | "stop_keep" | "update" }>> {
  const results: Array<{ taskId: string; action: "stop_clean" | "stop_keep" | "update" }> = [];

  for (const retry of [...state.retry_attempts.values()]) {
    let task: Task;

    try {
      task = await deps.tasks.get(retry.taskId);
    } catch {
      continue;
    }

    if (state.cfg.terminalStateNames.includes(task.state)) {
      await (deps.removeWorkspace ?? defaultRemoveWorkspace)(state.cfg.workspace.root, task.qualifiedId);
      markCompleted(state, retry.taskId);
      results.push({ taskId: retry.taskId, action: "stop_clean" });
      continue;
    }

    if (!state.cfg.activeStateNames.includes(task.state)) {
      release(state, retry.taskId);
      results.push({ taskId: retry.taskId, action: "stop_keep" });
      continue;
    }

    results.push({ taskId: retry.taskId, action: "update" });
  }

  return results;
}

function acquireDispatchSlot(state: MaestroState, task: Task, now: number): number | undefined {
  if (state.completed.has(task.qualifiedId)) {
    return undefined;
  }

  const retry = state.retry_attempts.get(task.qualifiedId);
  if (retry !== undefined) {
    if (retry.dueAt > now) {
      return undefined;
    }

    cancelRetry(state, task.qualifiedId);
    markRunning(state, { taskId: task.qualifiedId, attempt: retry.attempt, task });
    return retry.attempt;
  }

  if (!claim(state, task.qualifiedId)) {
    return undefined;
  }

  markRunning(state, { taskId: task.qualifiedId, attempt: 1, task });
  return 1;
}

function startWorker(
  state: MaestroState,
  deps: TickDeps,
  task: Task,
  attempt: number
): void {
  const controller = new AbortController();
  const promise = (async () => {
    let outcome: AttemptOutcome;
    let workspace: EnsureWorkspaceResult | undefined;
    let activeTask = task;

    try {
      workspace = await (deps.ensureWorkspace ?? defaultEnsureWorkspace)(
        state.cfg.workspace.root,
        task.qualifiedId
      );
      deps.onEvent?.({
        type: "dispatch",
        task_id: task.qualifiedId,
        attempt,
        workspace: workspace.path
      });
      activeTask = await startTaskIfSupported(deps.tasks, task);
      outcome = await (deps.runAttempt ?? defaultRunAttempt)({
        task: activeTask,
        attempt,
        cfg: state.cfg,
        workspaceDir: workspace.path,
        deps: {
          spawn: deps.spawn,
          taskPromptTemplate: deps.taskPromptTemplate,
          refreshTask: (qualifiedId) => deps.tasks.get(qualifiedId),
          onEvent: deps.onEvent,
          reconcile: async ({ task: runningTask }) => {
            const refreshed = await deps.tasks.get(runningTask.qualifiedId);

            if (
              state.cfg.terminalStateNames.includes(refreshed.state) ||
              !state.cfg.activeStateNames.includes(refreshed.state)
            ) {
              return "canceled";
            }

            return "continue";
          }
        },
        abort: controller.signal
      });
    } catch (error) {
      outcome = {
        reason: "abnormal",
        failure: "workspace_error",
        error: error instanceof Error ? error.message : String(error)
      };
    }

    const phase = outcomePhase(outcome);
    deps.onEvent?.({ type: "worker_exit", task_id: activeTask.qualifiedId, attempt, phase, outcome });
    const retryScheduled = scheduleWorkerRetry(
      state,
      deps,
      activeTask.qualifiedId,
      attempt,
      phase,
      outcome
    );

    if (!retryScheduled && outcome.failure === "canceled" && workspace !== undefined) {
      await cleanupTerminalWorkspace(state, deps, activeTask.qualifiedId);
    }
  })();

  deps.trackWorker?.({ taskId: task.qualifiedId, controller, promise });
}

function scheduleWorkerRetry(
  state: MaestroState,
  deps: TickDeps,
  taskId: string,
  attempt: number,
  phase: Extract<AttemptPhase, "succeeded" | "failed" | "canceled">,
  outcome: AttemptOutcome
): boolean {
  const decision = shouldRetry(phase, outcome.failure);
  if (!decision.retry) {
    release(state, taskId);
    return false;
  }

  const nextAttempt = attempt + 1;
  const delayMs =
    decision.kind === "continuation"
      ? decision.delayMs
      : backoffMs(attempt, state.cfg.agent.maxRetryBackoffMs);
  const dueAt = (deps.now?.() ?? Date.now()) + delayMs;

  scheduleRetry(state, { taskId, attempt: nextAttempt, dueAt });
  deps.onEvent?.({ type: "retry_scheduled", task_id: taskId, attempt: nextAttempt, due_at: dueAt });
  return true;
}

async function cleanupTerminalWorkspace(
  state: MaestroState,
  deps: TickDeps,
  taskId: string
): Promise<void> {
  let task: Task;

  try {
    task = await deps.tasks.get(taskId);
  } catch {
    return;
  }

  if (!state.cfg.terminalStateNames.includes(task.state)) {
    return;
  }

  await (deps.removeWorkspace ?? defaultRemoveWorkspace)(state.cfg.workspace.root, task.qualifiedId);
  markCompleted(state, taskId);
  deps.onEvent?.({ type: "reconcile", task_id: taskId, action: "stop_clean" });
}

function outcomePhase(
  outcome: AttemptOutcome
): Extract<AttemptPhase, "succeeded" | "failed" | "canceled"> {
  if (outcome.reason === "normal") {
    return "succeeded";
  }

  return outcome.failure === "canceled" ? "canceled" : "failed";
}

function compareTasks(left: Task, right: Task): number {
  return (
    comparePriority(left.metadata.priority, right.metadata.priority) ||
    String(left.metadata.createdAt ?? "").localeCompare(String(right.metadata.createdAt ?? "")) ||
    left.qualifiedId.localeCompare(right.qualifiedId)
  );
}

function comparePriority(left: unknown, right: unknown): number {
  const leftPriority = typeof left === "number" && Number.isFinite(left) ? left : null;
  const rightPriority = typeof right === "number" && Number.isFinite(right) ? right : null;

  if (leftPriority === null && rightPriority === null) {
    return 0;
  }

  if (leftPriority === null) {
    return 1;
  }

  if (rightPriority === null) {
    return -1;
  }

  return leftPriority - rightPriority;
}
