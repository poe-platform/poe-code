import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SpawnResult } from "./types.js";

const worktreeMocks = vi.hoisted(() => ({
  createWorktree: vi.fn(),
  reconcileWorktree: vi.fn(),
  listWorktrees: vi.fn(),
  removeWorktree: vi.fn(),
  updateWorktreeEntry: vi.fn()
}));

vi.mock("@poe-code/worktree", () => worktreeMocks);

const { reconcileManagedWorktree, runInWorktree, runWithOptionalWorktree } = await import(
  "./worktree.js"
);

describe("runInWorktree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    worktreeMocks.createWorktree.mockResolvedValue({
      name: "wt",
      path: "/repo/.poe-code/worktrees/wt",
      branch: "poe-code/wt",
      baseBranch: "HEAD",
      createdAt: "2026-01-01T00:00:00.000Z",
      source: "sdk",
      agent: "codex",
      status: "active",
      sourceCwd: "/repo",
      baseHead: "abc123"
    });
    worktreeMocks.reconcileWorktree.mockResolvedValue({
      committed: "merged_by_agent",
      uncommitted: "applied_by_agent",
      removed: true,
      cleanup: "removed_by_agent",
      conflictFiles: [],
      threadId: "thread-1"
    });
    worktreeMocks.updateWorktreeEntry.mockImplementation(async (_registryFile, _name, update) =>
      update(await worktreeMocks.createWorktree.mock.results[0]!.value)
    );
  });

  it("creates a managed worktree and passes the worktree cwd to the callback", async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });

    const result = await runInWorktree({
      cwd: "/repo",
      selectedAgent: "codex",
      worktree: true,
      spawnAgent: async () => spawnResult(),
      run
    });

    expect(worktreeMocks.createWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo",
        name: expect.any(String),
        baseBranch: "HEAD",
        source: "sdk",
        agent: "codex",
        sourceCwd: "/repo"
      })
    );
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceCwd: "/repo",
        worktreeCwd: "/repo/.poe-code/worktrees/wt"
      })
    );
    expect(result.value).toEqual({ ok: true });
  });

  it("reconciles successful callback output through the selected SDK spawn agent", async () => {
    const spawnAgent = vi.fn().mockResolvedValue(spawnResult({ threadId: "thread-1" }));

    await runInWorktree({
      cwd: "/repo",
      selectedAgent: "codex",
      worktree: true,
      spawnAgent,
      run: async () => "done"
    });

    expect(worktreeMocks.reconcileWorktree).toHaveBeenCalledTimes(1);
    const reconciliationAgent =
      worktreeMocks.reconcileWorktree.mock.calls[0]![0].reconciliationAgent;
    const agentResult = await reconciliationAgent({
      phase: "reconcile",
      sourceCwd: "/repo",
      worktree: worktreeMocks.createWorktree.mock.results[0]!.value,
      prompt: "prompt",
      summary: {
        committed: "present",
        uncommitted: "present",
        removed: false,
        cleanup: "not_needed",
        conflictFiles: []
      }
    });

    expect(spawnAgent).toHaveBeenCalledWith("codex", {
      cwd: "/repo",
      prompt: "prompt",
      worktree: false
    });
    expect(agentResult.threadId).toBe("thread-1");
  });

  it("uses the selected model for reconciliation", async () => {
    const spawnAgent = vi.fn().mockResolvedValue(spawnResult());

    await runInWorktree({
      cwd: "/repo",
      selectedAgent: "codex",
      selectedModel: "sonnet",
      worktree: true,
      spawnAgent,
      run: async () => "done"
    });

    const reconciliationAgent =
      worktreeMocks.reconcileWorktree.mock.calls[0]![0].reconciliationAgent;
    await reconciliationAgent({
      phase: "cleanup-nudge",
      sourceCwd: "/repo",
      worktree: await worktreeMocks.createWorktree.mock.results[0]!.value,
      prompt: "cleanup",
      resumeThreadId: "thread-1",
      summary: {
        committed: "merged_by_agent",
        uncommitted: "none",
        removed: false,
        cleanup: "not_needed",
        conflictFiles: []
      }
    });

    expect(spawnAgent).toHaveBeenCalledWith("codex", {
      cwd: "/repo",
      prompt: "cleanup",
      model: "sonnet",
      resumeThreadId: "thread-1",
      worktree: false
    });
  });

  it("marks failed worktrees without reconciling when the callback fails", async () => {
    const spawnAgent = vi.fn().mockResolvedValue(spawnResult({ threadId: "cleanup-thread" }));
    const deps = createFailureDeps({
      worktreeHead: "abc123",
      worktreeStatus: "",
      worktreeList: ""
    });

    await expect(runInWorktree({
      cwd: "/repo",
      selectedAgent: "codex",
      worktree: true,
      spawnAgent,
      deps,
      run: async () => {
        throw new Error("callback failed");
      }
    })).rejects.toThrow("callback failed");

    expect(worktreeMocks.reconcileWorktree).not.toHaveBeenCalled();
    expect(worktreeMocks.updateWorktreeEntry).toHaveBeenCalledWith(
      "/repo/.poe-code/worktrees.yaml",
      "wt",
      expect.any(Function),
      expect.any(Object)
    );
    expect(spawnAgent).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({
        cwd: "/repo",
        prompt: expect.stringContaining("produced no worktree changes"),
        worktree: false
      })
    );
    expect(spawnAgent.mock.calls[0]![1]).not.toHaveProperty("mode");
  });

  it("leaves changed failed worktrees in place without asking cleanup", async () => {
    const spawnAgent = vi.fn().mockResolvedValue(spawnResult());
    const deps = createFailureDeps({
      worktreeHead: "def456",
      worktreeStatus: " M src/file.ts\0",
      worktreeList: `worktree /repo/.poe-code/worktrees/wt\n`
    });

    await expect(runInWorktree({
      cwd: "/repo",
      selectedAgent: "codex",
      worktree: true,
      spawnAgent,
      deps,
      run: async () => {
        throw new Error("callback failed");
      }
    })).rejects.toThrow("callback failed");

    expect(worktreeMocks.reconcileWorktree).not.toHaveBeenCalled();
    expect(spawnAgent).not.toHaveBeenCalled();
  });
});

