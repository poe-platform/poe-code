import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { fs as memfs, vol } from "memfs";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";

const worktreeMocks = vi.hoisted(() => ({
  listManagedWorktrees: vi.fn(),
  reconcileManagedWorktree: vi.fn(),
  removeManagedWorktree: vi.fn()
}));

vi.mock("../../sdk/worktree.js", () => worktreeMocks);

const { registerWorktreeCommand } = await import("./worktree.js");

const cwd = "/repo";
const homeDir = "/home/test";

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
  return program;
}

function setStdinTTY(value: boolean): () => void {
  const original = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value });
  return () => {
    if (original === undefined) {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
      return;
    }
    Object.defineProperty(process.stdin, "isTTY", original);
  };
}

function createContainer(logs: string[] = []): ReturnType<typeof createCliContainer> {
  return createCliContainer({
    fs: memfs.promises as unknown as FileSystem,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    logger: (message) => logs.push(message),
    commandRunner: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" })
  });
}

async function runWorktreeCommand(args: string[], logs: string[] = []): Promise<void> {
  const program = createProgram();
  registerWorktreeCommand(program, createContainer(logs));
  await program.parseAsync(["node", "cli", ...args]);
}

describe("worktree command", () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(cwd, { recursive: true });
    vol.mkdirSync(homeDir, { recursive: true });
    vi.clearAllMocks();
    worktreeMocks.listManagedWorktrees.mockResolvedValue([]);
    worktreeMocks.reconcileManagedWorktree.mockResolvedValue({
      committed: "merged_by_agent",
      uncommitted: "applied_by_agent",
      removed: true,
      cleanup: "removed_by_agent",
      conflictFiles: []
    });
    worktreeMocks.removeManagedWorktree.mockResolvedValue(undefined);
  });

  it("lists managed worktrees", async () => {
    const logs: string[] = [];
    worktreeMocks.listManagedWorktrees.mockResolvedValue([
      {
        name: "wt",
        path: "/repo/.poe-code/worktrees/wt",
        branch: "poe-code/wt",
        baseBranch: "main",
        createdAt: "2026-01-01T00:00:00.000Z",
        source: "sdk",
        agent: "codex",
        status: "active",
        gitExists: true
      }
    ]);

    await runWorktreeCommand(["worktree", "list"], logs);

    expect(worktreeMocks.listManagedWorktrees).toHaveBeenCalledWith({ cwd });
    expect(logs.join("\n")).toContain("wt active present /repo/.poe-code/worktrees/wt");
  });

  it("reconciles a managed worktree through the requested agent", async () => {
    await runWorktreeCommand([
      "worktree",
      "reconcile",
      "wt",
      "--agent",
      "codex"
    ]);

    expect(worktreeMocks.reconcileManagedWorktree).toHaveBeenCalledWith({
      cwd,
      name: "wt",
      agent: "codex"
    });
  });

  it("removes a managed worktree and optionally deletes the branch", async () => {
    await runWorktreeCommand(["--yes", "worktree", "remove", "wt", "--delete-branch"]);

    expect(worktreeMocks.removeManagedWorktree).toHaveBeenCalledWith({
      cwd,
      name: "wt",
      deleteBranch: true
    });
  });

  it("refuses to remove a worktree without --yes in non-interactive mode", async () => {
    const logs: string[] = [];
    const restore = setStdinTTY(false);

    try {
      await expect(runWorktreeCommand(["worktree", "remove", "wt"], logs)).rejects.toThrow(
        "worktree remove wt requires --yes when running without an interactive TTY."
      );
    } finally {
      restore();
    }

    expect(worktreeMocks.removeManagedWorktree).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("uncommitted changes");
  });

  it("previews worktree removal without removing anything in dry-run mode", async () => {
    const logs: string[] = [];
    const restore = setStdinTTY(false);

    try {
      await runWorktreeCommand(["--dry-run", "worktree", "remove", "wt"], logs);
    } finally {
      restore();
    }

    expect(worktreeMocks.removeManagedWorktree).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("wt");
  });
});
