import type { AttemptPhase, FailureCategory } from "./phases.js";

export const CONTINUATION_DELAY_MS = 1_000;

export type RetryDecision =
  | { retry: false }
  | { retry: true; kind: "continuation"; delayMs: typeof CONTINUATION_DELAY_MS }
  | { retry: true; kind: "backoff" };

export function backoffMs(attempt: number, capMs: number): number {
  return Math.min(10_000 * 2 ** (attempt - 1), capMs);
}

export function shouldRetry(phase: AttemptPhase, _failure?: FailureCategory): RetryDecision {
  if (phase === "succeeded") {
    return { retry: true, kind: "continuation", delayMs: CONTINUATION_DELAY_MS };
  }

  if (phase === "canceled") {
    return { retry: false };
  }

  if (phase === "failed") {
    return { retry: true, kind: "backoff" };
  }

  throw new Error(`Cannot decide retry for non-terminal phase: ${phase}`);
}
