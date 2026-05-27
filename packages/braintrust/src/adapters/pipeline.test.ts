import type {
  PipelineRunOptions,
  PlanSummary,
  TaskCompletion,
  TaskProgress
} from "@poe-code/pipeline";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BraintrustClient } from "../client.js";
import { makePipelineRowState } from "../row-builder.js";
import { createPipelineCallbacks } from "./pipeline.js";

vi.mock("../row-builder.js", () => ({
  makePipelineRowState: vi.fn()
}));

const mockMakePipelineRowState = vi.mocked(makePipelineRowState);

describe("createPipelineCallbacks", () => {
  beforeEach(() => {
    mockMakePipelineRowState.mockReset();
  });

  it("creates pipeline row state with the client", () => {
    const rowState = createRowState();
    const client = createMockClient();
    mockMakePipelineRowState.mockReturnValue(rowState);

    createPipelineCallbacks(client);

    expect(mockMakePipelineRowState).toHaveBeenCalledWith(client);
  });

  it("wires every pipeline callback surface", () => {
    const rowState = createRowState();
    const client = createMockClient();
    mockMakePipelineRowState.mockReturnValue(rowState);
    const callbacks = createPipelineCallbacks(client);
    const summary = {
      planPath: "/repo/docs/plans/feature.md",
      done: 1,
      failed: 0,
      open: 2,
      total: 3
    } satisfies PlanSummary;
    const started = {
      taskId: "task-1",
      taskTitle: "Build adapter",
      stepName: "builder",
      taskIndex: 1,
      totalTasks: 3,
      stepIndex: 0,
      totalSteps: 2
    } satisfies TaskProgress;
    const completed = {
      ...started,
      durationMs: 42,
      success: true
    } satisfies TaskCompletion;
    expect(callbacks.onPlanResolved).toBeTypeOf("function");
    expect(callbacks.onTaskStart).toBeTypeOf("function");
    expect(callbacks.onTaskComplete).toBeTypeOf("function");

    callbacks.onPlanResolved(summary);
    callbacks.onTaskStart(started);
    callbacks.onTaskComplete(completed);

    expect(rowState.start).toHaveBeenCalledWith(started);
    expect(rowState.complete).toHaveBeenCalledWith(completed);
    expect(rowState.start).toHaveBeenCalledTimes(1);
    expect(rowState.complete).toHaveBeenCalledTimes(1);
  });
});

function createRowState(): ReturnType<typeof makePipelineRowState> {
  return {
    start: vi.fn(),
    complete: vi.fn()
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
      project: "project"
    }))
  };
}

type ignoredPipelineCallbackFields = Pick<
  PipelineRunOptions,
  "onPlanResolved" | "onTaskStart" | "onTaskComplete"
>;
