import { describe, expect, it } from "vitest";

import {
  cancelRetry,
  claim,
  createState,
  markCompleted,
  markRunning,
  release,
  scheduleRetry
} from "./state.js";
import type { ResolvedConfig } from "../config/schema.js";

describe("runtime state", () => {
  it("keeps claim and release symmetric", () => {
    const state = createState(createConfig());

    expect(claim(state, "task-1")).toBe(true);
    expect(state.claimed.has("task-1")).toBe(true);

    release(state, "task-1");

    expect(state.claimed.has("task-1")).toBe(false);
    expect(state.running.has("task-1")).toBe(false);
    expect(state.retry_attempts.has("task-1")).toBe(false);
  });

  it("rejects a double claim", () => {
    const state = createState(createConfig());

    expect(claim(state, "task-1")).toBe(true);
    expect(claim(state, "task-1")).toBe(false);
  });

  it("keeps running and retry sets disjoint", () => {
    const state = createState(createConfig());

    expect(claim(state, "task-1")).toBe(true);
    markRunning(state, { taskId: "task-1", attempt: 1 });
    scheduleRetry(state, { taskId: "task-1", attempt: 2, dueAt: 123 });

    expect(state.running.has("task-1")).toBe(false);
    expect(state.retry_attempts.get("task-1")).toEqual({
      taskId: "task-1",
      attempt: 2,
      dueAt: 123
    });

    markRunning(state, { taskId: "task-1", attempt: 2 });

    expect(state.running.get("task-1")).toEqual({ taskId: "task-1", attempt: 2 });
    expect(state.retry_attempts.has("task-1")).toBe(false);
  });

  it("keeps retry queue ownership separate from active claims", () => {
    const state = createState(createConfig());

    expect(claim(state, "task-1")).toBe(true);
    scheduleRetry(state, { taskId: "task-1", attempt: 1, dueAt: 456 });
    expect(state.claimed.has("task-1")).toBe(false);
    expect(claim(state, "task-1")).toBe(false);

    cancelRetry(state, "task-1");

    expect(claim(state, "task-1")).toBe(true);
    expect(state.retry_attempts.has("task-1")).toBe(false);
  });

  it("marks completed tasks as released and unavailable for new claims", () => {
    const state = createState(createConfig());

    expect(claim(state, "task-1")).toBe(true);
    markCompleted(state, "task-1");

    expect(state.completed.has("task-1")).toBe(true);
    expect(state.claimed.has("task-1")).toBe(false);
    expect(claim(state, "task-1")).toBe(false);
  });

  it("does not resurrect completed tasks as running or retrying", () => {
    const state = createState(createConfig());

    markCompleted(state, "task-1");
    markRunning(state, { taskId: "task-1", attempt: 1 });
    scheduleRetry(state, { taskId: "task-1", attempt: 2, dueAt: 123 });

    expect(state.completed.has("task-1")).toBe(true);
    expect(state.claimed.has("task-1")).toBe(false);
    expect(state.running.has("task-1")).toBe(false);
    expect(state.retry_attempts.has("task-1")).toBe(false);
  });
});

function createConfig(): ResolvedConfig {
  return {
    states: {
      queued: { prompt: "Queue {{ prompt }}" },
      done: { terminal: true }
    },
    activeStateNames: ["queued"],
    terminalStateNames: ["done"],
    stateOrder: ["queued", "done"],
    polling: { intervalMs: 30_000 },
    workspace: { root: "/tmp/maestro" },
    agent: {
      service: "codex",
      maxConcurrentAgents: 1,
      maxRetryBackoffMs: 300_000
    }
  };
}
