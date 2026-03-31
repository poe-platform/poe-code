import { describe, it, expect, vi } from "bun:test";
import { Volume, createFsFromVolume } from "memfs";
import type { WorktreeFileSystem, ExecFn } from "./types.js";
import { removeWorktree } from "./remove.js";
import { addWorktreeEntry, readRegistry } from "./registry.js";

const REGISTRY = "/repo/.poe-code/worktrees.yaml";

function createMemFs(
  files: Record<string, string> = {}
): WorktreeFileSystem {
  const vol = Volume.fromJSON(files, "/");
  return createFsFromVolume(vol).promises as unknown as WorktreeFileSystem;
}

function createMockExec(): ExecFn {
  return vi.fn<ExecFn>().mockResolvedValue({ stdout: "", stderr: "" });
}

describe("removeWorktree", () => {
  it("runs git worktree remove", async () => {
    const fs = createMemFs();
    const exec = createMockExec();
    await addWorktreeEntry(REGISTRY, {
      name: "wt",
      path: "/repo/.poe-code/worktrees/wt",
      branch: "poe-code/wt",
      baseBranch: "main",
      createdAt: "2026-01-01T00:00:00.000Z",
      source: "test",
      agent: "codex",
      status: "active"
    }, fs);

    await removeWorktree({ cwd: "/repo", name: "wt", registryFile: REGISTRY, deps: { fs, exec } });

    expect(exec).toHaveBeenCalledWith(
      "git worktree remove /repo/.poe-code/worktrees/wt",
      { cwd: "/repo" }
    );
  });

  it("removes entry from registry", async () => {
    const fs = createMemFs();
    const exec = createMockExec();
    await addWorktreeEntry(REGISTRY, {
      name: "wt",
      path: "/repo/.poe-code/worktrees/wt",
      branch: "poe-code/wt",
      baseBranch: "main",
      createdAt: "2026-01-01T00:00:00.000Z",
      source: "test",
      agent: "codex",
      status: "active"
    }, fs);

    await removeWorktree({ cwd: "/repo", name: "wt", registryFile: REGISTRY, deps: { fs, exec } });

    const registry = await readRegistry(REGISTRY, fs);
    expect(registry.worktrees).toHaveLength(0);
  });

  it("deletes branch when deleteBranch is true", async () => {
    const fs = createMemFs();
    const exec = createMockExec();
    await addWorktreeEntry(REGISTRY, {
      name: "wt",
      path: "/repo/.poe-code/worktrees/wt",
      branch: "poe-code/wt",
      baseBranch: "main",
      createdAt: "2026-01-01T00:00:00.000Z",
      source: "test",
      agent: "codex",
      status: "active"
    }, fs);

    await removeWorktree({
      cwd: "/repo",
      name: "wt",
      registryFile: REGISTRY,
      deleteBranch: true,
      deps: { fs, exec }
    });

    expect(exec).toHaveBeenCalledWith(
      "git branch -D poe-code/wt",
      { cwd: "/repo" }
    );
  });

  it("does not delete branch when deleteBranch is false", async () => {
    const fs = createMemFs();
    const exec = createMockExec();
    await addWorktreeEntry(REGISTRY, {
      name: "wt",
      path: "/repo/.poe-code/worktrees/wt",
      branch: "poe-code/wt",
      baseBranch: "main",
      createdAt: "2026-01-01T00:00:00.000Z",
      source: "test",
      agent: "codex",
      status: "active"
    }, fs);

    await removeWorktree({ cwd: "/repo", name: "wt", registryFile: REGISTRY, deps: { fs, exec } });

    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("throws when worktree not found in registry", async () => {
    const fs = createMemFs();
    const exec = createMockExec();

    await expect(
      removeWorktree({ cwd: "/repo", name: "missing", registryFile: REGISTRY, deps: { fs, exec } })
    ).rejects.toThrow('Worktree "missing" not found in registry');
  });
});
