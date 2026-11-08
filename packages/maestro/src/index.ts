import path from "node:path";
import { spawn as defaultSpawn } from "@poe-code/agent-spawn";
import { openTaskList, type Task, type TaskList } from "@poe-code/task-list";

import { loadWorkflow } from "./config/load.js";
import { resolveConfig, type ResolvedConfig } from "./config/schema.js";
import { resolveConfiguredTaskListOptions } from "./config/task-list.js";
import { validateDispatch } from "./config/validate.js";
import { resolveWorkflowKind } from "./drivers/kind.js";
import { getDriver } from "./drivers/registry.js";
import { reconcileRunning as defaultReconcileRunning } from "./runtime/reconcile.js";
import type { AttemptPhase, FailureCategory } from "./runtime/phases.js";
import { createState, release, type RunningEntry } from "./runtime/state.js";
import { tick, type TickEvent, type TrackedWorker } from "./runtime/loop.js";
import { removeWorkspace, startupTerminalCleanup } from "./workspace/manager.js";
import { resolveWorkflowPath } from "./workflow-path.js";
import "./drivers/index.js";

export interface Logger {
  info?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
}

export interface RunMaestroOptions {
  workflowPath?: string;
  name?: string;
  maxConcurrent?: number;
  pollIntervalMs?: number;
  list?: string;
  dryRun?: boolean;
  yes?: boolean;
  logLevel?: "trace" | "debug" | "info" | "warn" | "error";
  onEvent?: (e: MaestroEvent) => void;
  taskList?: TaskList;
  agentSpawn?: typeof defaultSpawn;
  logger?: Logger;
}

export type MaestroEvent =
  | { type: "tick_started"; at: string }
  | { type: "task_skipped"; task_id: string; reason: "unsupported_kind"; kind: string }
  | { type: "dispatch"; task_id: string; qualified_id: string; workspace: string }
  | {
      type: "attempt_phase";
      task_id: string;
      from: AttemptPhase | null;
      to: AttemptPhase;
      step?: string;
      failure?: FailureCategory;
    }
  | {
      type: "agent_event";
      task_id: string;
      step: string;
      session_id: string;
      event: string;
      payload?: unknown;
    }
  | {
      type: "worker_exit";
      task_id: string;
      reason: "normal" | "abnormal" | "skip";
      skipReason?: "terminal_state" | "unconfigured_state";
      failure?: FailureCategory;
      failedStep?: string;
      error?: string;
    }
  | { type: "unconfigured_state"; task_id: string; state: string }
  | { type: "reconcile"; task_id: string; action: "stop_clean" | "stop_keep" | "update" }
  | { type: "retry_scheduled"; task_id: string; attempt: number; due_in_ms: number }
  | { type: "validation_failed"; reason: string };

const STOP_BUDGET_MS = 10_000;

export async function runMaestro(opts: RunMaestroOptions = {}): Promise<() => Promise<void>> {
  if (opts.workflowPath !== undefined && opts.name !== undefined) {
    throw new Error("Cannot specify both workflowPath and name for Maestro.");
  }

  const workflowPath = opts.workflowPath ?? resolveWorkflowPath(opts.name, process.cwd());
  const workflow = await loadWorkflow(workflowPath);
  const cfg = applyOptionOverrides(
    resolveConfig(workflow.config, path.dirname(workflow.sourcePath)),
    opts
  );
  const logger = createLevelLogger(opts.logger ?? {}, opts.logLevel ?? "info");

  if (opts.dryRun === true) {
    await runDryRun(cfg, opts, logger);
    return async () => undefined;
  }

  let stopped = false;
  let activeTick: Promise<void> = Promise.resolve();
  let activeTickController: AbortController | undefined;
  const workers = new Map<string, TrackedWorker>();

  const taskList = opts.taskList ?? (await openConfiguredTaskList(cfg));
  const terminalTasks = await collectTerminalTaskIds(taskList, cfg.terminalStateNames);
  await startupTerminalCleanup(cfg.workspace.root, terminalTasks);
  const state = createState(cfg);

  const runTick = (): Promise<void> => {
    if (stopped) {
      return Promise.resolve();
    }

    activeTick = activeTick
      .catch(() => undefined)
      .then(async () => {
        const tickController = new AbortController();
        activeTickController = tickController;

        try {
          if (stopped || tickController.signal.aborted) {
            return;
          }

          await tick(state, {
            tasks: taskList,
            spawn: opts.agentSpawn,
            taskPromptTemplate: workflow.promptTemplate,
            logger,
            abort: tickController.signal,
            trackWorker: (worker) => {
              workers.set(worker.taskId, worker);
              void worker.promise.finally(() => {
                workers.delete(worker.taskId);
              });
            },
            reconcileRunning: (currentState) =>
              defaultReconcileRunning(currentState, {
                tasks: taskList,
                stopWorker: async (entry, action) => {
                  if (action === "stop_clean") {
                    workers.get(entry.taskId)?.controller.abort();
                  }
                },
                removeWorkspace,
                logger,
                onEvent: (event) => {
                  const mapped = mapReconcileEvent(event);
                  if (mapped !== undefined) {
                    opts.onEvent?.(mapped);
                  }
                }
              }),
            removeWorkspace,
            onEvent: (event) => {
              const mapped = mapTickEvent(event);
              if (mapped !== undefined) {
                opts.onEvent?.(mapped);
              }
            }
          });
        } finally {
          if (activeTickController === tickController) {
            activeTickController = undefined;
          }
        }
      })
      .catch((error) => {
        logger.error?.("maestro tick failed", { error: errorMessage(error) });
      });

    return activeTick;
  };

  const timer = setInterval(() => {
    void runTick();
  }, cfg.polling.intervalMs);

  return async () => {
    if (stopped) {
      return;
    }

    stopped = true;
    clearInterval(timer);
    activeTickController?.abort();

    try {
      await activeTick.catch(() => undefined);

      for (const worker of workers.values()) {
        worker.controller.abort();
      }

      await withBudget(
        Promise.allSettled([...workers.values()].map((worker) => worker.promise)),
        STOP_BUDGET_MS
      );
      await cleanupRunningWorkspaces(state.running, cfg, logger);
    } finally {
      for (const taskId of [...state.running.keys()]) {
        release(state, taskId);
      }
      workers.clear();
    }
  };
}

