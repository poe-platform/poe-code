import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenTaskListOptions, TaskList } from "@poe-code/task-list";

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

  it("emits tick_started without checking task existence for a no-op transition", async () => {
    writeWorkflow();
    const taskList = createMockTaskList({ stateMachine: maestroTaskStateMachine });
    const events: MaestroEvent[] = [];

    await expect(
      runMaestroTick({
        configPath: "/repo/WORKFLOW.md",
        task: "maestro/missing",
        transition: "queued:agent-running",
        openTaskList: async () => taskList,
        now: () => new Date("2026-01-01T00:00:00.000Z"),
        onEvent: (event) => events.push(event)
      })
    ).resolves.toBeUndefined();
    expect(taskList.events).toEqual([]);
    expect(events).toEqual([{ type: "tick_started", at: "2026-01-01T00:00:00.000Z" }]);
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
    expect(taskList.events).toEqual([]);
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
    expect(taskList.events).toEqual([]);
  });

  it("emits one tick_started event for a valid transition", async () => {
    writeWorkflow();
    const taskList = createMockTaskList({
      stateMachine: maestroTaskStateMachine,
      tasks: [createTask({ qualifiedId: "maestro/one", state: "agent-running" })]
    });
    const openTaskList = vi.fn(async (_options: OpenTaskListOptions) => taskList);
    const events: MaestroEvent[] = [];

    await runMaestroTick({
      configPath: "/repo/WORKFLOW.md",
      task: "maestro/one",
      transition: "agent-running:done",
      openTaskList,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      onEvent: (event) => events.push(event)
    });

    expect(openTaskList).not.toHaveBeenCalled();
    expect(taskList.events).toEqual([]);
    expect(events).toEqual([{ type: "tick_started", at: "2026-01-01T00:00:00.000Z" }]);
  });

  it("advances a gh-issues queued trigger to agent-running and exits cleanly", async () => {
    writeGhIssuesWorkflow();
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const taskList = createGhIssuesTickTaskList("octo-org/7", calls);
    const events: MaestroEvent[] = [];

    await expect(
      runMaestroTick({
        configPath: "/repo/WORKFLOW.md",
        task: "octo-org/7#482",
        transition: "*:queued",
        openTaskList: async () => taskList,
        now: () => new Date("2026-01-01T00:00:00.000Z"),
        onEvent: (event) => events.push(event)
      })
    ).resolves.toBeUndefined();

    expect(taskList.get).not.toHaveBeenCalled();
    expect(calls).toEqual([{ method: "fire", args: ["482", "agent-running"] }]);
    expect(events).toEqual([{ type: "tick_started", at: "2026-01-01T00:00:00.000Z" }]);
  });

  it("does not dispatch for a non-queued transition and exits cleanly", async () => {
    writeWorkflow();
    const taskList = createMockTaskList({
      stateMachine: maestroTaskStateMachine,
      tasks: [createTask({ qualifiedId: "maestro/one", state: "agent-running" })]
    });
    const events: MaestroEvent[] = [];

    await expect(
      runMaestroTick({
        configPath: "/repo/WORKFLOW.md",
        task: "maestro/one",
        transition: "agent-running:done",
        openTaskList: async () => taskList,
        now: () => new Date("2026-01-01T00:00:00.000Z"),
        onEvent: (event) => events.push(event)
      })
    ).resolves.toBeUndefined();
    expect(taskList.events).toEqual([]);
    expect(events).toEqual([{ type: "tick_started", at: "2026-01-01T00:00:00.000Z" }]);
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

function writeGhIssuesWorkflow(): void {
  vol.fromJSON({
    "/repo/WORKFLOW.md": [
      "---",
      "tasks:",
      "  type: gh-issues",
      "  repo: octo-org/octo-repo",
      "  project:",
      "    owner: octo-org",
      "    number: 7",
      "states:",
      "  queued:",
      "    prompt: Work",
      "  agent-running:",
      "    prompt: Continue",
      "  done:",
      "    terminal: true",
      "agent:",
      "  list: octo-org/7",
      "---",
      "",
      "Work on {{ task.name }}."
    ].join("\n")
  });
}

function createGhIssuesTickTaskList(
  expectedList: string,
  calls: Array<{ method: string; args: unknown[] }>
): TaskList {
  return {
    list(name) {
      expect(name).toBe(expectedList);
      return {
        name,
        stateMachine: maestroTaskStateMachine,
        all: async (filter) => unexpectedBackendCall(calls, "all", [filter]),
        get: async (id) => unexpectedBackendCall(calls, "get", [id]),
        create: async (input) => unexpectedBackendCall(calls, "create", [input]),
        update: async (id, patch) => unexpectedBackendCall(calls, "update", [id, patch]),
        fire: async (id: string, event: string) => {
          calls.push({ method: "fire", args: [id, event] });
          return createTask({
            qualifiedId: `${expectedList}#${id}`,
            id,
            list: expectedList,
            state: event
          });
        },
        canFire: async (id, event) => unexpectedBackendCall(calls, "canFire", [id, event]),
        events: async (id) => unexpectedBackendCall(calls, "events", [id]),
        delete: async (id) => unexpectedBackendCall(calls, "delete", [id]),
        move: async (id, anchor) => unexpectedBackendCall(calls, "move", [id, anchor]),
        reorder: async (ids) => unexpectedBackendCall(calls, "reorder", [ids])
      };
    },
    lists: vi.fn(),
    allTasks: vi.fn(),
    get: vi.fn(),
    moveBetweenLists: vi.fn()
  };
}

function unexpectedBackendCall(
  calls: Array<{ method: string; args: unknown[] }>,
  method: string,
  args: unknown[]
): never {
  calls.push({ method, args });
  throw new Error(`Unexpected gh-issues backend call: ${method}`);
}
