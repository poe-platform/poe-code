import { describe, expect, it, vi } from "vitest";

import { createConfig, createTask } from "../__test_utils__/fixtures.js";
import { createMockTaskList } from "../__test_utils__/mock-task-list.js";
import { createState, markRunning } from "./state.js";
import { reconcileRunning } from "./reconcile.js";

const reconcileConfig = createConfig({
  states: {
    queued: { prompt: "Plan {{ prompt }}" },
    "agent-running": { prompt: "Implement {{ prompt }}" },
    done: { terminal: true },
    failed: { terminal: true },
    archived: { terminal: true }
  },
  workspace: { root: "/repo/workspaces" }
});

describe("reconcileRunning", () => {
  it("stops cleanly when a running task moves to terminal mid-attempt", async () => {
    const taskList = createMockTaskList({
      tasks: [task("terminal", "agent-running")]
    });
    const runningTask = await taskList.get("tasks/terminal");
    taskList.mutate((store) => {
      store.set({ ...store.get("tasks/terminal"), state: "done" });
    });
    const state = createState(reconcileConfig);
    markRunning(state, { taskId: runningTask.qualifiedId, attempt: 1, task: runningTask });
    const controller = new AbortController();
    const stopWorker = vi.fn(() => controller.abort());
    const removeWorkspace = vi.fn(async () => undefined);

    await expect(
      reconcileRunning(state, { tasks: taskList, stopWorker, removeWorkspace })
    ).resolves.toEqual([{ taskId: "tasks/terminal", action: "stop_clean" }]);

    expect(stopWorker).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "tasks/terminal" }),
      "stop_clean"
    );
    expect(controller.signal.aborted).toBe(true);
    expect(removeWorkspace).toHaveBeenCalledWith("/repo/workspaces", "tasks/terminal");
    expect(state.running.has("tasks/terminal")).toBe(false);
    expect(state.claimed.has("tasks/terminal")).toBe(false);
    expect(state.completed.has("tasks/terminal")).toBe(true);
  });

  it("updates the running snapshot when a running task moves to another active state", async () => {
    const taskList = createMockTaskList({
      tasks: [task("active", "queued")]
    });
    const runningTask = await taskList.get("tasks/active");
    taskList.mutate((store) => {
      store.set({ ...store.get("tasks/active"), name: "After", state: "agent-running" });
    });
    const updatedTask = await taskList.get("tasks/active");
    const state = createState(reconcileConfig);
    markRunning(state, { taskId: runningTask.qualifiedId, attempt: 2, task: runningTask });
    const stopWorker = vi.fn();
    const removeWorkspace = vi.fn(async () => undefined);

    await expect(
      reconcileRunning(state, { tasks: taskList, stopWorker, removeWorkspace })
    ).resolves.toEqual([{ taskId: "tasks/active", action: "update" }]);

    expect(state.running.get("tasks/active")).toEqual({
      taskId: "tasks/active",
      attempt: 2,
      task: updatedTask
    });
    expect(stopWorker).not.toHaveBeenCalled();
    expect(removeWorkspace).not.toHaveBeenCalled();
  });

  it("treats a running task that disappeared from the backend as stop_clean", async () => {
    const taskList = createMockTaskList({
      tasks: [task("missing", "agent-running")]
    });
    const runningTask = await taskList.get("tasks/missing");
    await taskList.list("tasks").delete("missing");
    const state = createState(reconcileConfig);
    markRunning(state, { taskId: runningTask.qualifiedId, attempt: 1, task: runningTask });
    const stopWorker = vi.fn();
    const removeWorkspace = vi.fn(async () => undefined);

    await expect(
      reconcileRunning(state, { tasks: taskList, stopWorker, removeWorkspace })
    ).resolves.toEqual([{ taskId: "tasks/missing", action: "stop_clean" }]);

    expect(stopWorker).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "tasks/missing" }),
      "stop_clean"
    );
    expect(removeWorkspace).toHaveBeenCalledWith("/repo/workspaces", "tasks/missing");
    expect(state.running.has("tasks/missing")).toBe(false);
    expect(state.claimed.has("tasks/missing")).toBe(false);
    expect(state.completed.has("tasks/missing")).toBe(true);
  });

  it("emits refresh_failed and keeps the worker running when refresh throws a non-TaskNotFoundError", async () => {
    const taskList = createMockTaskList({
      tasks: [task("refresh-fails", "agent-running")],
      failures: {
        getError: (taskId) =>
          taskId === "tasks/refresh-fails" ? new Error("network unavailable") : undefined
      }
    });
    const state = createState(reconcileConfig);
    markRunning(state, {
      taskId: "tasks/refresh-fails",
      attempt: 1,
      task: task("refresh-fails", "agent-running")
    });
    const stopWorker = vi.fn();
    const removeWorkspace = vi.fn(async () => undefined);
    const onEvent = vi.fn();

    await expect(
      reconcileRunning(state, { tasks: taskList, stopWorker, removeWorkspace, onEvent })
    ).resolves.toEqual([{ taskId: "tasks/refresh-fails", action: "refresh_failed" }]);

    expect(onEvent).toHaveBeenCalledWith({
      type: "reconcile",
      task_id: "tasks/refresh-fails",
      action: "refresh_failed"
    });
    expect(stopWorker).not.toHaveBeenCalled();
    expect(removeWorkspace).not.toHaveBeenCalled();
    expect(state.running.has("tasks/refresh-fails")).toBe(true);
    expect(state.claimed.has("tasks/refresh-fails")).toBe(true);
  });

  it("logs and continues when workspace removal fails during stop_clean", async () => {
    const taskList = createMockTaskList({
      tasks: [task("cleanup-fails", "done"), task("cleanup-continues", "done")]
    });
    const state = createState(reconcileConfig);
    markRunning(state, {
      taskId: "tasks/cleanup-fails",
      attempt: 1,
      task: task("cleanup-fails", "agent-running")
    });
    markRunning(state, {
      taskId: "tasks/cleanup-continues",
      attempt: 1,
      task: task("cleanup-continues", "agent-running")
    });
    const stopWorker = vi.fn();
    const removeWorkspace = vi.fn(async (_root: string, qualifiedId: string) => {
      if (qualifiedId === "tasks/cleanup-fails") {
        throw new Error("rm failed");
      }
    });
    const logger = { warn: vi.fn() };

    await expect(
      reconcileRunning(state, { tasks: taskList, stopWorker, removeWorkspace, logger })
    ).resolves.toEqual([
      { taskId: "tasks/cleanup-fails", action: "stop_clean" },
      { taskId: "tasks/cleanup-continues", action: "stop_clean" }
    ]);

    expect(logger.warn).toHaveBeenCalledWith("maestro workspace cleanup failed", {
      taskId: "tasks/cleanup-fails",
      error: "rm failed"
    });
    expect(removeWorkspace).toHaveBeenCalledWith("/repo/workspaces", "tasks/cleanup-fails");
    expect(removeWorkspace).toHaveBeenCalledWith("/repo/workspaces", "tasks/cleanup-continues");
    expect(state.running.has("tasks/cleanup-fails")).toBe(false);
    expect(state.running.has("tasks/cleanup-continues")).toBe(false);
    expect(state.completed.has("tasks/cleanup-fails")).toBe(true);
    expect(state.completed.has("tasks/cleanup-continues")).toBe(true);
  });

  it("stops only the terminal task when another running task stays active", async () => {
    const taskList = createMockTaskList({
      tasks: [task("done", "done"), task("active", "agent-running")]
    });
    const state = createState(reconcileConfig);
    markRunning(state, {
      taskId: "tasks/done",
      attempt: 1,
      task: task("done", "agent-running")
    });
    markRunning(state, {
      taskId: "tasks/active",
      attempt: 1,
      task: task("active", "agent-running")
    });
    const stopWorker = vi.fn();
    const removeWorkspace = vi.fn(async () => undefined);

    await expect(
      reconcileRunning(state, { tasks: taskList, stopWorker, removeWorkspace })
    ).resolves.toEqual([
      { taskId: "tasks/done", action: "stop_clean" },
      { taskId: "tasks/active", action: "update" }
    ]);

    expect(stopWorker).toHaveBeenCalledTimes(1);
    expect(stopWorker).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "tasks/done" }),
      "stop_clean"
    );
    expect(removeWorkspace).toHaveBeenCalledTimes(1);
    expect(removeWorkspace).toHaveBeenCalledWith("/repo/workspaces", "tasks/done");
    expect(state.running.has("tasks/done")).toBe(false);
    expect(state.running.has("tasks/active")).toBe(true);
    expect(state.claimed.has("tasks/done")).toBe(false);
    expect(state.claimed.has("tasks/active")).toBe(true);
  });

  it("uses stop_keep for a state that is neither active nor terminal", async () => {
    const taskList = createMockTaskList({
      tasks: [task("review", "human-review")]
    });
    const state = createState(reconcileConfig);
    markRunning(state, {
      taskId: "tasks/review",
      attempt: 1,
      task: task("review", "agent-running")
    });
    const stopWorker = vi.fn();
    const removeWorkspace = vi.fn(async () => undefined);

    await expect(
      reconcileRunning(state, { tasks: taskList, stopWorker, removeWorkspace })
    ).resolves.toEqual([{ taskId: "tasks/review", action: "stop_keep" }]);

    expect(stopWorker).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "tasks/review" }),
      "stop_keep"
    );
    expect(removeWorkspace).not.toHaveBeenCalled();
    expect(state.running.has("tasks/review")).toBe(false);
    expect(state.claimed.has("tasks/review")).toBe(false);
    expect(state.completed.has("tasks/review")).toBe(false);
  });

  it("is idempotent across two consecutive ticks with no backend change", async () => {
    const taskList = createMockTaskList({
      tasks: [task("stable", "agent-running")]
    });
    const state = createState(reconcileConfig);
    markRunning(state, {
      taskId: "tasks/stable",
      attempt: 1,
      task: task("stable", "agent-running")
    });
    const stopWorker = vi.fn();
    const removeWorkspace = vi.fn(async () => undefined);

    const first = await reconcileRunning(state, { tasks: taskList, stopWorker, removeWorkspace });
    const firstRunning = state.running.get("tasks/stable");
    const second = await reconcileRunning(state, { tasks: taskList, stopWorker, removeWorkspace });

    expect(first).toEqual([{ taskId: "tasks/stable", action: "update" }]);
    expect(second).toEqual([{ taskId: "tasks/stable", action: "update" }]);
    expect(state.running.get("tasks/stable")).toEqual(firstRunning);
    expect(state.claimed.has("tasks/stable")).toBe(true);
    expect(state.completed.has("tasks/stable")).toBe(false);
    expect(stopWorker).not.toHaveBeenCalled();
    expect(removeWorkspace).not.toHaveBeenCalled();
  });
});

function task(id: string, state: string) {
  return createTask({
    qualifiedId: `tasks/${id}`,
    name: id,
    state
  });
}
