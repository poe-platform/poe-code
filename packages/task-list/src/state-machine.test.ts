import { describe, expect, expectTypeOf, it } from "vitest";
import {
  eventsFromState,
  findEvent,
  type EventDef,
  type StateMachineDef,
  validateMachine
} from "./state-machine.js";
import type { Task } from "./types.js";

type TaskState = "draft" | "planned" | "in-progress" | "done" | "archived";
type TaskEvent = "plan" | "start" | "complete" | "archive";

const defaultShapedMachine = {
  initial: "draft",
  states: ["draft", "planned", "in-progress", "done", "archived"],
  events: {
    plan: { from: ["draft"], to: "planned" },
    start: { from: ["planned"], to: "in-progress" },
    complete: { from: ["in-progress"], to: "done" },
    archive: { from: ["done"], to: "archived" }
  }
} as const satisfies StateMachineDef<TaskState, TaskEvent>;

describe("validateMachine", () => {
  it("accepts a default-shaped machine", () => {
    expect(() => validateMachine(defaultShapedMachine)).not.toThrow();
  });

  it("rejects when initial is not declared in states", () => {
    const machine = {
      ...defaultShapedMachine,
      initial: "unknown"
    } as const satisfies StateMachineDef<TaskState | "unknown", TaskEvent>;

    expect(() => validateMachine(machine)).toThrow('Initial state "unknown" is not declared.');
  });

  it("rejects blank state names", () => {
    const machine = {
      ...defaultShapedMachine,
      initial: "   ",
      states: ["   ", "done"],
      events: {
        complete: { from: ["   "], to: "done" }
      }
    } as const satisfies StateMachineDef<"   " | "done", "complete">;

    expect(() => validateMachine(machine)).toThrow("State names must not be empty.");
  });

  it("rejects blank event names", () => {
    const machine = {
      ...defaultShapedMachine,
      events: {
        ...defaultShapedMachine.events,
        "": { from: ["draft"], to: "planned" }
      }
    } as const satisfies StateMachineDef<TaskState, TaskEvent | "">;

    expect(() => validateMachine(machine)).toThrow("Event names must not be empty.");
  });

  it("rejects inherited top-level machine fields", () => {
    const machine = Object.create(defaultShapedMachine) as StateMachineDef;

    expect(() => validateMachine(machine)).toThrow("State machine states must be a string array.");
  });

  it("rejects inherited event transition fields", () => {
    const machine = {
      ...defaultShapedMachine,
      events: {
        plan: Object.create(defaultShapedMachine.events.plan)
      }
    } as StateMachineDef;

    expect(() => validateMachine(machine)).toThrow(
      'Event "plan" has an invalid "from" definition.'
    );
  });

  it("rejects when an event source state is not declared", () => {
    const machine = {
      ...defaultShapedMachine,
      events: {
        ...defaultShapedMachine.events,
        plan: {
          ...defaultShapedMachine.events.plan,
          from: ["unknown"]
        }
      }
    } as const satisfies StateMachineDef<TaskState | "unknown", TaskEvent>;

    expect(() => validateMachine(machine)).toThrow(
      'Event "plan" references unknown source state "unknown".'
    );
  });

  it("rejects when an event target state is not declared", () => {
    const machine = {
      ...defaultShapedMachine,
      events: {
        ...defaultShapedMachine.events,
        plan: {
          ...defaultShapedMachine.events.plan,
          to: "unknown"
        }
      }
    } as const satisfies StateMachineDef<TaskState | "unknown", TaskEvent>;

    expect(() => validateMachine(machine)).toThrow(
      'Event "plan" references unknown target state "unknown".'
    );
  });

  it("accepts wildcard events and excludes the target state from legal sources", () => {
    const machine = {
      ...defaultShapedMachine,
      events: {
        ...defaultShapedMachine.events,
        archive: {
          ...defaultShapedMachine.events.archive,
          from: "*"
        }
      }
    } as const satisfies StateMachineDef<TaskState, TaskEvent>;

    expect(() => validateMachine(machine)).not.toThrow();
    expect(eventsFromState(machine, "done")).toEqual(["archive"]);
    expect(eventsFromState(machine, "archived")).toEqual([]);
    expect(findEvent(machine, "done", "archive")).toEqual(machine.events.archive);
    expect(findEvent(machine, "archived", "archive")).toBeUndefined();
  });
});

describe("EventDef", () => {
  it("types guards and callbacks against Task", () => {
    expectTypeOf<EventDef<TaskState>["guard"]>().toEqualTypeOf<
      ((task: Task) => true | string) | undefined
    >();
    expectTypeOf<EventDef<TaskState>["onEnter"]>().toEqualTypeOf<
      ((task: Task) => void | Promise<void>) | undefined
    >();
    expectTypeOf<EventDef<TaskState>["onExit"]>().toEqualTypeOf<
      ((task: Task) => void | Promise<void>) | undefined
    >();
  });
});

describe("state machine helpers", () => {
  it("lists only the events legal from the given state", () => {
    expect(eventsFromState(defaultShapedMachine, "draft")).toEqual(["plan"]);
    expect(eventsFromState(defaultShapedMachine, "planned")).toEqual(["start"]);
    expect(eventsFromState(defaultShapedMachine, "archived")).toEqual([]);
  });

  it("finds only events that are legal from the given state", () => {
    expect(findEvent(defaultShapedMachine, "draft", "plan")).toEqual(
      defaultShapedMachine.events.plan
    );
    expect(findEvent(defaultShapedMachine, "planned", "plan")).toBeUndefined();
    expect(findEvent(defaultShapedMachine, "done", "archive")).toEqual(
      defaultShapedMachine.events.archive
    );
  });
});
