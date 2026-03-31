import { describe, it, expect, vi } from "bun:test";
import { Volume, createFsFromVolume } from "memfs";
import type { WorktreeFileSystem, ExecFn } from "./types.js";
import { createWorktree } from "./create.js";
import { readRegistry } from "./registry.js";

const REGISTRY = "/repo/.poe-code/worktrees.yaml";
const WORKTREE_DIR = "/repo/.poe-code/worktrees";

function createMemFs(
  files: Record<string, string> = {}
): WorktreeFileSystem {
  const vol = Volume.fromJSON(files, "/");
  return createFsFromVolume(vol).promises as unknown as WorktreeFileSystem;
}

function createMockExec(): ExecFn {
  return vi.fn<ExecFn>().mockResolvedValue({ stdout: "", stderr: "" });
}

describe("createWorktree", () => {
  it("runs git worktree add with correct arguments", async () => {
    const fs = createMemFs();
    const exec = createMockExec();

    await createWorktree({
      cwd: "/repo",
      name: "my-feature",
      baseBranch: "main",
      source: "build",
      agent: "codex",
      registryFile: REGISTRY,
      worktreeDir: WORKTREE_DIR,
      deps: { fs, exec }
    });

    expect(exec).toHaveBeenCalledWith(
      `git worktree add -b poe-code/my-feature ${WORKTREE_DIR}/my-feature main`,
      { cwd: "/repo" }
    );
  });

  it("writes entry to registry", async () => {
    const fs = createMemFs();
    const exec = createMockExec();

    const result = await createWorktree({
      cwd: "/repo",
      name: "my-feature",
      baseBranch: "main",
      source: "build",
      agent: "codex",
      registryFile: REGISTRY,
      worktreeDir: WORKTREE_DIR,
      deps: { fs, exec }
    });

    const registry = await readRegistry(REGISTRY, fs);
    expect(registry.worktrees).toHaveLength(1);
    expect(registry.worktrees[0]!.name).toBe("my-feature");
    expect(registry.worktrees[0]!.branch).toBe("poe-code/my-feature");
    expect(registry.worktrees[0]!.status).toBe("active");
    expect(result.name).toBe("my-feature");
  });

  it("returns worktree entry with correct fields", async () => {
    const fs = createMemFs();
    const exec = createMockExec();

    const result = await createWorktree({
      cwd: "/repo",
      name: "test",
      baseBranch: "develop",
      source: "cli",
      agent: "claude",
      storyId: "US-001",
      planPath: "/plans/plan.yaml",
      prompt: "Do the thing",
      registryFile: REGISTRY,
      worktreeDir: WORKTREE_DIR,
      deps: { fs, exec }
    });

    expect(result).toMatchObject({
      name: "test",
      path: `${WORKTREE_DIR}/test`,
      branch: "poe-code/test",
      baseBranch: "develop",
      source: "cli",
      agent: "claude",
      status: "active",
      storyId: "US-001",
      planPath: "/plans/plan.yaml",
      prompt: "Do the thing"
    });
    expect(result.createdAt).toBeDefined();
  });

  it("cleans up existing worktree and branch before creating", async () => {
    const fs = createMemFs();
    const exec = vi.fn<ExecFn>().mockResolvedValue({ stdout: "", stderr: "" });

    // First call: create the worktree
    await createWorktree({
      cwd: "/repo",
      name: "my-feature",
      baseBranch: "main",
      source: "build",
      agent: "codex",
      registryFile: REGISTRY,
      worktreeDir: WORKTREE_DIR,
      deps: { fs, exec }
    });

    const registryBefore = await readRegistry(REGISTRY, fs);
    expect(registryBefore.worktrees).toHaveLength(1);

    // Second call: re-create with same name — should clean up first
    await createWorktree({
      cwd: "/repo",
      name: "my-feature",
      baseBranch: "main",
      source: "build",
      agent: "codex",
      registryFile: REGISTRY,
      worktreeDir: WORKTREE_DIR,
      deps: { fs, exec }
    });

    // Should have called worktree remove + branch delete before the second add
    const commands = exec.mock.calls.map((c) => c[0]);
    expect(commands).toContain(
      `git worktree remove ${WORKTREE_DIR}/my-feature --force`
    );
    expect(commands).toContain("git branch -D poe-code/my-feature");

    // Registry should have exactly one entry (old replaced)
    const registryAfter = await readRegistry(REGISTRY, fs);
    expect(registryAfter.worktrees).toHaveLength(1);
    expect(registryAfter.worktrees[0]!.status).toBe("active");
  });

  it("ignores cleanup errors when no previous worktree exists", async () => {
    const fs = createMemFs();
    const exec = vi.fn<ExecFn>().mockImplementation(async (command: string) => {
      if (command.includes("worktree remove") || command.includes("branch -D")) {
        throw new Error("not found");
      }
      return { stdout: "", stderr: "" };
    });

    const result = await createWorktree({
      cwd: "/repo",
      name: "fresh-feature",
      baseBranch: "main",
      source: "build",
      agent: "codex",
      registryFile: REGISTRY,
      worktreeDir: WORKTREE_DIR,
      deps: { fs, exec }
    });

    expect(result.name).toBe("fresh-feature");
    expect(result.status).toBe("active");
  });

  it("does not include optional fields when not provided", async () => {
    const fs = createMemFs();
    const exec = createMockExec();

    const result = await createWorktree({
      cwd: "/repo",
      name: "minimal",
      baseBranch: "main",
      source: "test",
      agent: "codex",
      registryFile: REGISTRY,
      worktreeDir: WORKTREE_DIR,
      deps: { fs, exec }
    });

    expect(result).not.toHaveProperty("storyId");
    expect(result).not.toHaveProperty("planPath");
    expect(result).not.toHaveProperty("prompt");
  });
});
