import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperimentRunOptions } from "@poe-code/experiment-loop";

const runExperimentLoopMock = vi.hoisted(() => vi.fn());
const renderAcpStreamMock = vi.hoisted(() => vi.fn(async () => {}));
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/experiment-loop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/experiment-loop")>();
  return {
    ...actual,
    runExperimentLoop: runExperimentLoopMock
  };
});

vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  return {
    ...actual,
    renderAcpStream: renderAcpStreamMock
  };
});

vi.mock("./spawn.js", () => ({
  spawn: spawnMock
}));

import { runExperiment } from "./experiment.js";

describe("SDK experiment", () => {
  beforeEach(() => {
    runExperimentLoopMock.mockReset();
    renderAcpStreamMock.mockReset();
    spawnMock.mockReset();
  });

  it("forwards CLI-parity options and wires the default agent runner", async () => {
    const expectedResult = {
      stopReason: "max_experiments" as const,
      docPath: "docs/loop.md",
      experimentsCompleted: 3,
      experimentsKept: 2,
      totalDurationMs: 1200
    };
    const onExperimentStart = vi.fn();
    const onExperimentComplete = vi.fn();
    let capturedOptions: ExperimentRunOptions | undefined;

    runExperimentLoopMock.mockImplementationOnce(async (options: ExperimentRunOptions) => {
      capturedOptions = options;
      return expectedResult;
    });

    const events = [{ type: "token" }];
    const resultPromise = Promise.resolve({
      stdout: "done",
      stderr: "",
      exitCode: 0
    });
    spawnMock.mockReturnValue({
      events,
      result: resultPromise
    });

    const result = await runExperiment({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "docs/loop.md",
      agent: "codex",
      model: "gpt-5.2",
      maxExperiments: 3,
      onExperimentStart,
      onExperimentComplete
    });

    expect(result).toEqual(expectedResult);
    expect(capturedOptions).toEqual(
      expect.objectContaining({
        cwd: "/repo",
        homeDir: "/home/test",
        docPath: "docs/loop.md",
        agent: "codex",
        model: "gpt-5.2",
        maxExperiments: 3,
        onExperimentStart,
        onExperimentComplete,
        runAgent: expect.any(Function)
      })
    );

    const agentResult = await capturedOptions?.runAgent?.({
      agent: "codex",
      prompt: "Improve the metric",
      cwd: "/repo",
      model: "gpt-5.2"
    });

    expect(spawnMock).toHaveBeenCalledWith("codex", {
      prompt: "Improve the metric",
      cwd: "/repo",
      model: "gpt-5.2",
      mode: "yolo",
      activityTimeoutMs: 10 * 60 * 1000
    });
    expect(renderAcpStreamMock).toHaveBeenCalledWith(events);
    expect(agentResult).toEqual({
      stdout: "done",
      stderr: "",
      exitCode: 0
    });
  });
});
