import type { SuperintendentDoc } from "../document/parse.js";
import type { WorkflowTransition } from "../runtime/workflow-tool.js";

const DEFAULT_MAX_ROUNDS = 100;
const MAX_REVIEW_TURNS = 5;

export type LoopState = {
  state: "in_progress" | "review" | "completed";
  round: number;
  reviewTurn: number;
  maxRounds: number;
  maxReviewTurns: number;
};

export function createLoopState(doc: SuperintendentDoc): LoopState {
  return {
    state: doc.frontmatter.status.state,
    round: doc.frontmatter.status.round,
    reviewTurn: doc.frontmatter.status.review_turn,
    maxRounds: doc.frontmatter.max_rounds ?? DEFAULT_MAX_ROUNDS,
    maxReviewTurns: MAX_REVIEW_TURNS
  };
}

export function applyTransition(state: LoopState, transition: WorkflowTransition): LoopState {
  switch (transition.action) {
    case "request_review":
      return {
        ...state,
        state: "review",
        reviewTurn: 0
      };

    case "approve_completion":
      return {
        ...state,
        state: "completed"
      };

    case "request_changes":
      if (state.reviewTurn < state.maxReviewTurns) {
        return {
          ...state,
          state: "review",
          reviewTurn: state.reviewTurn + 1
        };
      }

      return {
        ...state,
        state: "in_progress",
        reviewTurn: 0
      };
  }
}

export function startNewRound(state: LoopState): LoopState {
  return {
    ...state,
    state: "in_progress",
    round: state.round + 1,
    reviewTurn: 0
  };
}

export function isComplete(state: LoopState): boolean {
  return state.state === "completed" || state.round > state.maxRounds;
}

export function shouldRunBuilder(state: LoopState): boolean {
  return state.state === "in_progress";
}