function applyOptionOverrides(cfg: ResolvedConfig, opts: RunMaestroOptions): ResolvedConfig {
  return {
    ...cfg,
    polling: {
      ...cfg.polling,
      intervalMs: opts.pollIntervalMs ?? cfg.polling.intervalMs
    },
    agent: {
      ...cfg.agent,
      list: opts.list ?? cfg.agent.list,
      maxConcurrentAgents: opts.maxConcurrent ?? cfg.agent.maxConcurrentAgents
    }
  };
}

async function runDryRun(
  cfg: ResolvedConfig,
  opts: RunMaestroOptions,
  logger: Logger
): Promise<void> {
  const taskList = opts.taskList ?? (await openConfiguredTaskList(cfg));
  const validation = await validateDispatch(cfg, taskList);

  if (!validation.ok) {
    opts.onEvent?.({ type: "validation_failed", reason: validation.code });
    throw new Error(`Maestro dry-run validation failed: ${validation.code}`);
  }

  const candidates = await collectActiveCandidates(cfg, taskList);
  const unsupported = summarizeUnsupportedCandidates(candidates);
  logger.info?.("maestro config OK", {
    tasks: cfg.tasks?.type,
    list: cfg.agent.list
  });
  logger.info?.("maestro task store open OK", {
    candidates: candidates.length,
    candidateIds: candidates.map((task) => task.qualifiedId),
    skipped: unsupported.skipped,
    skippedKinds: unsupported.kinds
  });
  logger.info?.("maestro dry-run complete");
}

async function collectActiveCandidates(
  cfg: ResolvedConfig,
  taskList: Pick<TaskList, "allTasks">
): Promise<Task[]> {
  const byId = new Map<string, Task>();

  for (const activeState of cfg.activeStateNames) {
    for (const task of await taskList.allTasks({ state: activeState })) {
      byId.set(task.qualifiedId, task);
    }
  }

  return [...byId.values()].sort((a, b) => a.qualifiedId.localeCompare(b.qualifiedId));
}

function summarizeUnsupportedCandidates(tasks: Task[]): { skipped: number; kinds: string[] } {
  const kinds = new Set<string>();
  let skipped = 0;

  for (const task of tasks) {
    const kind = resolveWorkflowKind(task);
    if (getDriver(kind) !== undefined) {
      continue;
    }

    skipped += 1;
    kinds.add(kind);
  }

  return { skipped, kinds: [...kinds].sort() };
}

const logLevelPriority = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50
} satisfies Record<NonNullable<RunMaestroOptions["logLevel"]>, number>;

function createLevelLogger(
  logger: Logger,
  logLevel: NonNullable<RunMaestroOptions["logLevel"]>
): Logger {
  const enabled = (level: keyof Logger): boolean =>
    logLevelPriority[level] >= logLevelPriority[logLevel];

  return {
    info: enabled("info") ? logger.info?.bind(logger) : undefined,
    warn: enabled("warn") ? logger.warn?.bind(logger) : undefined,
    error: enabled("error") ? logger.error?.bind(logger) : undefined
  };
}

async function openConfiguredTaskList(
  cfg: Pick<ResolvedConfig, "tasks" | "stateOrder" | "terminalStateNames">
): Promise<TaskList> {
  return openTaskList(resolveConfiguredTaskListOptions(cfg));
}

