import { describe, expect, it } from "vitest";
import { assertEvent, assertTransition, defaultStateMachine, type TaskEvent } from "./state.js";
import { InvalidTransitionError, type TaskState } from "./types.js";

const TASK_STATES: TaskState[] = ["draft", "planned", "in-progress", "done", "archived"];
const TASK_EVENTS: TaskEvent[] = ["plan", "start", "complete", "archive"];

function allowedTargets(from: TaskState): ReadonlySet<TaskState> {
  const targets = new Set<TaskState>();
  const archived = defaultStateMachine.events.archive.to;
  const workflowStates = defaultStateMachine.states.filter((state) => state !== archived);
  const index = workflowStates.indexOf(from);

  if (from === archived) {
    return targets;
  }

  for (const eventName of TASK_EVENTS) {
    try {
      targets.add(assertEvent(defaultStateMachine, from, eventName).to);
    } catch (error) {
      if (!(error instanceof InvalidTransitionError)) {
        throw error;
      }
    }
  }

  if (index > 0) {
    targets.add(workflowStates[index - 1]);
  }

  return targets;
}

function transition(from: TaskState, to: TaskState): TaskState {
  assertTransition(from, to);
  return to;
}

describe("assertTransition", () => {
  it("preserves the legacy legal transition matrix", () => {
    expect([...allowedTargets("draft")]).toEqual(["planned", "archived"]);
    expect([...allowedTargets("planned")]).toEqual(["in-progress", "archived", "draft"]);
    expect([...allowedTargets("in-progress")]).toEqual(["done", "archived", "planned"]);
    expect([...allowedTargets("done")]).toEqual(["archived", "in-progress"]);
    expect([...allowedTargets("archived")]).toEqual([]);
  });

  it("returns the new state for every legal transition", () => {
    for (const from of TASK_STATES) {
      for (const to of allowedTargets(from)) {
        expect(transition(from, to)).toBe(to);
      }
    }
  });

  it("throws InvalidTransitionError for every illegal transition", () => {
    for (const from of TASK_STATES) {
      for (const to of TASK_STATES) {
        if (allowedTargets(from).has(to)) {
          continue;
        }

        expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
        expect(() => assertTransition(from, to)).toThrow(`"${from}"`);
        expect(() => assertTransition(from, to)).toThrow(`"${to}"`);
      }
    }
  });

  it("rejects every transition out of archived", () => {
    for (const to of TASK_STATES) {
      expect(() => assertTransition("archived", to)).toThrow(InvalidTransitionError);
    }
  });
});

describe("assertEvent", () => {
  it("returns the matching event definition when the event is legal", () => {
    expect(assertEvent(defaultStateMachine, "draft", "plan")).toEqual(
      defaultStateMachine.events.plan
    );
    expect(assertEvent(defaultStateMachine, "done", "archive")).toEqual(
      defaultStateMachine.events.archive
    );
  });

  it("throws InvalidTransitionError when the event is illegal from the current state", () => {
    expect(() => assertEvent(defaultStateMachine, "planned", "plan")).toThrow(
      InvalidTransitionError
    );
    expect(() => assertEvent(defaultStateMachine, "archived", "archive")).toThrow(
      InvalidTransitionError
    );
  });

  it("reports the event name and source state in the error", () => {
    expect(() => assertEvent(defaultStateMachine, "planned", "plan")).toThrow(
      'Cannot fire event "plan" from task state "planned".'
    );
  });
});
