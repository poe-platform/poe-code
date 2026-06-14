import { describe, expect, it } from "vitest";

import { backoffMs, CONTINUATION_DELAY_MS, shouldRetry } from "./retry.js";
import type { FailureCategory } from "./phases.js";

describe("backoffMs", () => {
  it("calculates exponential backoff for attempts 1 through 10 with a cap", () => {
    const capMs = 300_000;

    expect(
      Array.from({ length: 10 }, (_, index) => backoffMs(index + 1, capMs)),
    ).toEqual([
      10_000,
      20_000,
      40_000,
      80_000,
      160_000,
      300_000,
      300_000,
      300_000,
      300_000,
      300_000,
    ]);
  });
});

describe("shouldRetry", () => {
  it("uses CONTINUATION_DELAY_MS for non-failure continuations and resets the attempt counter", () => {
    expect(CONTINUATION_DELAY_MS).toBe(1_000);
    expect(shouldRetry("succeeded", undefined, { attempt: 7 })).toEqual({
      retry: true,
      kind: "continuation",
      delayMs: 1_000,
      attempt: 1,
    });
  });

  it("uses CONTINUATION_DELAY_MS for non-failure continuations without adding an attempt when none is tracked", () => {
    expect(shouldRetry("succeeded")).toEqual({
      retry: true,
      kind: "continuation",
      delayMs: CONTINUATION_DELAY_MS,
    });
  });

  it("does not retry canceled attempts", () => {
    expect(shouldRetry("canceled", "canceled")).toEqual({ retry: false });
  });

  it("does not retry failed attempts without a failure category", () => {
    expect(shouldRetry("failed")).toEqual({ retry: false });
  });

  it.each(["prompt_render_error", "canceled"] satisfies FailureCategory[])(
    "does not retry non-retryable failure category %s",
    (failure) => {
      expect(shouldRetry("failed", failure)).toEqual({ retry: false });
    },
  );

  it.each([
    "workspace_error",
    "agent_startup_error",
    "step_failed",
    "step_timeout",
    "agent_crashed",
  ] satisfies FailureCategory[])("uses backoff retry for retryable failure category %s", (failure) => {
    expect(shouldRetry("failed", failure, { attempt: 3 })).toEqual({
      retry: true,
      kind: "backoff",
      attempt: 4,
    });
  });

  it("uses backoff retry without adding an attempt when none is tracked", () => {
    expect(shouldRetry("failed", "step_timeout")).toEqual({
      retry: true,
      kind: "backoff",
    });
  });

  it("keeps retrying retryable failures because maestro has no max-attempt cap", () => {
    expect(shouldRetry("failed", "agent_crashed", { attempt: 10_000 })).toEqual({
      retry: true,
      kind: "backoff",
      attempt: 10_001,
    });
  });

  it("rejects retry decisions for non-terminal phases", () => {
    expect(() => shouldRetry("preparing-workspace")).toThrow(
      "Cannot decide retry for non-terminal phase: preparing-workspace",
    );
    expect(() => shouldRetry("running-step")).toThrow(
      "Cannot decide retry for non-terminal phase: running-step",
    );
  });
});