describe("reconcileManagedWorktree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    worktreeMocks.reconcileWorktree.mockResolvedValue({
      committed: "none",
      uncommitted: "none",
      removed: true,
      cleanup: "removed_by_agent",
      conflictFiles: []
    });
  });

  it("lets the shared spawn boundary choose the reconciliation mode", async () => {
    const spawnAgent = vi.fn().mockResolvedValue(spawnResult());

    await reconcileManagedWorktree({
      cwd: "/repo",
      name: "wt",
      agent: "codex",
      spawnAgent
    });

    const reconciliationAgent =
      worktreeMocks.reconcileWorktree.mock.calls[0]![0].reconciliationAgent;
    await reconciliationAgent({
      phase: "reconcile",
      sourceCwd: "/repo",
      worktree: { name: "wt" },
      prompt: "reconcile",
      summary: {
        committed: "present",
        uncommitted: "none",
        removed: false,
        cleanup: "not_needed",
        conflictFiles: []
      }
    });

    expect(spawnAgent).toHaveBeenCalledWith("codex", {
      cwd: "/repo",
      prompt: "reconcile",
      worktree: false
    });
  });
});

describe("runWithOptionalWorktree", () => {
  it("runs directly when worktree mode is disabled", async () => {
    const run = vi.fn().mockResolvedValue("direct");

    const result = await runWithOptionalWorktree({
      cwd: "/repo",
      selectedAgent: "codex",
      worktree: false,
      run
    });

    expect(result.value).toBe("direct");
    expect(result.worktree).toBeUndefined();
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceCwd: "/repo",
        worktreeCwd: "/repo"
      })
    );
  });
});

function spawnResult(overrides: Partial<SpawnResult> = {}): SpawnResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    ...overrides
  };
}

function createFailureDeps(options: {
  worktreeHead: string;
  worktreeStatus: string;
  worktreeList: string;
}) {
  return {
    fs: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      rename: vi.fn(),
      unlink: vi.fn(),
      lstat: vi.fn().mockRejectedValue(new Error("missing"))
    },
    exec: vi.fn(async (command: string) => {
      if (command === "git rev-parse HEAD") {
        return { stdout: `${options.worktreeHead}\n`, stderr: "" };
      }
      if (command === "git status --porcelain=v1 -z") {
        return { stdout: options.worktreeStatus, stderr: "" };
      }
      if (command === "git worktree list --porcelain") {
        return { stdout: options.worktreeList, stderr: "" };
      }
      return { stdout: "", stderr: "" };
    })
  };
}
