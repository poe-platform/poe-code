import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { openTaskList, TaskNotFoundError } from "@poe-code/task-list";
import type { TaskList, TaskListFs } from "@poe-code/task-list";

import { createState, markRunning } from "./state.js";
import { reconcileRunning } from "./reconcile.js";
import type { ResolvedConfig } from "../config/schema.js";

describe("reconcileRunning", () => {
  it("kills the worker, removes the workspace, and releases the claim for terminal tasks", async () => {
    const taskList = await openTasks();
    const tasks = taskList.list("tasks");
    const task = await tasks.create({ id: "done", name: "Done" });
    await tasks.fire("done", "plan");
    await tasks.fire("done", "start");
    await tasks.fire("done", "complete");
    const state = createState(createConfig());
    markRunning(state, { taskId: task.qualifiedId, attempt: 1, task });
    const stopWorker = vi.fn();
    const removeWorkspace = vi.fn();

    await reconcileRunning(state, { tasks: taskList, stopWorker, removeWorkspace });

    expect(stopWorker).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "tasks/done" }),
      "stop_clean"
    );
    expect(removeWorkspace).toHaveBeenCalledWith("/repo/workspaces", "tasks/done");
    expect(state.running.has("tasks/done")).toBe(false);
    expect(state.claimed.has("tasks/done")).toBe(false);
    expect(state.completed.has("tasks/done")).toBe(true);
  });

  it("updates the running snapshot for active tasks", async () => {
    const taskList = await openTasks();
    const tasks = taskList.list("tasks");
    const task = await tasks.create({ id: "active", name: "Before" });
    await tasks.fire("active", "plan");
    const updated = await tasks.update("active", { name: "After" });
    const state = createState(createConfig());
    markRunning(state, { taskId: task.qualifiedId, attempt: 2, task });
    const stopWorker = vi.fn();
    const removeWorkspace = vi.fn();

    await expect(
      reconcileRunning(state, { tasks: taskList, stopWorker, removeWorkspace })
    ).resolves.toEqual([{ taskId: "tasks/active", action: "update" }]);

    expect(state.running.get("tasks/active")).toEqual({
      taskId: "tasks/active",
      attempt: 2,
      task: updated
    });
    expect(stopWorker).not.toHaveBeenCalled();
    expect(removeWorkspace).not.toHaveBeenCalled();
  });

  it("kills the worker, keeps the workspace, and releases the claim for intermediate tasks", async () => {
    const taskList = await openTasks();
    const tasks = taskList.list("tasks");
    const task = await tasks.create({ id: "draft", name: "Draft" });
    const state = createState(createConfig());
    markRunning(state, { taskId: task.qualifiedId, attempt: 1, task });
    const stopWorker = vi.fn();
    const removeWorkspace = vi.fn();

    await reconcileRunning(state, { tasks: taskList, stopWorker, removeWorkspace });

    expect(stopWorker).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "tasks/draft" }),
      "stop_keep"
    );
    expect(removeWorkspace).not.toHaveBeenCalled();
    expect(state.running.has("tasks/draft")).toBe(false);
    expect(state.claimed.has("tasks/draft")).toBe(false);
    expect(state.completed.has("tasks/draft")).toBe(false);
  });

  it("treats TaskNotFoundError as terminal", async () => {
    const taskList = await openTasks();
    const state = createState(createConfig());
    markRunning(state, { taskId: "tasks/missing", attempt: 1 });
    const stopWorker = vi.fn();
    const removeWorkspace = vi.fn();

    await reconcileRunning(state, { tasks: taskList, stopWorker, removeWorkspace });

    expect(stopWorker).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "tasks/missing" }),
      "stop_clean"
    );
    expect(removeWorkspace).toHaveBeenCalledWith("/repo/workspaces", "tasks/missing");
    expect(state.running.has("tasks/missing")).toBe(false);
    expect(state.claimed.has("tasks/missing")).toBe(false);
    expect(state.completed.has("tasks/missing")).toBe(true);
  });

  it("keeps workers running when refresh fails", async () => {
    const taskList = await openTasks();
    const tasks = taskList.list("tasks");
    const task = await tasks.create({ id: "active", name: "Active" });
    await tasks.fire("active", "plan");
    const state = createState(createConfig());
    markRunning(state, { taskId: task.qualifiedId, attempt: 1, task });
    const stopWorker = vi.fn();
    const removeWorkspace = vi.fn();

    await expect(
      reconcileRunning(state, {
        tasks: {
          get: async () => {
            throw new Error("network unavailable");
          }
        },
        stopWorker,
        removeWorkspace
      })
    ).resolves.toEqual([{ taskId: "tasks/active", action: "refresh_failed" }]);

    expect(stopWorker).not.toHaveBeenCalled();
    expect(removeWorkspace).not.toHaveBeenCalled();
    expect(state.running.has("tasks/active")).toBe(true);
    expect(state.claimed.has("tasks/active")).toBe(true);
  });

  it("refreshes every running id in a tick when outcomes are mixed", async () => {
    const taskList = await openTasks();
    const tasks = taskList.list("tasks");
    const terminal = await tasks.create({ id: "terminal", name: "Terminal" });
    await tasks.fire("terminal", "plan");
    await tasks.fire("terminal", "start");
    await tasks.fire("terminal", "complete");
    const active = await tasks.create({ id: "active", name: "Before" });
    await tasks.fire("active", "plan");
    const updatedActive = await tasks.update("active", { name: "After" });
    const intermediate = await tasks.create({ id: "intermediate", name: "Intermediate" });
    const failed = await tasks.create({ id: "failed-refresh", name: "Failed refresh" });
    await tasks.fire("failed-refresh", "plan");
    const state = createState(createConfig());
    markRunning(state, { taskId: terminal.qualifiedId, attempt: 1, task: terminal });
    markRunning(state, { taskId: active.qualifiedId, attempt: 1, task: active });
    markRunning(state, { taskId: intermediate.qualifiedId, attempt: 1, task: intermediate });
    markRunning(state, { taskId: failed.qualifiedId, attempt: 1, task: failed });
    const stopWorker = vi.fn();
    const removeWorkspace = vi.fn();
    const seenIds: string[] = [];

    await expect(
      reconcileRunning(state, {
        tasks: {
          get: async (id) => {
            seenIds.push(id);

            if (id === "tasks/failed-refresh") {
              throw new Error("auth unavailable");
            }

            return taskList.get(id);
          }
        },
        stopWorker,
        removeWorkspace
      })
    ).resolves.toEqual([
      { taskId: "tasks/terminal", action: "stop_clean" },
      { taskId: "tasks/active", action: "update" },
      { taskId: "tasks/intermediate", action: "stop_keep" },
      { taskId: "tasks/failed-refresh", action: "refresh_failed" }
    ]);

    expect(seenIds).toEqual([
      "tasks/terminal",
      "tasks/active",
      "tasks/intermediate",
      "tasks/failed-refresh"
    ]);
    expect(stopWorker).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "tasks/terminal" }),
      "stop_clean"
    );
    expect(stopWorker).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "tasks/intermediate" }),
      "stop_keep"
    );
    expect(removeWorkspace).toHaveBeenCalledWith("/repo/workspaces", "tasks/terminal");
    expect(state.running.get("tasks/active")).toEqual({
      taskId: "tasks/active",
      attempt: 1,
      task: updatedActive
    });
    expect(state.running.has("tasks/terminal")).toBe(false);
    expect(state.running.has("tasks/intermediate")).toBe(false);
    expect(state.running.has("tasks/failed-refresh")).toBe(true);
    expect(state.claimed.has("tasks/terminal")).toBe(false);
    expect(state.claimed.has("tasks/intermediate")).toBe(false);
    expect(state.claimed.has("tasks/failed-refresh")).toBe(true);
  });

  it("recognizes TaskNotFoundError thrown by an injected task reader", async () => {
    const state = createState(createConfig());
    markRunning(state, { taskId: "tasks/missing", attempt: 1 });
    const stopWorker = vi.fn();
    const removeWorkspace = vi.fn();

    await reconcileRunning(state, {
      tasks: {
        get: async () => {
          throw new TaskNotFoundError();
        }
      },
      stopWorker,
      removeWorkspace
    });

    expect(stopWorker).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "tasks/missing" }),
      "stop_clean"
    );
  });
});

async function openTasks(): Promise<TaskList> {
  const rawFs = createFsFromVolume(Volume.fromJSON({}, "/")).promises;

  return openTaskList({
    type: "markdown-dir",
    path: "/repo/tasks",
    create: true,
    fs: rawFs as unknown as TaskListFs
  });
}

function createConfig(): ResolvedConfig {
  return {
    states: {
      planned: { prompt: "Plan {{ prompt }}" },
      "in-progress": { prompt: "Implement {{ prompt }}" },
      done: { terminal: true },
      archived: { terminal: true }
    },
    activeStateNames: ["planned", "in-progress"],
    terminalStateNames: ["done", "archived"],
    stateOrder: ["planned", "in-progress", "done", "archived"],
    polling: { intervalMs: 30_000 },
    workspace: { root: "/repo/workspaces" },
    agent: {
      service: "codex",
      maxConcurrentAgents: 1,
      maxTurns: 20,
      maxRetryBackoffMs: 300_000
    }
  };
}
