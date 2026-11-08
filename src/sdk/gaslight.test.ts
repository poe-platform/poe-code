import { beforeEach, describe, expect, it, vi } from "vitest";

const runWorkspaceGaslightMock = vi.hoisted(() => vi.fn());
const runWithOptionalWorktreeMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/agent-gaslight", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-gaslight")>();
  return {
    ...actual,
    runGaslight: runWorkspaceGaslightMock
  };
});

vi.mock("./worktree.js", () => ({
  runWithOptionalWorktree: runWithOptionalWorktreeMock
}));

const { runGaslight } = await import("./gaslight.js");

describe("SDK gaslight", () => {
  beforeEach(() => {
    runWorkspaceGaslightMock.mockReset();
    runWithOptionalWorktreeMock.mockReset();
    runWorkspaceGaslightMock.mockResolvedValue({ rounds: [], plans: [] });
    runWithOptionalWorktreeMock.mockImplementation(async (input) => {
      const value = await input.run({
        sourceCwd: input.cwd,
        worktreeCwd: "/repo/.poe-code/worktrees/gaslight",
        worktree: {
          name: "gaslight",
          path: "/repo/.poe-code/worktrees/gaslight",
          branch: "poe-code/gaslight",
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

  it("runs the package gaslight runner directly by default", async () => {
    await runGaslight({
      cwd: "/repo",
      homeDir: "/home/test",
      planPaths: ["docs/plans/plan.md"],
      agent: "codex"
    });

    expect(runWithOptionalWorktreeMock).not.toHaveBeenCalled();
    expect(runWorkspaceGaslightMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo",
        planPaths: ["docs/plans/plan.md"],
        agent: "codex"
      })
    );
  });

  it("wraps the whole gaslight run in one worktree when enabled", async () => {
    await runGaslight({
      cwd: "/repo",
      homeDir: "/home/test",
      planPaths: ["docs/plans/plan.md"],
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
    expect(runWorkspaceGaslightMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo/.poe-code/worktrees/gaslight",
        planPaths: ["docs/plans/plan.md"],
        agent: "codex"
      })
    );
  });
});
