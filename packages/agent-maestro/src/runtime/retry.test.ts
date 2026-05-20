import { describe, expect, it } from "vitest";

import { backoffMs, CONTINUATION_DELAY_MS, shouldRetry } from "./retry.js";

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
  it("uses a one second continuation retry after success", () => {
    expect(CONTINUATION_DELAY_MS).toBe(1_000);
    expect(shouldRetry("succeeded")).toEqual({
      retry: true,
      kind: "continuation",
      delayMs: 1_000,
    });
  });

  it("does not retry canceled attempts", () => {
    expect(shouldRetry("canceled", "canceled")).toEqual({ retry: false });
  });

  it("uses backoff retry for other terminal failures", () => {
    expect(shouldRetry("failed", "step_failed")).toEqual({ retry: true, kind: "backoff" });
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
