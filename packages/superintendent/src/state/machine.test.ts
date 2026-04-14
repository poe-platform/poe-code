import { describe, expect, it } from "vitest";
import type { SuperintendentDoc } from "../document/parse.js";
import {
  applyTransition,
  createLoopState,
  isComplete,
  shouldRunBuilder,
  startNewRound,
  type LoopState
} from "./machine.js";

function createDoc(): SuperintendentDoc {
  return {
    filePath: "/tmp/plan.md",
    body: "# Task Board\n",
    frontmatter: {
      kind: "superintendent",
      version: 1,
      builder: {
        agent: "codex",
        prompt: "build"
      },
      superintendent: {
        agent: "codex",
        prompt: "supervise"
      },
      owner: {
        agent: "codex",
        prompt: "approve"
      },
      max_rounds: 3,
      status: {
        state: "review",
        round: 2,
        review_turn: 4
      }
    }
  };
}

function createDocWithoutMaxRounds(): SuperintendentDoc {
  const doc = createDoc();

  return {
    ...doc,
    frontmatter: {
      ...doc.frontmatter,
      max_rounds: undefined
    }
  };
}

function createState(overrides: Partial<LoopState> = {}): LoopState {
  return {
    state: "in_progress",
    round: 1,
    reviewTurn: 0,
    maxRounds: 3,
    maxReviewTurns: 5,
    ...overrides
  };
}

describe("superintendent state machine", () => {
  it("createLoopState initializes from the document status block", () => {
    expect(createLoopState(createDoc())).toEqual({
      state: "review",
      round: 2,
      reviewTurn: 4,
      maxRounds: 3,
      maxReviewTurns: 5
    });
  });

  it("createLoopState defaults maxRounds to 100 when omitted", () => {
    expect(createLoopState(createDocWithoutMaxRounds())).toEqual({
      state: "review",
      round: 2,
      reviewTurn: 4,
      maxRounds: 100,
      maxReviewTurns: 5
    });
  });

  it("applyTransition request_review moves to review", () => {
    expect(
      applyTransition(createState({ state: "in_progress", reviewTurn: 2 }), {
        action: "request_review",
        summary: "Ready"
      })
    ).toEqual(
      createState({
        state: "review",
        reviewTurn: 0
      })
    );
  });

  it("applyTransition approve_completion moves to completed", () => {
    expect(
      applyTransition(createState({ state: "review", reviewTurn: 3 }), {
        action: "approve_completion"
      })
    ).toEqual(
      createState({
        state: "completed",
        reviewTurn: 3
      })
    );
  });

  it("applyTransition request_changes increments reviewTurn", () => {
    expect(
      applyTransition(createState({ state: "review", reviewTurn: 2 }), {
        action: "request_changes",
        feedback: "One more fix"
      })
    ).toEqual(
      createState({
        state: "review",
        reviewTurn: 3
      })
    );
  });

  it("applyTransition request_changes allows the fifth review turn", () => {
    expect(
      applyTransition(createState({ state: "review", reviewTurn: 4 }), {
        action: "request_changes",
        feedback: "One last pass"
      })
    ).toEqual(
      createState({
        state: "review",
        reviewTurn: 5
      })
    );
  });

  it("review cap at 5 turns auto-transitions to in_progress", () => {
    expect(
      applyTransition(createState({ state: "review", reviewTurn: 5 }), {
        action: "request_changes",
        feedback: "Try again"
      })
    ).toEqual(
      createState({
        state: "in_progress",
        reviewTurn: 0
      })
    );
  });

  it("startNewRound increments round and resets state", () => {
    expect(startNewRound(createState({ state: "review", round: 2, reviewTurn: 4 }))).toEqual(
      createState({
        state: "in_progress",
        round: 3,
        reviewTurn: 0
      })
    );
  });

  it("isComplete detects completed state", () => {
    expect(isComplete(createState({ state: "completed" }))).toBe(true);
  });

  it("isComplete detects max_rounds exceeded", () => {
    expect(isComplete(createState({ round: 4, maxRounds: 3 }))).toBe(true);
  });

  it("isComplete stays false when round matches max_rounds", () => {
    expect(isComplete(createState({ round: 3, maxRounds: 3 }))).toBe(false);
  });

  it("shouldRunBuilder only true in in_progress", () => {
    expect(shouldRunBuilder(createState({ state: "in_progress" }))).toBe(true);
    expect(shouldRunBuilder(createState({ state: "review" }))).toBe(false);
    expect(shouldRunBuilder(createState({ state: "completed" }))).toBe(false);
  });
});
