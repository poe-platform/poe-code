import type { Task } from "@poe-code/task-list";

import type { ResolvedConfig } from "../config/schema.js";

export interface RunningEntry {
  taskId: string;
  attempt: number;
  task?: Task;
}

export interface RetryEntry {
  taskId: string;
  attempt: number;
  dueAt: number;
}

export interface MaestroState {
  cfg: ResolvedConfig;
  running: Map<string, RunningEntry>;
  claimed: Set<string>;
  retry_attempts: Map<string, RetryEntry>;
  completed: Set<string>;
}

export function createState(cfg: ResolvedConfig): MaestroState {
  return {
    cfg,
    running: new Map(),
    claimed: new Set(),
    retry_attempts: new Map(),
    completed: new Set()
  };
}

export function claim(state: MaestroState, taskId: string): boolean {
  if (
    state.claimed.has(taskId) ||
    state.retry_attempts.has(taskId) ||
    state.completed.has(taskId)
  ) {
    return false;
  }

  state.claimed.add(taskId);
  return true;
}

export function release(state: MaestroState, taskId: string): void {
  state.claimed.delete(taskId);
  state.running.delete(taskId);
  state.retry_attempts.delete(taskId);
}

export function markRunning(state: MaestroState, entry: RunningEntry): void {
  if (state.completed.has(entry.taskId)) {
    return;
  }

  state.claimed.add(entry.taskId);
  state.retry_attempts.delete(entry.taskId);
  state.running.set(entry.taskId, entry);
}

export function markCompleted(state: MaestroState, taskId: string): void {
  state.completed.add(taskId);
  release(state, taskId);
}

export function scheduleRetry(state: MaestroState, entry: RetryEntry): void {
  if (state.completed.has(entry.taskId)) {
    return;
  }

  state.claimed.delete(entry.taskId);
  state.running.delete(entry.taskId);
  state.retry_attempts.set(entry.taskId, entry);
}

export function cancelRetry(state: MaestroState, taskId: string): void {
  state.retry_attempts.delete(taskId);
}
