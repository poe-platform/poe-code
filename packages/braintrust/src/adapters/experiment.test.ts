import type { EvalResult, ExperimentRunOptions, JournalEntry, MetricDef } from "@poe-code/experiment-loop";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BraintrustClient } from "../client.js";
import { makeExperimentIterationState } from "../row-builder.js";
import { createExperimentCallbacks } from "./experiment.js";

vi.mock("../row-builder.js", () => ({
  makeExperimentIterationState: vi.fn(),
}));

const mockMakeExperimentIterationState = vi.mocked(makeExperimentIterationState);

describe("createExperimentCallbacks", () => {
  beforeEach(() => {
    mockMakeExperimentIterationState.mockReset();
  });

  it("creates experiment iteration state with the client and experiment name", () => {
    const state = createIterationState();
    const client = createMockClient();
    mockMakeExperimentIterationState.mockReturnValue(state);

    createExperimentCallbacks(client, "adapter-benchmark");

    expect(mockMakeExperimentIterationState).toHaveBeenCalledWith(client, "adapter-benchmark");
  });

  it("wires every experiment callback surface into the iteration state", async () => {
    const state = createIterationState();
    const client = createMockClient();
    mockMakeExperimentIterationState.mockReturnValue(state);
    const callbacks = createExperimentCallbacks(client, "adapter-benchmark");
    const metric = {
      name: "tests",
      script: "npm test",
      direction: "maximize",
    } satisfies MetricDef;
    const metricResult = {
      score: 17,
      passed: true,
      output: "17 tests passed",
    } satisfies EvalResult;
    const entry = {
      commit: "abc123",
      status: "keep",
      scores: {
        tests: 17,
      },
      output: "17 tests passed",
      agentOutput: "Implemented callback adapters",
      durationMs: 123,
      timestamp: "2026-05-04T12:00:00.000Z",
    } satisfies JournalEntry;

    callbacks.onExperimentStart(2, "codex");
    callbacks.onBaselineCollected({ tests: 12 });
    callbacks.onMetricResult(metric, metricResult);
    callbacks.onCommit("abc123");
    callbacks.onReset("base123");
    callbacks.onExperimentComplete(2, entry);

    await vi.waitFor(() => {
      expect(state.complete).toHaveBeenCalledWith(2, entry);
    });
    expect(state.start).toHaveBeenCalledWith(2, "codex");
    expect(state.baseline).toHaveBeenCalledWith({ tests: 12 });
    expect(state.metric).toHaveBeenCalledWith("tests", 17);
    expect(state.commit).toHaveBeenCalledWith("abc123");
    expect(state.reset).toHaveBeenCalledWith("base123");
  });
});

function createIterationState(): ReturnType<typeof makeExperimentIterationState> {
  return {
    start: vi.fn(async () => undefined),
    baseline: vi.fn(),
    metric: vi.fn(),
    commit: vi.fn(),
    reset: vi.fn(),
    complete: vi.fn(async () => undefined),
  };
}

function createMockClient(): BraintrustClient {
  return {
    getSdk: vi.fn(),
    getRootLogger: vi.fn(),
    getExperiment: vi.fn(),
    flush: vi.fn(),
    recordError: vi.fn(),
    status: vi.fn(() => ({
      lastError: null,
      errorCount: 0,
      project: "project",
    })),
  };
}

type ignoredExperimentCallbackFields = Pick<
  ExperimentRunOptions,
  | "onExperimentStart"
  | "onBaselineCollected"
  | "onMetricResult"
  | "onCommit"
  | "onReset"
  | "onExperimentComplete"
>;
