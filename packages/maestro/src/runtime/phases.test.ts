import { describe, expect, it } from "vitest";

import {
  ATTEMPT_TRANSITIONS,
  type AttemptPhase,
  type FailureCategory,
  transitionPhase,
} from "./phases.js";

const ATTEMPT_PHASES: readonly AttemptPhase[] = [
  "preparing-workspace",
  "running-step",
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
  it("keeps terminal transitions immutable through the exported metadata", () => {
    expect(() => (ATTEMPT_TRANSITIONS.succeeded as AttemptPhase[]).push("running-step")).toThrow();
    expect(() => transitionPhase({ phase: "succeeded" }, "running-step", { step: "unexpected" })).toThrow(
      "Illegal attempt phase transition: succeeded -> running-step"
    );
  });

  it("accepts every legal transition in ATTEMPT_TRANSITIONS", () => {
    for (const [current, nextPhases] of Object.entries(ATTEMPT_TRANSITIONS) as [
      AttemptPhase,
      readonly AttemptPhase[],
    ][]) {
      for (const next of nextPhases) {
        const ctx = next === "failed" ? { failure: "step_failed" as const } : {};

        expect(transitionPhase({ phase: current }, next, ctx)).toEqual({
          phase: next,
          ...ctx,
        });
      }
    }
  });

  it("accepts null to preparing-workspace as the initial transition", () => {
    expect(transitionPhase(null, "preparing-workspace", {})).toEqual({
      phase: "preparing-workspace",
    });
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

  it("rejects null to any phase except preparing-workspace", () => {
    for (const next of ATTEMPT_PHASES) {
      if (next === "preparing-workspace") {
        continue;
      }

      expect(() => transitionPhase(null, next, {})).toThrow(
        `Illegal attempt phase transition: null -> ${next}`,
      );
    }
  });

  it.each(["succeeded", "failed", "canceled"] satisfies AttemptPhase[])(
    "rejects any further transition from terminal phase %s",
    (current) => {
      for (const next of ATTEMPT_PHASES) {
        expect(() =>
          transitionPhase(
            { phase: current, ...(current === "failed" ? { failure: "step_failed" as const } : {}) },
            next,
            next === "failed" ? { failure: "step_failed" } : {},
          ),
        ).toThrow(`Illegal attempt phase transition: ${current} -> ${next}`);
      }
    },
  );

  it("requires a failure category on failed transitions", () => {
    expect(() => transitionPhase({ phase: "running-step" }, "failed", {})).toThrow(
      "Failure category is required for failed phase",
    );
  });

  it.each(["succeeded", "canceled"] satisfies AttemptPhase[])(
    "rejects failure category on %s transitions",
    (next) => {
      expect(() =>
        transitionPhase({ phase: "running-step" }, next, { failure: "step_failed" }),
      ).toThrow(`Failure category must be absent for ${next} phase`);
    },
  );

  it("preserves step, failedStep, failure, and error fields unless ctx overrides them", () => {
    expect(
      transitionPhase(
        {
          phase: "running-step",
          step: "build",
          failedStep: "plan",
          failure: "agent_startup_error",
          error: "previous error",
        },
        "running-step",
        { step: "review" },
      ),
    ).toEqual({
      phase: "running-step",
      step: "review",
      failedStep: "plan",
      failure: "agent_startup_error",
      error: "previous error",
    });

    expect(
      transitionPhase(
        {
          phase: "running-step",
          step: "build",
          failedStep: "plan",
          failure: "agent_startup_error",
          error: "previous error",
        },
        "running-step",
        { error: "next error" },
      ),
    ).toEqual({
      phase: "running-step",
      step: "build",
      failedStep: "plan",
      failure: "agent_startup_error",
      error: "next error",
    });
  });

  it("does not clear preserved fields when ctx contains undefined values", () => {
    expect(
      transitionPhase(
        {
          phase: "running-step",
          step: "build",
          failedStep: "plan",
          failure: "agent_startup_error",
          error: "previous error",
        },
        "running-step",
        {
          step: undefined,
          failedStep: undefined,
          failure: undefined,
          error: undefined,
        },
      ),
    ).toEqual({
      phase: "running-step",
      step: "build",
      failedStep: "plan",
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

    const next = transitionPhase(current, "running-step", { step: "review" });

    expect(next).toEqual({
      phase: "running-step",
      step: "review",
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
