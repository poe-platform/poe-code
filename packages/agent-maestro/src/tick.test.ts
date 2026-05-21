import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenTaskListOptions } from "@poe-code/task-list";

import { createMockTaskList, createTask } from "./__test_utils__/index.js";
import { maestroTaskStateMachine, runMaestroTick, type MaestroEvent } from "./index.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    default: fs.promises
  };
});

describe("runMaestroTick", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("rejects an unknown task id before emitting events", async () => {
    writeWorkflow();
    const taskList = createMockTaskList({ stateMachine: maestroTaskStateMachine });
    const events: MaestroEvent[] = [];

    await expect(
      runMaestroTick({
        configPath: "/repo/WORKFLOW.md",
        task: "maestro/missing",
        transition: "queued:agent-running",
        openTaskList: async () => taskList,
        onEvent: (event) => events.push(event)
      })
    ).rejects.toThrow('Task "maestro/missing" not found.');
    expect(events).toEqual([]);
  });

  it("rejects a transition that is not a real maestro state-machine edge", async () => {
    writeWorkflow();
    const taskList = createMockTaskList({
      stateMachine: maestroTaskStateMachine,
      tasks: [createTask({ qualifiedId: "maestro/one", state: "queued" })]
    });
    const events: MaestroEvent[] = [];

    await expect(
      runMaestroTick({
        configPath: "/repo/WORKFLOW.md",
        task: "maestro/one",
        transition: "queued:done",
        openTaskList: async () => taskList,
        onEvent: (event) => events.push(event)
      })
    ).rejects.toThrow('Invalid maestro transition "queued:done".');
    expect(events).toEqual([]);
  });

  it("rejects a malformed transition before emitting events", async () => {
    writeWorkflow();
    const taskList = createMockTaskList({
      stateMachine: maestroTaskStateMachine,
      tasks: [createTask({ qualifiedId: "maestro/one", state: "queued" })]
    });
    const events: MaestroEvent[] = [];

    await expect(
      runMaestroTick({
        configPath: "/repo/WORKFLOW.md",
        task: "maestro/one",
        transition: "queued",
        openTaskList: async () => taskList,
        onEvent: (event) => events.push(event)
      })
    ).rejects.toThrow('Invalid maestro transition "queued". Expected <fromState>:<toState>.');
    expect(events).toEqual([]);
  });

  it("emits one tick_started event for a valid transition", async () => {
    writeWorkflow();
    const taskList = createMockTaskList({
      stateMachine: maestroTaskStateMachine,
      tasks: [createTask({ qualifiedId: "maestro/one", state: "agent-running" })]
    });
    const openedOptions: OpenTaskListOptions[] = [];
    const events: MaestroEvent[] = [];

    await runMaestroTick({
      configPath: "/repo/WORKFLOW.md",
      task: "maestro/one",
      transition: "agent-running:done",
      openTaskList: async (options) => {
        openedOptions.push(options);
        return taskList;
      },
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      onEvent: (event) => events.push(event)
    });

    expect(openedOptions).toEqual([
      expect.objectContaining({
        type: "yaml-file",
        path: "/repo/tasks.yaml"
      })
    ]);
    expect(events).toEqual([{ type: "tick_started", at: "2026-01-01T00:00:00.000Z" }]);
  });

  it("resolves cleanly without creating retry or worker state", async () => {
    writeWorkflow();
    const taskList = createMockTaskList({
      stateMachine: maestroTaskStateMachine,
      tasks: [createTask({ qualifiedId: "maestro/one", state: "queued" })]
    });

    await expect(
      runMaestroTick({
        configPath: "/repo/WORKFLOW.md",
        task: "maestro/one",
        transition: "queued:agent-running",
        openTaskList: async () => taskList
      })
    ).resolves.toBeUndefined();
    expect(taskList.events.map((event) => event.method)).toEqual(["get"]);
  });
});

function writeWorkflow(): void {
  vol.fromJSON({
    "/repo/WORKFLOW.md": [
      "---",
      "tasks:",
      "  type: yaml-file",
      "  path: ./tasks.yaml",
      "states:",
      "  queued:",
      "    prompt: Work",
      "  agent-running:",
      "    prompt: Continue",
      "  human-review:",
      "    prompt: Review",
      "  done:",
      "    terminal: true",
      "  failed:",
      "    terminal: true",
      "  archived:",
      "    terminal: true",
      "agent:",
      "  list: maestro",
      "---",
      "",
      "Work on {{ task.name }}."
    ].join("\n")
  });
}
