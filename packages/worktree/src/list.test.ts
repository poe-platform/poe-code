import { describe, it, expect, vi } from "bun:test";
import { Volume, createFsFromVolume } from "memfs";
import type { WorktreeFileSystem, ExecFn } from "./types.js";
import { listWorktrees } from "./list.js";
import { addWorktreeEntry } from "./registry.js";

const REGISTRY = "/repo/.poe-code/worktrees.yaml";

function createMemFs(
  files: Record<string, string> = {}
): WorktreeFileSystem {
  const vol = Volume.fromJSON(files, "/");
  return createFsFromVolume(vol).promises as unknown as WorktreeFileSystem;
}

describe("listWorktrees", () => {
  it("returns empty list when registry is empty", async () => {
    const fs = createMemFs();
    const exec = vi.fn<ExecFn>().mockResolvedValue({
      stdout: "worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\n",
      stderr: ""
    });

    const result = await listWorktrees("/repo", REGISTRY, { fs, exec });
    expect(result).toEqual([]);
  });

  it("reconciles registry entries with git worktree list", async () => {
    const fs = createMemFs();
    await addWorktreeEntry(REGISTRY, {
      name: "exists",
      path: "/repo/.poe-code/worktrees/exists",
      branch: "poe-code/exists",
      baseBranch: "main",
      createdAt: "2026-01-01T00:00:00.000Z",
      source: "test",
      agent: "codex",
      status: "active"
    }, fs);
    await addWorktreeEntry(REGISTRY, {
      name: "gone",
      path: "/repo/.poe-code/worktrees/gone",
      branch: "poe-code/gone",
      baseBranch: "main",
      createdAt: "2026-01-01T00:00:00.000Z",
      source: "test",
      agent: "codex",
      status: "active"
    }, fs);

    const exec = vi.fn<ExecFn>().mockResolvedValue({
      stdout: [
        "worktree /repo",
        "HEAD abc123",
        "branch refs/heads/main",
        "",
        "worktree /repo/.poe-code/worktrees/exists",
        "HEAD def456",
        "branch refs/heads/poe-code/exists",
        ""
      ].join("\n"),
      stderr: ""
    });

    const result = await listWorktrees("/repo", REGISTRY, { fs, exec });
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("exists");
    expect(result[0]!.gitExists).toBe(true);
    expect(result[1]!.name).toBe("gone");
    expect(result[1]!.gitExists).toBe(false);
  });

  it("calls git worktree list --porcelain", async () => {
    const fs = createMemFs();
    const exec = vi.fn<ExecFn>().mockResolvedValue({ stdout: "", stderr: "" });

    await listWorktrees("/repo", REGISTRY, { fs, exec });
    expect(exec).toHaveBeenCalledWith("git worktree list --porcelain", {
      cwd: "/repo"
    });
  });
});
