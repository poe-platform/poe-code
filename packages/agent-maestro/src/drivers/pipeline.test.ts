import { describe, expect, it, vi } from "vitest";

import {
  createConfig,
  createDriverContext,
  createTask,
  successSpawn
} from "../__test_utils__/fixtures.js";
import { pipelineDriver } from "./pipeline.js";

describe("pipelineDriver", () => {
  it("dispatches a planned task with the planned prompt and workflow default agent/model", async () => {
    const spawn = vi.fn(async () => successSpawn());
    const ctx = createDriverContext({ spawn });

    await expect(pipelineDriver.run(ctx)).resolves.toEqual({ reason: "normal" });

    expect(spawn).toHaveBeenCalledWith("codex", {
      prompt: "Plan tasks/task-1: Build runner\n\nRender this task body",
      model: undefined,
      mode: "yolo",
      signal: ctx.abort
    });
  });

  it("dispatches with state agent and model overrides over the workflow default", async () => {
    const spawn = vi.fn(async () => successSpawn());
    const ctx = createDriverContext({
      task: createTask({ state: "implementation" }),
      spawn,
      cfg: createConfig({
        agent: { service: "codex" },
        states: {
          implementation: {
            prompt: "Implement {{ task.id }}",
            agent: "claude",
            model: "claude-sonnet-4-6"
          },
          done: { terminal: true }
        }
      })
    });

    await expect(pipelineDriver.run(ctx)).resolves.toEqual({ reason: "normal" });

    expect(spawn).toHaveBeenCalledWith("claude", {
      prompt: "Implement task-1",
      model: "claude-sonnet-4-6",
      mode: "yolo",
      signal: ctx.abort
    });
  });

  it("dispatches with the state mode override", async () => {
    const spawn = vi.fn(async () => successSpawn());
    const ctx = createDriverContext({
      task: createTask({ state: "review" }),
      spawn,
      cfg: createConfig({
        states: {
          review: {
            prompt: "Review {{ task.id }}",
            mode: "read"
          },
          done: { terminal: true }
        }
      })
    });

    await expect(pipelineDriver.run(ctx)).resolves.toEqual({ reason: "normal" });

    expect(spawn).toHaveBeenCalledWith("codex", {
      prompt: "Review task-1",
      model: undefined,
      mode: "read",
      signal: ctx.abort
    });
  });

  it("does not dispatch terminal states", async () => {
    const spawn = vi.fn(async () => successSpawn());
    const ctx = createDriverContext({
      task: createTask({ state: "done" }),
      spawn
    });

    await expect(pipelineDriver.run(ctx)).resolves.toEqual({ reason: "normal" });

    expect(spawn).not.toHaveBeenCalled();
  });

  it("warns and does not dispatch an unconfigured state", async () => {
    const spawn = vi.fn(async () => successSpawn());
    const logger = { warn: vi.fn() };
    const ctx = createDriverContext({
      task: createTask({ state: "reviewing" }),
      spawn,
      logger
    });

    await expect(pipelineDriver.run(ctx)).resolves.toEqual({ reason: "normal" });

    expect(spawn).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith("unconfigured state", {
      task_id: "tasks/task-1",
      state: "reviewing"
    });
  });
});
