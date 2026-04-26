import { describe, expect, it } from "vitest";
import { LEGAL_TRANSITIONS, assertTransition } from "./state.js";
import { InvalidTransitionError, type TaskState } from "./types.js";

const TASK_STATES: TaskState[] = ["draft", "planned", "in-progress", "done", "archived"];

function transition(from: TaskState, to: TaskState): TaskState {
  assertTransition(from, to);
  return to;
}

describe("assertTransition", () => {
  it("returns the new state for every legal transition", () => {
    for (const [from, allowedTargets] of Object.entries(LEGAL_TRANSITIONS) as Array<
      [TaskState, ReadonlySet<TaskState>]
    >) {
      for (const to of allowedTargets) {
        expect(transition(from, to)).toBe(to);
      }
    }
  });

  it("throws InvalidTransitionError for every illegal transition", () => {
    for (const from of TASK_STATES) {
      for (const to of TASK_STATES) {
        if (LEGAL_TRANSITIONS[from].has(to)) {
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
