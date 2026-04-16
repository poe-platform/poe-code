import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RalphRunOptions } from "@poe-code/ralph";

const runWorkspaceRalphMock = vi.hoisted(() => vi.fn());
const spawnAutonomousMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/ralph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/ralph")>();
  return {
    ...actual,
    runRalph: runWorkspaceRalphMock
  };
});

vi.mock("./spawn.js", () => ({
  spawn: Object.assign(vi.fn(), {
    autonomous: spawnAutonomousMock
  })
}));

import { runRalph } from "./ralph.js";

describe("SDK ralph", () => {
  beforeEach(() => {
    runWorkspaceRalphMock.mockReset();
    spawnAutonomousMock.mockReset();
  });

  it("preserves a caller-provided runAgent", async () => {
    const customRunAgent = vi.fn().mockResolvedValue({
      stdout: "custom",
      stderr: "",
      exitCode: 0
    });

    runWorkspaceRalphMock.mockResolvedValue({
      stopReason: "max_iterations",
      docPath: "docs/loop.md",
      iterationsCompleted: 1,
      totalDurationMs: 1_000
    });

    await runRalph({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "docs/loop.md",
      runAgent: customRunAgent
    });

    expect(runWorkspaceRalphMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runAgent: customRunAgent
      })
    );
    expect(spawnAutonomousMock).not.toHaveBeenCalled();
  });

  it("wires the default autonomous runner when no runAgent is provided", async () => {
    const expectedResult = {
      stopReason: "max_iterations" as const,
      docPath: "docs/loop.md",
      iterationsCompleted: 2,
      totalDurationMs: 1_500
    };
    let capturedOptions: RalphRunOptions | undefined;

    runWorkspaceRalphMock.mockImplementationOnce(async (options: RalphRunOptions) => {
      capturedOptions = options;
      return expectedResult;
    });

    spawnAutonomousMock.mockResolvedValue({
      stdout: "done",
      stderr: "",
      exitCode: 0
    });

    const result = await runRalph({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "docs/loop.md"
    });

    expect(result).toEqual(expectedResult);
    expect(capturedOptions).toEqual(
      expect.objectContaining({
        cwd: "/repo",
        homeDir: "/home/test",
        docPath: "docs/loop.md",
        runAgent: expect.any(Function)
      })
    );

    const agentResult = await capturedOptions?.runAgent?.({
      agent: "codex",
      prompt: "Improve the doc",
      cwd: "/repo",
      model: "gpt-5.2"
    });

    expect(spawnAutonomousMock).toHaveBeenCalledWith("codex", {
      prompt: "Improve the doc",
      cwd: "/repo",
      model: "gpt-5.2",
      mode: "yolo"
    });
    expect(agentResult).toEqual({
      stdout: "done",
      stderr: "",
      exitCode: 0
    });
  });
});
