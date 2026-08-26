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

  it("lists managed worktrees when invoked bare, without printing help", async () => {
    const logs: string[] = [];
    worktreeMocks.listManagedWorktrees.mockResolvedValue([]);

    await runWorktreeCommand(["worktree"], logs);

    expect(worktreeMocks.listManagedWorktrees).toHaveBeenCalledWith({ cwd });
    expect(logs.join("\n")).not.toContain("Usage: poe-code worktree");
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
    const logs: string[] = [];
    await runWorktreeCommand([
      "worktree",
      "reconcile",
      "wt",
      "--agent",
      "codex"
    ], logs);

    expect(worktreeMocks.reconcileManagedWorktree).toHaveBeenCalledWith({
      cwd,
      name: "wt",
      agent: "codex"
    });
    expect(logs).toContain(
      "Reconciled wt: committed merged_by_agent, uncommitted applied_by_agent, cleanup removed_by_agent"
    );
    expect(logs.join("\n")).not.toContain("Dry run:");
  });

  it.each([true, false])("previews reconciliation without --yes or a TTY (leading dry-run: %s)", async (leading) => {
    vol.fromJSON({ "/repo/keep.txt": "unchanged" });
    const initialFiles = vol.toJSON();
    const logs: string[] = [];
    const container = createContainer(logs);
    vi.mocked(container.commandRunner).mockRejectedValue(new Error("Unexpected command execution"));
    vi.mocked(container.prompts).mockRejectedValue(new Error("Unexpected prompt"));
    const program = createProgram();
    registerWorktreeCommand(program, container);
    const restoreTTY = setStdinTTY(false);

    try {
      await program.parseAsync([
        "node", "cli", ...(leading ? ["--dry-run"] : []),
        "worktree", "reconcile", "example", "--agent", "codex",
        ...(leading ? [] : ["--dry-run"])
      ]);
    } finally {
      restoreTTY();
    }

    expect(worktreeMocks.reconcileManagedWorktree).not.toHaveBeenCalled();
    expect(worktreeMocks.listManagedWorktrees).not.toHaveBeenCalled();
    expect(worktreeMocks.removeManagedWorktree).not.toHaveBeenCalled();
    expect(container.commandRunner).not.toHaveBeenCalled();
    expect(container.prompts).not.toHaveBeenCalled();
    expect(vol.toJSON()).toEqual(initialFiles);
    expect(logs).toEqual([
      "worktree reconcile",
      "Dry run: would reconcile worktree example with agent codex."
    ]);
    expect(logs.join("\n")).not.toContain("Reconciled");
  });

  it.each([
    { args: ["--agent", "codex"], code: "commander.missingArgument" },
    { args: ["example"], code: "commander.missingMandatoryOptionValue" }
  ])("preserves required reconcile arguments in dry run ($code)", async ({ args, code }) => {
    const logs: string[] = [];
    const program = createProgram();
    program.configureOutput({ writeErr: vi.fn() });
    registerWorktreeCommand(program, createContainer(logs));

    await expect(program.parseAsync([
      "node", "cli", "--dry-run", "worktree", "reconcile", ...args
    ])).rejects.toMatchObject({ code });

    expect(worktreeMocks.reconcileManagedWorktree).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
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
