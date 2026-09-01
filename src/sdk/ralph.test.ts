import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RalphRunOptions } from "@poe-code/ralph";

const runWorkspaceRalphMock = vi.hoisted(() => vi.fn());
const spawnAutonomousMock = vi.hoisted(() => vi.fn());
const buildSpawnArgsMock = vi.hoisted(() => vi.fn());
const createPoeCommandSessionMock = vi.hoisted(() => vi.fn());
const resolvePoeCommandExecutionMock = vi.hoisted(() => vi.fn());
const runWithOptionalWorktreeMock = vi.hoisted(() => vi.fn());

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
  buildSpawnArgs: buildSpawnArgsMock
}));

vi.mock("@poe-code/agent-harness-tools", () => ({
  createPoeCommandSession: createPoeCommandSessionMock,
  resolvePoeCommandExecution: resolvePoeCommandExecutionMock
}));


vi.mock("./worktree.js", () => ({
  runWithOptionalWorktree: runWithOptionalWorktreeMock
}));

import { runRalph } from "./ralph.js";

describe("SDK ralph", () => {
  beforeEach(() => {
    runWorkspaceRalphMock.mockReset();
    spawnAutonomousMock.mockReset();
    buildSpawnArgsMock.mockReset();
    createPoeCommandSessionMock.mockReset();
    resolvePoeCommandExecutionMock.mockReset();
    runWithOptionalWorktreeMock.mockReset();
    runWithOptionalWorktreeMock.mockImplementation(async (input) => {
      const value = await input.run({
        sourceCwd: input.cwd,
        worktreeCwd: "/repo/.poe-code/worktrees/ralph",
        worktree: {
          name: "ralph",
          path: "/repo/.poe-code/worktrees/ralph",
          branch: "poe-code/ralph",
          baseBranch: "HEAD",
          createdAt: "2026-01-01T00:00:00.000Z",
          source: "sdk",
          agent: input.selectedAgent,
          status: "active"
        }
      });
      return { value };
    });
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

  it("wraps the whole Ralph run in one worktree when enabled", async () => {
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
      agent: "codex",
      worktree: true
    });

    expect(runWithOptionalWorktreeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo",
        selectedAgent: "codex",
        worktree: true
      })
    );
    expect(runWorkspaceRalphMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo/.poe-code/worktrees/ralph",
        docPath: "docs/loop.md"
      })
    );
  });

  it.each(["completed", "max_iterations", "failed", "cancelled"] as const)(
    "classifies %s without changing the returned workflow result",
    async (stopReason) => {
      const value = { stopReason, docPath: "docs/loop.md", iterationsCompleted: 1, totalDurationMs: 1 };
      runWorkspaceRalphMock.mockResolvedValueOnce(value);
      const result = await runRalph({
        cwd: "/repo", homeDir: "/home/test", docPath: "docs/loop.md", agent: "codex", worktree: true
      });

      expect(result).toBe(value);
      const input = runWithOptionalWorktreeMock.mock.calls[0]![0];
      expect(input.isSuccessful(value)).toBe(stopReason === "completed" || stopReason === "max_iterations");
    }
  );

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
      model: "gpt-5.2",
      hooks: { from: "claude" },
      skills: ["foo", "claude/bar"],
      logDir: "/home/test/.poe-code/logs/ralph/loop",
      logFileName: "run-codex.jsonl"
    });

    expect(spawnAutonomousMock).toHaveBeenCalledWith("codex", {
      prompt: "Improve the doc",
      cwd: "/repo",
      model: "gpt-5.2",
      hooks: { from: "claude" },
      skills: ["foo", "claude/bar"],
      logDir: "/home/test/.poe-code/logs/ralph/loop",
      logFileName: "run-codex.jsonl",
      runtime: "docker",
      runtimeImage: "poe-code:test",
      detach: true
    });
    expect(agentResult).toEqual({
      stdout: "done",
      stderr: "",
      exitCode: 0
    });

    await capturedOptions?.runAgent?.({
      agent: "codex",
      prompt: "Improve without hooks",
      cwd: "/repo",
      model: "gpt-5.2"
    });

    expect(spawnAutonomousMock).toHaveBeenLastCalledWith("codex", {
      prompt: "Improve without hooks",
      cwd: "/repo",
      model: "gpt-5.2",
      runtime: "docker",
      runtimeImage: "poe-code:test",
      detach: true
    });
  });


});
