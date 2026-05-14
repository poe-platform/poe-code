import { describe, expect, it } from "vitest";

import {
  ATTEMPT_TRANSITIONS,
  type AttemptPhase,
  type FailureCategory,
  transitionPhase,
} from "./phases.js";

const ATTEMPT_PHASES: readonly AttemptPhase[] = [
  "preparing-workspace",
  "running-setup",
  "running-step",
  "running-teardown",
  "succeeded",
  "failed",
  "canceled",
];

const FAILURE_CATEGORIES: readonly FailureCategory[] = [
  "workspace_error",
  "prompt_render_error",
  "agent_startup_error",
  "step_failed",
  "step_timeout",
  "agent_crashed",
  "canceled",
];

describe("transitionPhase", () => {
  it("accepts every legal transition in ATTEMPT_TRANSITIONS", () => {
    for (const [current, nextPhases] of Object.entries(ATTEMPT_TRANSITIONS) as [
      AttemptPhase,
      readonly AttemptPhase[],
    ][]) {
      for (const next of nextPhases) {
        expect(transitionPhase({ phase: current }, next, {})).toEqual({ phase: next });
      }
    }
  });

  it("rejects every illegal transition", () => {
    for (const current of ATTEMPT_PHASES) {
      const legalTransitions = ATTEMPT_TRANSITIONS[current];

      for (const next of ATTEMPT_PHASES) {
        if (legalTransitions.includes(next)) {
          continue;
        }

        expect(() => transitionPhase({ phase: current }, next, {})).toThrow(
          `Illegal attempt phase transition: ${current} -> ${next}`,
        );
      }
    }
  });

  it("preserves step, failedStep, failure, and error fields unless ctx overrides them", () => {
    expect(
      transitionPhase(
        {
          phase: "running-step",
          step: "build",
          failedStep: "setup",
          failure: "agent_startup_error",
          error: "previous error",
        },
        "running-teardown",
        { step: "teardown" },
      ),
    ).toEqual({
      phase: "running-teardown",
      step: "teardown",
      failedStep: "setup",
      failure: "agent_startup_error",
      error: "previous error",
    });
  });

  it("does not clear preserved fields when ctx contains undefined values", () => {
    expect(
      transitionPhase(
        {
          phase: "running-step",
          step: "build",
          failedStep: "setup",
          failure: "agent_startup_error",
          error: "previous error",
        },
        "running-teardown",
        {
          step: undefined,
          failedStep: undefined,
          failure: undefined,
          error: undefined,
        },
      ),
    ).toEqual({
      phase: "running-teardown",
      step: "build",
      failedStep: "setup",
      failure: "agent_startup_error",
      error: "previous error",
    });
  });

  it("returns a new state without mutating the current state", () => {
    const current = {
      phase: "running-step",
      step: "build",
      failure: "step_failed",
      failedStep: "build",
    } satisfies Parameters<typeof transitionPhase>[0];

    const next = transitionPhase(current, "running-teardown", { step: "teardown" });

    expect(next).toEqual({
      phase: "running-teardown",
      step: "teardown",
      failure: "step_failed",
      failedStep: "build",
    });
    expect(current).toEqual({
      phase: "running-step",
      step: "build",
      failure: "step_failed",
      failedStep: "build",
    });
    expect(next).not.toBe(current);
  });

  it("preserves every failure category through a failed transition", () => {
    for (const failure of FAILURE_CATEGORIES) {
      expect(
        transitionPhase({ phase: "running-step", step: "test" }, "failed", {
          failure,
          failedStep: "test",
        }),
      ).toEqual({
        phase: "failed",
        step: "test",
        failure,
        failedStep: "test",
      });
    }
  });
});