async function collectTerminalTaskIds(
  taskList: Pick<TaskList, "allTasks">,
  terminalStates: readonly string[]
): Promise<string[]> {
  const ids = new Set<string>();

  for (const state of terminalStates) {
    for (const task of await taskList.allTasks({ state })) {
      ids.add(task.qualifiedId);
    }
  }

  return [...ids];
}

async function cleanupRunningWorkspaces(
  running: Map<string, RunningEntry>,
  cfg: ResolvedConfig,
  logger: Logger
): Promise<void> {
  await withBudget(
    Promise.allSettled(
      [...running.values()].map(async (entry) => {
        const taskId = entry.task?.qualifiedId ?? entry.taskId;

        try {
          await removeWorkspace(cfg.workspace.root, taskId);
        } catch (error) {
          logger.warn?.("maestro workspace cleanup failed", {
            taskId: entry.taskId,
            error: errorMessage(error)
          });
        }
      })
    ),
    STOP_BUDGET_MS
  );
}

async function withBudget<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      })
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function mapTickEvent(event: TickEvent): MaestroEvent | undefined {
  switch (event.type) {
    case "tick_started":
      return { type: "tick_started", at: new Date().toISOString() };
    case "task_skipped":
      return event;
    case "dispatch":
      return {
        type: "dispatch",
        task_id: event.task_id,
        qualified_id: event.task_id,
        workspace: event.workspace
      };
    case "attempt_phase":
      return event;
    case "agent_event":
      return event;
    case "unconfigured_state":
      return event;
    case "worker_exit":
      return {
        type: "worker_exit",
        task_id: event.task_id,
        reason: event.outcome.reason,
        skipReason: event.outcome.skipReason,
        failure: event.outcome.failure,
        failedStep: event.outcome.failedStep,
        error: event.outcome.error
      };
    case "reconcile":
      if (event.action === "refresh_failed") {
        return undefined;
      }
      return {
        type: "reconcile",
        task_id: event.task_id,
        action: event.action
      };
    case "retry_scheduled":
      return {
        type: "retry_scheduled",
        task_id: event.task_id,
        attempt: event.attempt,
        due_in_ms: Math.max(0, event.due_at - Date.now())
      };
    case "validation_failed":
      return { type: "validation_failed", reason: event.result.code };
  }
}

function mapReconcileEvent(event: {
  type: "reconcile";
  task_id: string;
  action: "stop_clean" | "stop_keep" | "update" | "refresh_failed";
}): MaestroEvent | undefined {
  if (event.action === "refresh_failed") {
    return undefined;
  }

  return {
    type: "reconcile",
    task_id: event.task_id,
    action: event.action
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export {
  ATTEMPT_TRANSITIONS,
  transitionPhase,
  type AttemptPhase,
  type AttemptState,
  type FailureCategory
} from "./runtime/phases.js";
export {
  backoffMs,
  CONTINUATION_DELAY_MS,
  shouldRetry,
  type RetryContext,
  type RetryDecision
} from "./runtime/retry.js";
export { sanitizeWorkspaceKey } from "./runtime/sanitize.js";
export {
  cancelRetry,
  claim,
  createState,
  markCompleted,
  markRunning,
  release,
  scheduleRetry,
  type MaestroState,
  type RetryEntry,
  type RunningEntry
} from "./runtime/state.js";

export {
  reconcileRunning,
  type ReconcileAction,
  type ReconcileDeps,
  type ReconcileResult
} from "./runtime/reconcile.js";
export { tick, type TickDeps, type TickEvent } from "./runtime/loop.js";
export {
  maestroTaskStateMachine,
  type MaestroTaskEvent,
  type MaestroTaskState
} from "./state-machine.js";
export {
  loadWorkflow,
  WorkflowLoadError,
  type WorkflowDefinition,
  type WorkflowLoadErrorCode
} from "./config/load.js";
export { resolveConfig, type ResolvedConfig } from "./config/schema.js";
export { resolveConfiguredTaskListOptions } from "./config/task-list.js";
export {
  validateDispatch,
  type DispatchPreflightCode,
  type DispatchValidationResult
} from "./config/validate.js";
export { renderStepPrompt, renderTaskPrompt } from "./prompt/render.js";
export { resolveWorkflowPath } from "./workflow-path.js";
export { runMaestroTick, type RunMaestroTickOptions } from "./tick-command.js";
export {
  runAttempt,
  type AttemptDeps,
  type AttemptEvent,
  type AttemptOutcome,
  type AttemptReconcileResult
} from "./agent/runner.js";
export { getDriver, listDrivers, registerDriver } from "./drivers/registry.js";
export { type WorkflowDriver, type WorkflowDriverContext } from "./drivers/types.js";
export { harnessDriver, superintendentDriver } from "./drivers/index.js";
export {
  ensureWorkspace,
  removeWorkspace,
  startupTerminalCleanup,
  type EnsureWorkspaceResult
} from "./workspace/manager.js";
