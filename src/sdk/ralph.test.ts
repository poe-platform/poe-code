import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RalphRunOptions } from "@poe-code/ralph";

const runWorkspaceRalphMock = vi.hoisted(() => vi.fn());
const spawnAutonomousMock = vi.hoisted(() => vi.fn());
const createSpawnSessionMock = vi.hoisted(() => vi.fn());
const getPoeApiKeyMock = vi.hoisted(() => vi.fn());

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

vi.mock("@poe-code/agent-spawn", () => ({
  createSpawnSession: createSpawnSessionMock
}));

vi.mock("./credentials.js", () => ({
  getPoeApiKey: getPoeApiKeyMock
}));

import { runRalph } from "./ralph.js";

describe("SDK ralph", () => {
  beforeEach(() => {
    runWorkspaceRalphMock.mockReset();
    spawnAutonomousMock.mockReset();
    createSpawnSessionMock.mockReset();
    getPoeApiKeyMock.mockReset();
    getPoeApiKeyMock.mockResolvedValue("sk-test");
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

  it("uses the autonomous runner when detach is enabled", async () => {
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
      docPath: "docs/loop.md",
      runtime: "docker",
      runtimeImage: "poe-code:test",
      detach: true
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
      mode: "yolo",
      runtime: "docker",
      runtimeImage: "poe-code:test",
      detach: true
    });
    expect(agentResult).toEqual({
      stdout: "done",
      stderr: "",
      exitCode: 0
    });
  });

  it("reuses one command session for the default Ralph runner", async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: "done",
      stderr: "",
      exitCode: 0
    });
    const syncBack = vi.fn().mockResolvedValue({ files: 1, bytes: 2, conflicts: [] });
    const close = vi.fn().mockResolvedValue(undefined);
    let capturedOptions: RalphRunOptions | undefined;
    const originalPoeApiKey = process.env.POE_API_KEY;

    process.env.POE_API_KEY = "sk-test";
    createSpawnSessionMock.mockReturnValue({ run, syncBack, close });
    runWorkspaceRalphMock.mockImplementationOnce(async (options: RalphRunOptions) => {
      capturedOptions = options;
      await options.runAgent?.({
        agent: "claude-code",
        prompt: "first",
        cwd: "/tmp/ralph",
        model: "sonnet"
      });
      await options.runAgent?.({
        agent: "claude-code",
        prompt: "second",
        cwd: "/tmp/ralph",
        model: "sonnet"
      });
      return {
        stopReason: "max_iterations",
        docPath: "/tmp/ralph/plan.md",
        iterationsCompleted: 2,
        totalDurationMs: 1_000
      };
    });

    try {
      await runRalph({
        cwd: "/tmp/ralph",
        homeDir: "/home/test",
        docPath: "/tmp/ralph/plan.md",
        runtime: "docker",
        runtimeImage: "poe-code:test",
        runtimeTemplate: "tmpl_test",
        runnerSync: "upload"
      });
    } finally {
      if (originalPoeApiKey === undefined) {
        delete process.env.POE_API_KEY;
      } else {
        process.env.POE_API_KEY = originalPoeApiKey;
      }
    }

    expect(capturedOptions?.runAgent).toEqual(expect.any(Function));
    expect(spawnAutonomousMock).not.toHaveBeenCalled();
    expect(createSpawnSessionMock).toHaveBeenCalledTimes(1);
    expect(createSpawnSessionMock).toHaveBeenCalledWith({
      service: "claude-code",
      cwd: "/tmp/ralph",
      mode: "yolo",
      runtime: "docker",
      runtimeImage: "poe-code:test",
      runtimeTemplate: "tmpl_test",
      runnerSync: "upload",
      downloadConflict: "overwrite",
      context: {
        homeDir: "/home/test"
      }
    });
    expect(run).toHaveBeenNthCalledWith(2, {
      prompt: "second",
      agent: "claude-code",
      cwd: "/tmp/ralph",
      model: "sonnet",
      signal: undefined,
      syncBack: false
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.[0]).toEqual({
      prompt: "first",
      agent: "claude-code",
      cwd: "/tmp/ralph",
      model: "sonnet",
      signal: undefined,
      syncBack: false
    });
    expect(syncBack).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("syncs back and closes the command session when Ralph fails", async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: "done",
      stderr: "",
      exitCode: 0
    });
    const syncBack = vi.fn().mockResolvedValue({ files: 1, bytes: 2, conflicts: [] });
    const close = vi.fn().mockResolvedValue(undefined);
    const failure = new Error("ralph failed");

    createSpawnSessionMock.mockReturnValue({ run, syncBack, close });
    runWorkspaceRalphMock.mockRejectedValueOnce(failure);

    await expect(
      runRalph({
        cwd: "/repo",
        homeDir: "/home/test",
        docPath: "docs/loop.md"
      })
    ).rejects.toThrow("ralph failed");

    expect(syncBack).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("finalizes the command session when Ralph prepares terminal status writes", async () => {
    const events: string[] = [];
    const run = vi.fn().mockResolvedValue({
      stdout: "done",
      stderr: "",
      exitCode: 0
    });
    const syncBack = vi.fn(async () => {
      events.push("sync");
      return { files: 1, bytes: 2, conflicts: [] };
    });
    const close = vi.fn(async () => {
      events.push("close");
    });
    const originalPoeApiKey = process.env.POE_API_KEY;

    process.env.POE_API_KEY = "sk-test";
    createSpawnSessionMock.mockReturnValue({ run, syncBack, close });
    runWorkspaceRalphMock.mockImplementationOnce(async (options: RalphRunOptions) => {
      await options.prepareFinalWorkspace?.();
      events.push("status");
      await options.prepareFinalWorkspace?.();
      return {
        stopReason: "max_iterations",
        docPath: "docs/loop.md",
        iterationsCompleted: 1,
        totalDurationMs: 1_000
      };
    });

    try {
      await runRalph({
        cwd: "/repo",
        homeDir: "/home/test",
        docPath: "docs/loop.md"
      });
    } finally {
      if (originalPoeApiKey === undefined) {
        delete process.env.POE_API_KEY;
      } else {
        process.env.POE_API_KEY = originalPoeApiKey;
      }
    }

    expect(events).toEqual(["sync", "close", "status"]);
    expect(syncBack).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
