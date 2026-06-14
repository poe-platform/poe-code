import {
  openTaskList,
  InvalidTransitionError,
  validateMachine,
  type TaskListFs,
  type Tasks,
} from "@poe-code/task-list";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { maestroTaskStateMachine, type MaestroTaskEvent, type MaestroTaskState } from "./index.js";

function createTaskListFs(): TaskListFs {
  const volume = Volume.fromJSON({}, "/");
  const rawFs = createFsFromVolume(volume).promises;

  return rawFs as unknown as TaskListFs;
}

async function createMaestroTasks(): Promise<Tasks> {
  const taskList = await openTaskList({
    type: "yaml-file",
    path: "/repo/tasks.yaml",
    create: true,
    fs: createTaskListFs(),
    stateMachine: maestroTaskStateMachine,
  });

  return taskList.list("maestro");
}

async function createTaskInState(tasks: Tasks, id: string, state: MaestroTaskState): Promise<void> {
  await tasks.create({ id, name: id });

  switch (state) {
    case "queued":
      return;
    case "agent-running":
      await tasks.fire(id, "start");
      return;
    case "human-review":
      await tasks.fire(id, "start");
      await tasks.fire(id, "handoff");
      return;
    case "done":
      await tasks.fire(id, "start");
      await tasks.fire(id, "complete");
      return;
    case "failed":
      await tasks.fire(id, "start");
      await tasks.fire(id, "fail");
      return;
    case "archived":
      await tasks.fire(id, "start");
      await tasks.fire(id, "complete");
      await tasks.fire(id, "archive");
      return;
  }
}

const eventsByState: Record<MaestroTaskState, readonly MaestroTaskEvent[]> = {
  queued: ["start"],
  "agent-running": ["complete", "handoff", "fail"],
  "human-review": ["accept", "fail"],
  done: ["archive"],
  failed: ["archive"],
  archived: [],
};

const transitionCases: Array<{
  readonly from: MaestroTaskState;
  readonly event: MaestroTaskEvent;
  readonly to: MaestroTaskState;
}> = [
  { from: "queued", event: "start", to: "agent-running" },
  { from: "agent-running", event: "complete", to: "done" },
  { from: "agent-running", event: "handoff", to: "human-review" },
  { from: "agent-running", event: "fail", to: "failed" },
  { from: "human-review", event: "accept", to: "done" },
  { from: "human-review", event: "fail", to: "failed" },
  { from: "done", event: "archive", to: "archived" },
  { from: "failed", event: "archive", to: "archived" },
];

const allEvents = Object.keys(maestroTaskStateMachine.events) as MaestroTaskEvent[];

describe("maestroTaskStateMachine", () => {
  it("does not allow callers to mutate exported event transitions", () => {
    expect(() => (maestroTaskStateMachine.events.complete.from as MaestroTaskState[]).push("queued")).toThrow();
    expect(maestroTaskStateMachine.events.complete.from).toEqual(["agent-running"]);
  });

  it("passes state-machine validation", () => {
    expect(() => validateMachine(maestroTaskStateMachine)).not.toThrow();
  });

  it("fires the canonical human-review path cleanly", async () => {
    const tasks = await createMaestroTasks();

    await expect(tasks.create({ id: "implement", name: "Implement" })).resolves.toMatchObject({
      state: "queued",
    });
    await expect(tasks.fire("implement", "start")).resolves.toMatchObject({
      state: "agent-running",
    });
    await expect(tasks.fire("implement", "handoff")).resolves.toMatchObject({
      state: "human-review",
    });
    await expect(tasks.fire("implement", "accept")).resolves.toMatchObject({
      state: "done",
    });
  });

  it("exposes only the events allowed from each state", async () => {
    const tasks = await createMaestroTasks();

    for (const state of maestroTaskStateMachine.states) {
      const id = `events-${state}`;
      await createTaskInState(tasks, id, state);

      await expect(tasks.events(id)).resolves.toEqual(eventsByState[state]);
    }
  });

  it("fires every documented transition cleanly", async () => {
    const tasks = await createMaestroTasks();

    for (const { from, event, to } of transitionCases) {
      const id = `${from}-${event}`;
      await createTaskInState(tasks, id, from);

      await expect(tasks.fire(id, event)).resolves.toMatchObject({ state: to });
    }
  });

  it("throws InvalidTransitionError for every illegal event from every state", async () => {
    const tasks = await createMaestroTasks();

    for (const state of maestroTaskStateMachine.states) {
      for (const event of allEvents) {
        if (eventsByState[state].includes(event)) {
          continue;
        }

        const id = `illegal-${state}-${event}`;
        await createTaskInState(tasks, id, state);

        await expect(tasks.fire(id, event)).rejects.toBeInstanceOf(InvalidTransitionError);
      }
    }
  });
});
