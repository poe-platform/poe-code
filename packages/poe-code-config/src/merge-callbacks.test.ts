import { describe, expect, it, vi } from "vitest";
import type { PipelineCallbackFields } from "./merge-callbacks.js";
import {
  mergeExperimentCallbacks,
  mergeLoopCallbacks,
  mergePipelineCallbacks
} from "./merge-callbacks.js";

describe("mergePipelineCallbacks", () => {
  it("runs user callbacks before added callbacks", () => {
    const calls: string[] = [];
    const merged = mergePipelineCallbacks(
      { onTaskStart: () => calls.push("user") },
      { onTaskStart: () => calls.push("added") }
    );

    merged?.onTaskStart?.({
      taskId: "task-1",
      taskTitle: "Task 1",
      stepName: "Build",
      taskIndex: 0,
      totalTasks: 1
    });

    expect(calls).toEqual(["user", "added"]);
  });

  it("propagates user callback errors without running the added callback", () => {
    const error = new Error("user failed");
    const added = vi.fn();
    const merged = mergePipelineCallbacks(
      {
        onTaskComplete: () => {
          throw error;
        }
      },
      { onTaskComplete: added }
    );

    expect(() =>
      merged?.onTaskComplete?.({
        taskId: "task-1",
        taskTitle: "Task 1",
        stepName: "Build",
        taskIndex: 0,
        totalTasks: 1,
        durationMs: 1,
        success: true
      })
    ).toThrow(error);
    expect(added).not.toHaveBeenCalled();
  });

  it("swallows added callback errors and warns once with the callback name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const merged = mergePipelineCallbacks(
      { onPlanResolved: vi.fn() },
      {
        onPlanResolved: () => {
          throw new Error("added failed");
        }
      }
    );

    expect(() =>
      merged?.onPlanResolved?.({
        planPath: "/tmp/plan.md",
        done: 0,
        failed: 0,
        open: 1,
        total: 1
      })
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("onPlanResolved");

    warn.mockRestore();
  });

  it("uses only-user and only-added callbacks directly", () => {
    const onlyUser: PipelineCallbackFields["onTaskStart"] = vi.fn();
    const onlyAdded: PipelineCallbackFields["onTaskComplete"] = vi.fn();

    const merged = mergePipelineCallbacks(
      { onTaskStart: onlyUser },
      { onTaskComplete: onlyAdded }
    );

    expect(merged?.onTaskStart).toBe(onlyUser);
    expect(merged?.onTaskComplete).toBe(onlyAdded);
  });
});

describe("mergeExperimentCallbacks", () => {
  it("runs user callbacks before added callbacks", () => {
    const calls: string[] = [];
    const merged = mergeExperimentCallbacks(
      { onExperimentStart: () => calls.push("user") },
      { onExperimentStart: () => calls.push("added") }
    );

    merged?.onExperimentStart?.(1, "codex");

    expect(calls).toEqual(["user", "added"]);
  });
});

describe("mergeLoopCallbacks", () => {
  it("preserves user return values while still running added callbacks", () => {
    const added = vi.fn();
    const merged = mergeLoopCallbacks(
      { shouldPause: () => true },
      { shouldPause: added }
    );

    expect(merged?.shouldPause?.()).toBe(true);
    expect(added).toHaveBeenCalledTimes(1);
  });
});
