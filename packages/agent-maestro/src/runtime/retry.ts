import type { AttemptPhase, FailureCategory } from "./phases.js";

export const CONTINUATION_DELAY_MS = 1_000;

export type RetryDecision =
  | { retry: false }
  | { retry: true; kind: "continuation"; delayMs: typeof CONTINUATION_DELAY_MS; attempt?: number }
  | { retry: true; kind: "backoff"; attempt?: number };

export interface RetryContext {
  attempt?: number;
}

const RETRYABLE_FAILURE_CATEGORIES: readonly FailureCategory[] = [
  "workspace_error",
  "agent_startup_error",
  "step_failed",
  "step_timeout",
  "agent_crashed",
];

export function backoffMs(attempt: number, capMs: number): number {
  return Math.min(10_000 * 2 ** (attempt - 1), capMs);
}

export function shouldRetry(
  phase: AttemptPhase,
  failure?: FailureCategory,
  ctx: RetryContext = {},
): RetryDecision {
  if (phase === "succeeded") {
    const decision: RetryDecision = {
      retry: true,
      kind: "continuation",
      delayMs: CONTINUATION_DELAY_MS,
    };

    if (ctx.attempt !== undefined) {
      decision.attempt = 1;
    }

    return decision;
  }

  if (phase === "canceled") {
    return { retry: false };
  }

  if (phase === "failed") {
    if (failure === undefined || !RETRYABLE_FAILURE_CATEGORIES.includes(failure)) {
      return { retry: false };
    }

    const decision: RetryDecision = { retry: true, kind: "backoff" };

    if (ctx.attempt !== undefined) {
      decision.attempt = ctx.attempt + 1;
    }

    return decision;
  }

  throw new Error(`Cannot decide retry for non-terminal phase: ${phase}`);
}
