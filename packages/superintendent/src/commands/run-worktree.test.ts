import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { SuperintendentFileSystem } from "../runtime/loop.js";

const worktreeMocks = vi.hoisted(() => ({
  createWorktree: vi.fn(),
  reconcileWorktree: vi.fn(),
  updateWorktreeEntry: vi.fn()
}));
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/worktree", () => worktreeMocks);
vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  return { ...actual, spawn: spawnMock };
});

function createDoc(builderAgent: string): string {
  return [
    "---",
    "kind: superintendent",
    "version: 1",
    "builder:",
    `  agent: ${builderAgent}`,
    "  prompt: |",
    "    Build {{plan.path}}",
    "superintendent:",
    "  agent: claude-code",
    "  prompt: |",
    "    Review {{builder.summary}}",
    "owner:",
    "  agent: claude-code",
    "  prompt: |",
    "    Review {{superintendent.summary}}",
    "status:",
    "  state: in_progress",
    "  round: 0",
    "  review_turn: 0",
    "---",
    "# Plan",
    "",
    "## Task Board",
    "",
    "- [ ] Task",
    ""
  ].join("\n");
}

function createFs(files: Record<string, string>): SuperintendentFileSystem {
  const volume = Volume.fromJSON(files, "/");
  const rawFs = createFsFromVolume(volume).promises;
  return {
    readFile: (filePath: string, encoding: BufferEncoding) =>
      rawFs.readFile(filePath, encoding) as Promise<string>,
    writeFile: async (
      filePath: string,
      content: string,
      options?: { encoding?: BufferEncoding; flag?: string }
    ) => {
      await rawFs.mkdir(path.dirname(filePath), { recursive: true });
      await rawFs.writeFile(filePath, content, { encoding: "utf8", ...options });
    },
    readdir: (filePath: string) => rawFs.readdir(filePath) as Promise<string[]>,
    stat: async (filePath: string) => {
      const stat = await rawFs.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: Number(stat.mtimeMs)
      };
    },
    lstat: async (filePath: string) => {
      const stat = await rawFs.lstat(filePath);
      return { isSymbolicLink: () => stat.isSymbolicLink() };
    },
    mkdir: async (filePath: string, options?: { recursive?: boolean }) => {
      await rawFs.mkdir(filePath, options);
    },
    rmdir: async (filePath: string) => {
      await rawFs.rmdir(filePath);
    },
    rename: async (oldPath: string, newPath: string) => {
      await rawFs.mkdir(path.dirname(newPath), { recursive: true });
      await rawFs.rename(oldPath, newPath);
    },
    unlink: async (filePath: string) => {
      await rawFs.unlink(filePath);
    }
  } as SuperintendentFileSystem;
}

describe("superintendent run worktree mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnMock.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    worktreeMocks.createWorktree.mockResolvedValue({
      name: "sup-wt",
      path: "/repo/.poe-code/worktrees/sup-wt",
      branch: "poe-code/sup-wt",
      baseBranch: "HEAD",
      createdAt: "2026-06-24T00:00:00.000Z",
      source: "superintendent",
      agent: "codex",
      status: "active",
      sourceCwd: "/repo",
      baseHead: "base123"
    });
    worktreeMocks.reconcileWorktree.mockResolvedValue({
      committed: "none",
      uncommitted: "none",
      removed: true,
      cleanup: "removed_by_agent",
      conflictFiles: []
    });
  });

  it("wraps the whole superintendent loop in one managed worktree", async () => {
    const fs = createFs({
      "/repo/docs/plans/superintendent.md": createDoc("codex"),
      "/repo/.poe-code/worktrees/sup-wt/docs/plans/superintendent.md": createDoc("codex")
    });
    const runLoop = vi.fn(async () => ({
      state: "completed" as const,
      round: 1,
      reviewTurn: 0,
      maxRounds: 100,
      maxReviewTurns: 5,
      stopReason: "completed" as const
    }));

    const { runSuperintendentCommand } = await import("./run.js");
    const result = await runSuperintendentCommand({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "docs/plans/superintendent.md",
      assumeYes: true,
      interactive: false,
      useDashboard: false,
      fs,
      runLoop,
      env: {},
      worktree: true
    });

    expect(worktreeMocks.createWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo",
        name: expect.any(String),
        agent: "codex",
        planPath: "/repo/docs/plans/superintendent.md"
      })
    );
    expect(runLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo/.poe-code/worktrees/sup-wt",
        docPath: "/repo/.poe-code/worktrees/sup-wt/docs/plans/superintendent.md"
      })
    );
    expect(worktreeMocks.reconcileWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo",
        name: "sup-wt",
        reconciliationAgent: expect.any(Function)
      })
    );
    const reconciliationAgent =
      worktreeMocks.reconcileWorktree.mock.calls[0]![0].reconciliationAgent;
    await reconciliationAgent({
      phase: "reconcile",
      sourceCwd: "/repo",
      worktree: await worktreeMocks.createWorktree.mock.results[0]!.value,
      prompt: "reconcile",
      summary: {
        committed: "present",
        uncommitted: "none",
        removed: false,
        cleanup: "not_needed",
        conflictFiles: []
      }
    });
    expect(spawnMock).toHaveBeenCalledWith("codex", {
      cwd: "/repo",
      prompt: "reconcile",
      useStdin: true
    });
    expect(result).toMatchObject({
      docPath: "/repo/.poe-code/worktrees/sup-wt/docs/plans/superintendent.md",
      builderAgent: "codex",
      stopReason: "completed"
    });
  });

  it("lets the shared spawn boundary choose failed-run cleanup mode", async () => {
    const fs = createFs({
      "/repo/docs/plans/superintendent.md": createDoc("codex"),
      "/repo/.poe-code/worktrees/sup-wt/docs/plans/superintendent.md": createDoc("codex")
    });
    const worktreeDeps = {
      fs: {
        lstat: vi.fn().mockRejectedValue(new Error("missing"))
      },
      exec: vi.fn(async (command: string) => {
        if (command === "git rev-parse HEAD") {
          return { stdout: "base123\n", stderr: "" };
        }
        if (command === "git status --porcelain=v1 -z") {
          return { stdout: "", stderr: "" };
        }
        if (command === "git worktree list --porcelain") {
          return { stdout: "", stderr: "" };
        }
        throw new Error(`Unexpected command: ${command}`);
      })
    };
    const runLoop = vi.fn(async () => {
      throw new Error("loop failed");
    });

    const { runSuperintendentCommand } = await import("./run.js");
    await expect(
      runSuperintendentCommand({
        cwd: "/repo",
        homeDir: "/home/test",
        docPath: "docs/plans/superintendent.md",
        assumeYes: true,
        interactive: false,
        useDashboard: false,
        fs,
        runLoop,
        env: {},
        worktree: true,
        worktreeDeps: worktreeDeps as never,
        stderr: { write: vi.fn() } as unknown as NodeJS.WritableStream
      })
    ).rejects.toThrow("loop failed");

    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({
        cwd: "/repo",
        prompt: expect.stringContaining("produced no worktree changes"),
        useStdin: true
      })
    );
    expect(spawnMock.mock.calls[0]![1]).not.toHaveProperty("mode");
  });
});
