import { describe, expect, it, vi } from "vitest";
import type { AgentRunnerSession } from "@poe-code/agent-harness-tools";

describe("runAutonomousAgent", () => {
  it("runs the role open spec through the injected session without syncing back", async () => {
    const session: AgentRunnerSession = {
      run: vi.fn(async () => ({
        kind: "sync" as const,
        exitCode: 0,
        stdout: "done",
        stderr: ""
      })),
      syncBack: vi.fn(async () => ({ files: 0, bytes: 0, conflicts: [] })),
      close: vi.fn(async () => {})
    };

    const { runAutonomousAgent } = await import("./agent-runner.js");
    const result = await runAutonomousAgent({
      agent: "claude-code",
      prompt: "Build the feature",
      cwd: "/repo",
      logPath: "/tmp/superintendent/builder.log",
      session
    });

    expect(result).toEqual({
      stdout: "done",
      logFile: "/tmp/superintendent/builder.log"
    });
    expect(session.run).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo",
        jobLabel: expect.objectContaining({
          tool: "claude-code"
        })
      }),
      undefined,
      { syncBack: false }
    );
  });

  it("throws when the injected session run exits non-zero", async () => {
    const session: AgentRunnerSession = {
      run: vi.fn(async () => ({
        kind: "sync" as const,
        exitCode: 2,
        stdout: "stdout details",
        stderr: "stderr details"
      })),
      syncBack: vi.fn(async () => ({ files: 0, bytes: 0, conflicts: [] })),
      close: vi.fn(async () => {})
    };

    const { runAutonomousAgent } = await import("./agent-runner.js");

    await expect(
      runAutonomousAgent({
        agent: "claude-code",
        prompt: "Build the feature",
        cwd: "/repo",
        session
      })
    ).rejects.toThrow("stderr details");

    expect(session.run).toHaveBeenCalledWith(expect.any(Object), undefined, {
      syncBack: false
    });
  });
});
