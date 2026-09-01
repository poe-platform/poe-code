import { describe, it, expect, vi, beforeEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { CreateWorktreeOptions } from "@poe-code/worktree";
import type { SpawnResult } from "./types.js";

const worktreeMocks = vi.hoisted(() => ({
  createWorktree: vi.fn(),
  reconcileWorktree: vi.fn(),
  listWorktrees: vi.fn(),
  removeWorktree: vi.fn(),
  updateWorktreeEntry: vi.fn()
}));
const rmdirMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/worktree", () => worktreeMocks);
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rmdir: rmdirMock };
});

const { reconcileManagedWorktree, runInWorktree, runWithOptionalWorktree } = await import(
  "./worktree.js"
);

describe("runInWorktree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rmdirMock.mockReset();
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

  it("supports registry lock cleanup through the default Node worktree adapter", async () => {
    const lockFs = createFsFromVolume(new Volume()).promises;
    const lockPath = "/registry.yaml.lock";
    const ownerPath = `${lockPath}/owner`;
    await lockFs.mkdir(ownerPath, { recursive: true });
    rmdirMock.mockImplementation(async (targetPath: string) => {
      await lockFs.rmdir(targetPath);
    });

    await runInWorktree({
      cwd: "/repo",
      selectedAgent: "codex",
      worktree: true,
      spawnAgent: async () => spawnResult(),
      run: async () => "done"
    });

    const { deps } = worktreeMocks.createWorktree.mock.calls[0]![0] as CreateWorktreeOptions;
    await expect(deps.fs.rmdir(lockPath)).rejects.toMatchObject({ code: "ENOTEMPTY" });
    await deps.fs.rmdir(ownerPath);
    await deps.fs.rmdir(lockPath);
    expect(rmdirMock.mock.calls).toEqual([[lockPath], [ownerPath], [lockPath]]);
    await expect(lockFs.lstat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
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

  it.each([
    { worktreeHead: "abc123", worktreeStatus: "", committed: "none", uncommitted: "none" },
    { worktreeHead: "def456", worktreeStatus: "", committed: "present", uncommitted: "none" },
    { worktreeHead: "abc123", worktreeStatus: " M src/file.ts\0", committed: "none", uncommitted: "present" }
  ])("preserves a rejected resolved outcome with $committed commits and $uncommitted edits", async (changes) => {
    const value = { stopReason: "failed" };
    const spawnAgent = vi.fn().mockResolvedValue(spawnResult());
    const isSuccessful = vi.fn(() => false);
    const result = await runInWorktree({
      cwd: "/repo",
      selectedAgent: "codex",
      worktree: true,
      spawnAgent,
      deps: createFailureDeps({ ...changes, worktreeList: "worktree /repo/.poe-code/worktrees/wt\n" }),
      run: async () => value,
      isSuccessful
    });

    expect(result.value).toBe(value);
    expect(result.worktree.worktree.path).toBe("/repo/.poe-code/worktrees/wt");
    expect(result.worktree.worktree.status).toBe("failed");
    expect(result.worktree.reconciliation).toBeUndefined();
    expect(isSuccessful).toHaveBeenCalledExactlyOnceWith(value);
    expect(worktreeMocks.reconcileWorktree).not.toHaveBeenCalled();
    expect(spawnAgent).not.toHaveBeenCalled();
    expect(await worktreeMocks.updateWorktreeEntry.mock.results[0]!.value).toMatchObject({
      status: "failed",
      reconciliation: {
        committed: changes.committed,
        uncommitted: changes.uncommitted,
        removed: false,
        cleanup: "not_needed"
      }
    });
  });

  it.each([false, 0, "", null, undefined])("uses the explicit success classifier for %j", async (value) => {
    const isSuccessful = vi.fn(() => true);
    const result = await runInWorktree({
      cwd: "/repo",
      selectedAgent: "codex",
      worktree: true,
      run: async () => value,
      isSuccessful
    });

    expect(result.value).toBe(value);
    expect(isSuccessful).toHaveBeenCalledExactlyOnceWith(value);
    expect(worktreeMocks.reconcileWorktree).toHaveBeenCalledTimes(1);
  });

  it("does not reconcile a resolved callback after cancellation", async () => {
    const controller = new AbortController();
    const spawnAgent = vi.fn().mockResolvedValue(spawnResult());
    const value = { stopReason: "completed" };
    const result = await runInWorktree({
      cwd: "/repo",
      selectedAgent: "codex",
      worktree: true,
      signal: controller.signal,
      spawnAgent,
      deps: createFailureDeps({ worktreeHead: "abc123", worktreeStatus: "", worktreeList: "" }),
      run: async () => {
        controller.abort();
        return value;
      },
      isSuccessful: () => true
    });

    expect(result.value).toBe(value);
    expect(worktreeMocks.reconcileWorktree).not.toHaveBeenCalled();
    expect(spawnAgent).not.toHaveBeenCalled();
    expect(await worktreeMocks.updateWorktreeEntry.mock.results[0]!.value).toMatchObject({ status: "failed" });
  });

  it("does not infer a generic callback outcome from its object shape", async () => {
    const value = { stopReason: "failed" };
    const result = await runInWorktree({
      cwd: "/repo",
      selectedAgent: "codex",
      worktree: true,
      run: async () => value
    });

    expect(result.value).toBe(value);
    expect(worktreeMocks.reconcileWorktree).toHaveBeenCalledTimes(1);
  });

  it("preserves an empty worktree and the original thrown cancellation", async () => {
    const controller = new AbortController();
    const failure = Object.assign(new Error("Fixture cancellation"), { name: "AbortError" });
    const spawnAgent = vi.fn().mockResolvedValue(spawnResult());
    await expect(runInWorktree({
      cwd: "/repo",
      selectedAgent: "codex",
      worktree: true,
      signal: controller.signal,
      spawnAgent,
      deps: createFailureDeps({ worktreeHead: "abc123", worktreeStatus: "", worktreeList: "" }),
      run: async () => {
        controller.abort();
        throw failure;
      }
    })).rejects.toBe(failure);

    expect(worktreeMocks.reconcileWorktree).not.toHaveBeenCalled();
    expect(spawnAgent).not.toHaveBeenCalled();
    expect(await worktreeMocks.updateWorktreeEntry.mock.results[0]!.value).toMatchObject({ status: "failed" });
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
  it("does not classify or mutate a direct execution", async () => {
    vi.clearAllMocks();
    const value = { stopReason: "failed" };
    const isSuccessful = vi.fn(() => false);
    const result = await runWithOptionalWorktree({
      cwd: "/repo",
      selectedAgent: "codex",
      worktree: false,
      run: async () => value,
      isSuccessful
    });

    expect(result).toEqual({ value });
    expect(result.value).toBe(value);
    expect(isSuccessful).not.toHaveBeenCalled();
    expect(worktreeMocks.createWorktree).not.toHaveBeenCalled();
    expect(worktreeMocks.updateWorktreeEntry).not.toHaveBeenCalled();
  });

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
      rmdir: vi.fn(),
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
