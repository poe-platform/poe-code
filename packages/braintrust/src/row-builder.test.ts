import type { JournalEntry } from "@poe-code/experiment-loop";
import type { TaskCompletion, TaskProgress } from "@poe-code/pipeline";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BraintrustClient } from "./client.js";
import {
  logSuperintendentRole,
  makeExperimentIterationState,
  makePipelineRowState,
} from "./row-builder.js";

const mockBraintrust = vi.hoisted(() => ({
  currentSpan: vi.fn(),
}));

vi.mock("braintrust", () => ({
  currentSpan: mockBraintrust.currentSpan,
}));

describe("makePipelineRowState", () => {
  beforeEach(() => {
    mockBraintrust.currentSpan.mockReset();
  });

  it("opens a task span on start and logs the completed step payload", async () => {
    const stepSpan = createMockSpan();
    const parentSpan = {
      startSpan: vi.fn(() => stepSpan),
    };
    mockBraintrust.currentSpan.mockReturnValue(parentSpan);
    const client = createMockClient();
    const state = makePipelineRowState(client);
    const started = {
      taskId: "task-1",
      taskTitle: "Implement telemetry",
      stepName: "builder",
      taskIndex: 2,
      totalTasks: 5,
      stepIndex: 1,
      totalSteps: 2,
      step_prompt: "Build the row helper",
      plan_section: "## Telemetry",
    } satisfies TaskProgress & Record<string, unknown>;
    const completed = {
      ...started,
      durationMs: 1234,
      success: true,
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        cachedTokens: 3,
      },
      result_summary: "Helper implemented",
      files_changed: ["packages/braintrust/src/row-builder.ts"],
    } satisfies TaskCompletion & Record<string, unknown>;

    state.start(started);
    state.complete(completed);

    await vi.waitFor(() => {
      expect(stepSpan.log).toHaveBeenCalledWith({
        input: {
          step_name: "builder",
          step_prompt: "Build the row helper",
          plan_section: "## Telemetry",
        },
        output: {
          result_summary: "Helper implemented",
          files_changed: ["packages/braintrust/src/row-builder.ts"],
          success: true,
        },
        scores: {
          passed: 1,
        },
        metrics: {
          prompt_tokens: 11,
          completion_tokens: 7,
          tokens: 18,
          prompt_cached_tokens: 3,
          durationMs: 1234,
        },
      });
    });
    expect(parentSpan.startSpan).toHaveBeenCalledWith({
      name: "step:builder:1",
      type: "task",
    });
    expect(stepSpan.end).toHaveBeenCalledTimes(1);
    expect(client.recordError).not.toHaveBeenCalled();
  });
});

describe("logSuperintendentRole", () => {
  beforeEach(() => {
    mockBraintrust.currentSpan.mockReset();
  });

  it("logs inspector payloads with a satisfied score derived from verdict", async () => {
    const roleSpan = createMockSpan();
    const parentSpan = {
      startSpan: vi.fn(() => roleSpan),
    };
    mockBraintrust.currentSpan.mockReturnValue(parentSpan);
    const client = createMockClient();

    await logSuperintendentRole(client, "inspector", {
      input: {
        checklist: "Review implementation",
      },
      output: {
        summary: "Looks correct",
      },
      verdict: "satisfied",
    });

    expect(parentSpan.startSpan).toHaveBeenCalledWith({
      name: "role:inspector",
      type: "task",
    });
    expect(roleSpan.log).toHaveBeenCalledWith({
      input: {
        checklist: "Review implementation",
      },
      output: {
        summary: "Looks correct",
      },
      scores: {
        satisfied: 1,
      },
    });
    expect(roleSpan.end).toHaveBeenCalledTimes(1);
    expect(client.recordError).not.toHaveBeenCalled();
  });
});

describe("makeExperimentIterationState", () => {
  it("opens an experiment iteration row and logs accumulated callback payload", async () => {
    const iterationSpan = createMockSpan();
    const experiment = {
      startSpan: vi.fn(() => iterationSpan),
    };
    const client = createMockClient({
      experiment,
    });
    const state = makeExperimentIterationState(client, "benchmarks");
    const entry = {
      commit: "keep-123",
      status: "keep",
      scores: {
        tests: 15,
      },
      output: "tests: score=15, passed=true",
      agentOutput: "Reduced allocations in parser",
      durationMs: 3210,
      timestamp: "2026-05-04T12:00:00.000Z",
      brief: "Improve parser throughput",
    } satisfies JournalEntry & Record<string, unknown>;

    state.baseline({ tests: 10 });
    await state.start(3, "codex");
    state.metric("tests", 15);
    state.commit("keep-123");
    await state.complete(3, entry);

    expect(client.getExperiment).toHaveBeenCalledWith("benchmarks");
    expect(experiment.startSpan).toHaveBeenCalledWith({
      name: "iteration:3",
      type: "task",
    });
    expect(iterationSpan.log).toHaveBeenCalledWith({
      input: {
        brief: "Improve parser throughput",
        baseline: {
          tests: 10,
        },
        agent: "codex",
        iteration: 3,
      },
      output: {
        diff_summary: "Reduced allocations in parser",
        kept: true,
      },
      scores: {
        tests: 15,
        delta: 5,
      },
      metrics: {
        tests: 15,
        durationMs: 3210,
      },
      metadata: {
        commit: "keep-123",
      },
    });
    expect(iterationSpan.end).toHaveBeenCalledTimes(1);
    expect(client.recordError).not.toHaveBeenCalled();
  });
});

function createMockSpan() {
  return {
    startSpan: vi.fn(),
    log: vi.fn(),
    end: vi.fn(),
  };
}

function createMockClient(options: { experiment?: unknown } = {}): BraintrustClient {
  return {
    getSdk: vi.fn(),
    getRootLogger: vi.fn(),
    getExperiment: vi.fn(async () => options.experiment),
    flush: vi.fn(),
    recordError: vi.fn(),
    status: vi.fn(() => ({
      lastError: null,
      errorCount: 0,
      project: "project",
    })),
  };
}
