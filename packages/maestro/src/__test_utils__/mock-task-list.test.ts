import {
  InvalidTransitionError,
  TaskAlreadyExistsError,
  TaskNotFoundError,
  type StateMachineDef,
  type Task
} from "@poe-code/task-list";
import { describe, expect, it } from "vitest";

import { createMockTaskList } from "./mock-task-list.js";

const workflowMachine = {
  initial: "queued",
  states: ["queued", "running", "review", "done", "archived"],
  events: {
    start: { from: ["queued"], to: "running" },
    handoff: { from: ["running"], to: "review" },
    complete: { from: ["running", "review"], to: "done" },
    archive: { from: ["done"], to: "archived" }
  }
} as const satisfies StateMachineDef;

function task(id: string, state = "queued", metadata: Record<string, unknown> = {}): Task {
  return {
    list: "tasks",
    id,
    qualifiedId: `tasks/${id}`,
    name: id,
    state,
    description: "",
    metadata
  };
}

describe("createMockTaskList", () => {
  it("validates state transitions through fire and setState", async () => {
    const mock = createMockTaskList({
      tasks: [task("ship")],
      stateMachine: workflowMachine
    });

    await expect(mock.list("tasks").events("ship")).resolves.toEqual(["start"]);
    await expect(mock.list("tasks").canFire("ship", "start")).resolves.toBe(true);
    await expect(mock.list("tasks").canFire("ship", "complete")).resolves.toBe(false);
    await expect(mock.list("tasks").fire("ship", "start")).resolves.toMatchObject({
      state: "running"
    });
    await expect(mock.setState("tasks/ship", "done")).resolves.toMatchObject({
      state: "done"
    });
    await expect(mock.list("tasks").fire("ship", "start")).rejects.toBeInstanceOf(
      InvalidTransitionError
    );
    await expect(mock.setState("tasks/ship", "missing")).rejects.toBeInstanceOf(
      InvalidTransitionError
    );
  });

  it("creates and updates tasks with deterministic clock metadata", async () => {
    const mock = createMockTaskList({
      stateMachine: workflowMachine,
      clock: { now: () => new Date("2026-05-20T12:00:00.000Z") }
    });

    await expect(
      mock.list("tasks").create({
        id: "created",
        name: "Created",
        description: "Before",
        metadata: { owner: "agent" }
      })
    ).resolves.toMatchObject({
      id: "created",
      state: "queued",
      description: "Before",
      metadata: {
        created: "2026-05-20T12:00:00.000Z",
        owner: "agent"
      }
    });

    await expect(
      mock.list("tasks").update("created", {
        name: "Updated",
        description: "After",
        metadata: { owner: "human", priority: "high" }
      })
    ).resolves.toMatchObject({
      name: "Updated",
      description: "After",
      metadata: {
        created: "2026-05-20T12:00:00.000Z",
        owner: "human",
        priority: "high"
      }
    });
  });

  it("injects failures for each configured failure key", async () => {
    const mock = createMockTaskList({
      tasks: [task("one"), task("two", "running")],
      stateMachine: workflowMachine,
      failures: {
        getError: (taskId) => (taskId === "tasks/one" ? new Error("get boom") : undefined),
        setStateError: (taskId, from, to) =>
          taskId === "tasks/two" && from === "running" && to === "done"
            ? new Error("setState boom")
            : undefined,
        refreshError: (taskId) => (taskId === "tasks/two" ? new Error("refresh boom") : undefined),
        allTasksError: (state) => (state === "queued" ? new Error("allTasks boom") : undefined),
        transient: {
          lists: { times: 1, error: new Error("lists transient") }
        }
      }
    });

    await expect(mock.get("tasks/one")).rejects.toThrow("get boom");
    await expect(mock.allTasks({ state: "queued" })).rejects.toThrow("allTasks boom");
    await expect(mock.setState("tasks/two", "done")).rejects.toThrow("setState boom");
    await expect(mock.refresh("tasks/two")).rejects.toThrow("refresh boom");

    await expect(mock.lists()).rejects.toThrow("lists transient");
    await expect(mock.lists()).resolves.toEqual(["tasks"]);
  });

  it("uses mutate to simulate out-of-band edits without changing task ids", async () => {
    const mock = createMockTaskList({
      tasks: [task("external", "queued", { owner: "agent" })],
      stateMachine: workflowMachine
    });

    mock.mutate((store) => {
      const existing = store.get("tasks/external");
      store.set({
        ...existing,
        name: "Changed elsewhere",
        state: "running",
        metadata: { ...existing.metadata, owner: "human" }
      });
    });

    await expect(mock.get("tasks/external")).resolves.toEqual({
      ...task("external", "running", { owner: "human" }),
      name: "Changed elsewhere"
    });
  });

  it("supports read-model overrides for stale candidate and refreshed task snapshots", async () => {
    const stale = task("refresh", "queued");
    let current = { ...stale, description: "current body" };
    const mock = createMockTaskList({
      tasks: [stale],
      stateMachine: workflowMachine,
      readers: {
        allTasks: (filter) => (filter?.state === stale.state ? [stale] : []),
        get: (qualifiedId, store) => {
          expect(store.listNames()).toEqual(["tasks"]);
          if (qualifiedId !== current.qualifiedId) {
            throw new Error(`not found: ${qualifiedId}`);
          }
          return current;
        }
      }
    });

    await expect(mock.allTasks({ state: "queued" })).resolves.toEqual([stale]);
    await expect(mock.get("tasks/refresh")).resolves.toMatchObject({
      description: "current body"
    });

    current = { ...current, description: "next body" };
    await expect(mock.list("tasks").get("refresh")).resolves.toMatchObject({
      description: "next body"
    });
  });

  it("matches TaskNotFoundError and TaskAlreadyExistsError parity", async () => {
    const mock = createMockTaskList({
      tasks: [task("existing")],
      stateMachine: workflowMachine
    });

    await expect(mock.get("tasks/missing")).rejects.toBeInstanceOf(TaskNotFoundError);
    await expect(mock.list("tasks").get("missing")).rejects.toBeInstanceOf(TaskNotFoundError);
    await expect(
      mock.list("tasks").create({ id: "existing", name: "Existing" })
    ).rejects.toBeInstanceOf(TaskAlreadyExistsError);
  });

  it("matches InvalidTransitionError parity", async () => {
    const mock = createMockTaskList({
      tasks: [task("ship", "queued")],
      stateMachine: workflowMachine
    });

    await expect(mock.list("tasks").fire("ship", "complete")).rejects.toBeInstanceOf(
      InvalidTransitionError
    );
    await expect(mock.list("tasks").fire("ship", "unknown")).rejects.toBeInstanceOf(
      InvalidTransitionError
    );
  });

  it("keeps guard-side task mutations out of storage", async () => {
    const guardedMachine = {
      initial: "queued",
      states: ["queued", "done"],
      events: {
        complete: {
          from: ["queued"],
          to: "done",
          guard: (candidate: Task) => {
            candidate.metadata.guardMutated = true;
            return true;
          }
        }
      }
    } as const satisfies StateMachineDef;
    const mock = createMockTaskList({
      tasks: [task("guarded")],
      stateMachine: guardedMachine
    });

    await expect(mock.list("tasks").canFire("guarded", "complete")).resolves.toBe(true);
    expect((await mock.get("tasks/guarded")).metadata).toEqual({});

    const completed = await mock.list("tasks").fire("guarded", "complete");
    expect(completed.state).toBe("done");
    expect(completed.metadata).toEqual({});
  });

  it("implements ordering, movement, deletion, and cross-list moves", async () => {
    const mock = createMockTaskList({
      tasks: [task("one"), task("two"), task("archived", "archived")],
      lists: ["backlog"],
      stateMachine: workflowMachine
    });

    await expect(mock.lists()).resolves.toEqual(["backlog", "tasks"]);
    await expect(mock.list("tasks").move("two", { position: "top" })).resolves.toMatchObject({
      id: "two"
    });
    await expect(mock.list("tasks").all()).resolves.toMatchObject([{ id: "two" }, { id: "one" }]);
    await expect(mock.list("tasks").reorder(["one", "two"])).resolves.toMatchObject([
      { id: "one" },
      { id: "two" }
    ]);
    await expect(mock.moveBetweenLists("tasks/two", "backlog")).resolves.toMatchObject({
      list: "backlog",
      qualifiedId: "backlog/two"
    });
    await expect(mock.list("tasks").delete("one")).resolves.toBeUndefined();

    await expect(mock.list("tasks").all({ includeArchived: true })).resolves.toMatchObject([
      { id: "archived" }
    ]);
    await expect(mock.get("tasks/one")).rejects.toBeInstanceOf(TaskNotFoundError);
  });

  it("filters allTasks by state and excludes archived tasks by default", async () => {
    const mock = createMockTaskList({
      tasks: [task("queued", "queued"), task("running", "running"), task("archived", "archived")],
      stateMachine: workflowMachine
    });

    await expect(mock.allTasks()).resolves.toEqual([
      expect.objectContaining({ qualifiedId: "tasks/queued" }),
      expect.objectContaining({ qualifiedId: "tasks/running" })
    ]);
    await expect(mock.allTasks({ state: "running" })).resolves.toEqual([
      expect.objectContaining({ qualifiedId: "tasks/running" })
    ]);
    await expect(mock.allTasks({ state: "archived" })).resolves.toEqual([]);
    await expect(mock.allTasks({ includeArchived: true, state: "archived" })).resolves.toEqual([
      expect.objectContaining({ qualifiedId: "tasks/archived" })
    ]);
  });

  it("keeps comment as a no-op for non-supporting lists and records events on the mock handle", async () => {
    const mock = createMockTaskList({
      tasks: [task("comment")],
      stateMachine: workflowMachine
    });

    await expect(mock.list("tasks").comment?.("comment", "note")).resolves.toBeUndefined();

    expect(mock.events).toEqual([
      expect.objectContaining({
        method: "list",
        args: ["tasks"]
      }),
      {
        method: "comment",
        args: ["tasks/comment", "note"],
        result: undefined
      }
    ]);
    expect("events" in mock.taskList).toBe(false);
  });
});
