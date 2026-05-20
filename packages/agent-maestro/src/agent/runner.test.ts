import type { SpawnResult } from "@poe-code/agent-spawn";
import type { Task } from "@poe-code/task-list";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAttempt, type AttemptDeps } from "./runner.js";
import type { ResolvedConfig } from "../config/schema.js";
import { pipelineDriver } from "../drivers/pipeline.js";
import { registerDriver } from "../drivers/registry.js";

describe("runAttempt", () => {
  beforeEach(() => {
    registerDriver(pipelineDriver);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes explicit and default pipeline tasks through the pipeline driver", async () => {
    const driverRun = vi.spyOn(pipelineDriver, "run").mockResolvedValue({ reason: "normal" });

    await runAttempt({
      task: createTask({ metadata: { kind: "pipeline" } }),
      attempt: 1,
      cfg: createConfig(),
      deps: createDeps(),
      abort: new AbortController().signal
    });
    await runAttempt({
      task: createTask(),
      attempt: 1,
      cfg: createConfig(),
      deps: createDeps(),
      abort: new AbortController().signal
    });

    expect(driverRun).toHaveBeenCalledTimes(2);
    expect(driverRun.mock.calls.map(([ctx]) => ctx.task.metadata.kind)).toEqual([
      "pipeline",
      undefined
    ]);
  });

  it("passes task sourcePath as the workflow driver planPath", async () => {
    const driverRun = vi.spyOn(pipelineDriver, "run").mockResolvedValue({ reason: "normal" });

    await runAttempt({
      task: createTask({ sourcePath: "/repo/docs/plans/source.md" }),
      attempt: 1,
      cfg: createConfig(),
      planPath: "/repo/docs/plans/legacy.md",
      deps: createDeps(),
      abort: new AbortController().signal
    });

    expect(driverRun).toHaveBeenCalledWith(
      expect.objectContaining({
        planPath: "/repo/docs/plans/source.md"
      })
    );
  });
});

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    list: "tasks",
    id: "task-1",
    qualifiedId: "tasks/task-1",
    name: "Build runner",
    state: "in-progress",
    description: "Render this task body",
    metadata: {},
    ...overrides
  };
}

function createConfig(): ResolvedConfig {
  return {
    tasks: { type: "markdown-dir", path: "/repo/tasks" },
    states: {
      "in-progress": { prompt: "Implement {{ prompt }}" },
      done: { terminal: true }
    },
    activeStateNames: ["in-progress"],
    terminalStateNames: ["done"],
    stateOrder: ["in-progress", "done"],
    polling: { intervalMs: 30_000 },
    workspace: { root: "/tmp/poe-code-maestro" },
    agent: {
      service: "codex",
      list: "tasks",
      maxConcurrentAgents: 1,
      maxTurns: 20,
      maxRetryBackoffMs: 300_000
    }
  };
}

function createDeps(): AttemptDeps & { spawn: ReturnType<typeof vi.fn> } {
  return {
    spawn: vi.fn(async () => successSpawn())
  };
}

function successSpawn(): SpawnResult {
  return { stdout: "", stderr: "", exitCode: 0 };
}
