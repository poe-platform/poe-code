import { describe, expect, it, vi } from "vitest";
import type { Task, TaskList } from "@poe-code/task-list";
import { buildMaestroExplorerConfig, runMaestroTui } from "./index.js";

function task(): Task {
  return {
    list: "tasks",
    id: "ship",
    qualifiedId: "tasks/ship",
    name: "Ship feature",
    state: "planned",
    description: "Build the thing.",
    metadata: {}
  };
}

function taskList(): TaskList {
  return {
    list: () => ({
      name: "tasks",
      stateMachine: { states: ["draft"], initial: "draft", events: {} },
      all: vi.fn(async () => []),
      get: vi.fn(async () => task()),
      create: vi.fn(async () => task()),
      update: vi.fn(async () => task()),
      fire: vi.fn(async () => task()),
      canFire: vi.fn(async () => true),
      events: vi.fn(async () => []),
      delete: vi.fn(async () => undefined),
      move: vi.fn(async () => task()),
      reorder: vi.fn(async () => [])
    }),
    lists: vi.fn(async () => ["tasks"]),
    allTasks: vi.fn(async () => []),
    get: vi.fn(async () => task()),
    moveBetweenLists: vi.fn(async () => task())
  };
}

describe("maestro-tui public API", () => {
  it("exports the maestro TUI runner", () => {
    expect(runMaestroTui).toBeTypeOf("function");
  });

  it("exports the maestro explorer config builder", async () => {
    const config = buildMaestroExplorerConfig({
      tasks: [],
      taskList: taskList(),
      variables: {},
      onRefresh: async () => []
    });

    await expect(config.rows()).resolves.toEqual([]);
    expect(config.title).toBe("Maestro tasks");
    expect(config.actions).toEqual([
      expect.objectContaining({
        id: "open-source",
        accelerator: "o",
        label: "Open in $EDITOR"
      }),
      expect.objectContaining({
        id: "open-issue",
        accelerator: "g",
        label: "Open issue in browser"
      })
    ]);
    expect(config.emptyHint).toBe("No tasks found");
  });
});
