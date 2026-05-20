import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createConfig, createMockSpawn, createTask } from "../__test_utils__/index.js";
import { pipelineDriver } from "../drivers/pipeline.js";
import { registerDriver } from "../drivers/registry.js";
import { runAttempt } from "./runner.js";

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
      deps: { spawn: createMockSpawn().spawn },
      abort: new AbortController().signal
    });
    await runAttempt({
      task: createTask(),
      attempt: 1,
      cfg: createConfig(),
      deps: { spawn: createMockSpawn().spawn },
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
      deps: { spawn: createMockSpawn().spawn },
      abort: new AbortController().signal
    });

    expect(driverRun).toHaveBeenCalledWith(
      expect.objectContaining({
        planPath: "/repo/docs/plans/source.md"
      })
    );
  });
});
