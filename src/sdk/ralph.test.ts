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
      mode: "yolo",
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
      mode: "yolo",
      runtime: "docker",
      runtimeImage: "poe-code:test",
      detach: true
    });
  });

  it("uses autonomous spawn for hook-enabled e2b Ralph iterations", async () => {
    let capturedOptions: RalphRunOptions | undefined;

    spawnAutonomousMock.mockResolvedValue({
      stdout: "done",
      stderr: "",
      exitCode: 0
    });
    runWorkspaceRalphMock.mockImplementationOnce(async (options: RalphRunOptions) => {
      capturedOptions = options;
      await options.runAgent?.({
        agent: "codex",
        prompt: "Bridge hooks",
        cwd: "/tmp/ralph",
        hooks: { from: "claude" }
      });
      return {
        stopReason: "max_iterations",
        docPath: "/tmp/ralph/plan.md",
        iterationsCompleted: 1,
        totalDurationMs: 1_000
      };
    });

    await runRalph({
      cwd: "/tmp/ralph",
      homeDir: "/home/test",
      docPath: "/tmp/ralph/plan.md",
      runtime: "e2b",
      runtimeTemplate: "tmpl_test"
    });

    expect(capturedOptions?.runAgent).toEqual(expect.any(Function));
    expect(spawnAutonomousMock).toHaveBeenCalledWith("codex", {
      prompt: "Bridge hooks",
      cwd: "/tmp/ralph",
      model: undefined,
      mode: "yolo",
      hooks: { from: "claude" },
      runtime: "e2b",
      runtimeTemplate: "tmpl_test"
    });
    expect(createPoeCommandSessionMock).not.toHaveBeenCalled();
    expect(buildSpawnArgsMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "skills",
      input: { skills: ["foo"] },
      expected: { skills: ["foo"] }
    },
    {
      label: "log routing",
      input: { logDir: "/home/test/.poe-code/logs/ralph/plan", logFileName: "iteration.jsonl" },
      expected: { logDir: "/home/test/.poe-code/logs/ralph/plan", logFileName: "iteration.jsonl" }
    }
  ])("uses autonomous spawn for e2b Ralph iterations with $label", async ({ input, expected }) => {
    spawnAutonomousMock.mockResolvedValue({ stdout: "done", stderr: "", exitCode: 0 });
    runWorkspaceRalphMock.mockImplementationOnce(async (options: RalphRunOptions) => {
      await options.runAgent?.({
        agent: "codex",
        prompt: "Bridge metadata",
        cwd: "/tmp/ralph",
        ...input
      });
      return { stopReason: "max_iterations", docPath: "/tmp/ralph/plan.md", iterationsCompleted: 1, totalDurationMs: 1 };
    });

    await runRalph({ cwd: "/tmp/ralph", homeDir: "/home/test", docPath: "/tmp/ralph/plan.md", runtime: "e2b" });

    expect(spawnAutonomousMock).toHaveBeenCalledWith("codex", expect.objectContaining(expected));
    expect(createPoeCommandSessionMock).not.toHaveBeenCalled();
    expect(buildSpawnArgsMock).not.toHaveBeenCalled();
  });

  it("reuses one e2b command session for the default Ralph runner", async () => {
    const run = vi.fn().mockResolvedValue({
      kind: "sync",
      stdout: "done",
      stderr: "",
      exitCode: 0,
      download: { files: 1, bytes: 12, conflicts: [] }
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const factory = { type: "e2b" };
    const state = { jobs: {} };
    let capturedOptions: RalphRunOptions | undefined;
    const originalPoeApiKey = process.env.POE_API_KEY;

    delete process.env.POE_API_KEY;
    buildSpawnArgsMock
      .mockReturnValueOnce({ binaryName: "claude", args: ["-p", "first"] })
      .mockReturnValueOnce({ binaryName: "claude", args: ["-p", "second"] });
    resolvePoeCommandExecutionMock.mockReturnValue({
      factory,
      state,
      detach: false,
      openSpec: {
        cwd: "/tmp/ralph",
        runner: {
          detach: false,
          upload_max_file_mb: 100,
          download_conflict: "refuse"
        },
        jobLabel: { tool: "claude-code", argv: ["claude", "-p", "prompt"] }
      }
    });
    createPoeCommandSessionMock.mockReturnValue({ run, close });
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
        runtime: "e2b",
        runtimeTemplate: "tmpl_test"
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
    expect(createPoeCommandSessionMock).toHaveBeenCalledTimes(1);
    expect(createPoeCommandSessionMock).toHaveBeenCalledWith({ factory, state });
    expect(buildSpawnArgsMock).toHaveBeenNthCalledWith(1, "claude-code", {
      prompt: "first",
      model: "sonnet",
      mode: "yolo"
    });
    expect(buildSpawnArgsMock).toHaveBeenNthCalledWith(2, "claude-code", {
      prompt: "second",
      model: "sonnet",
      mode: "yolo"
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        runner: expect.objectContaining({ download_conflict: "overwrite" })
      })
    );
    expect(resolvePoeCommandExecutionMock).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not reject a completed reusable e2b run when session close fails", async () => {
    const priorKey = process.env.POE_API_KEY;
    process.env.POE_API_KEY = "sk-test";
    buildSpawnArgsMock.mockReturnValue({ binaryName: "codex", args: ["exec"] });
    resolvePoeCommandExecutionMock.mockReturnValue({ factory: {}, state: {}, openSpec: {} });
    createPoeCommandSessionMock.mockReturnValue({
      run: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
      close: vi.fn(async () => { throw new Error("session close denied"); })
    });
    runWorkspaceRalphMock.mockImplementationOnce(async (options: RalphRunOptions) => {
      await options.runAgent?.({ agent: "codex", prompt: "go", cwd: "/repo" });
      return { stopReason: "max_iterations", docPath: "/repo/plan.md", iterationsCompleted: 1, totalDurationMs: 1 };
    });

    try {
      await expect(runRalph({ cwd: "/repo", homeDir: "/home/test", docPath: "/repo/plan.md", runtime: "e2b" }))
        .resolves.toMatchObject({ stopReason: "max_iterations" });
    } finally {
      if (priorKey === undefined) delete process.env.POE_API_KEY;
      else process.env.POE_API_KEY = priorKey;
    }
  });

  it("does not export a stored Poe key when reusable e2b agent validation fails", async () => {
    const priorKey = process.env.POE_API_KEY;
    delete process.env.POE_API_KEY;
    buildSpawnArgsMock.mockImplementation(() => { throw new Error('Unknown agent "invalid".'); });
    runWorkspaceRalphMock.mockImplementationOnce(async (options: RalphRunOptions) => {
      await options.runAgent?.({ agent: "invalid", prompt: "go", cwd: "/repo" });
      return { stopReason: "max_iterations", docPath: "/repo/plan.md", iterationsCompleted: 1, totalDurationMs: 1 };
    });

    try {
      await expect(runRalph({ cwd: "/repo", homeDir: "/home/test", docPath: "/repo/plan.md", runtime: "e2b" }))
        .rejects.toThrow("Unknown agent");
      expect(process.env.POE_API_KEY).toBeUndefined();
    } finally {
      if (priorKey === undefined) delete process.env.POE_API_KEY;
      else process.env.POE_API_KEY = priorKey;
    }
  });
});
