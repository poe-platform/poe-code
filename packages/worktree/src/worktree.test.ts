import { describe, it, expect, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { parse } from "yaml";
import type { WorktreeFileSystem, ExecFn, Worktree, WorktreeRegistry } from "./types.js";
import { createWorktree } from "./create.js";
import { listWorktrees } from "./list.js";
import {
  readRegistry,
  writeRegistry,
  addWorktreeEntry,
  removeWorktreeEntry,
  updateWorktreeStatus
} from "./registry.js";
import { removeWorktree } from "./remove.js";

const REGISTRY = "/repo/.poe-code/worktrees.yaml";
const WORKTREE_DIR = "/repo/.poe-code/worktrees";

function createMemFs(files: Record<string, string> = {}): WorktreeFileSystem {
  const vol = Volume.fromJSON(files, "/");
  return createFsFromVolume(vol).promises as unknown as WorktreeFileSystem;
}

function createMockExec(): ExecFn {
  return vi.fn<ExecFn>().mockResolvedValue({ stdout: "", stderr: "" });
}

function makeEntry(overrides: Partial<Worktree> = {}): Worktree {
  return {
    name: "test-worktree",
    path: "/repo/.poe-code/worktrees/test-worktree",
    branch: "poe-code/test-worktree",
    baseBranch: "main",
    createdAt: "2026-01-01T00:00:00.000Z",
    source: "build",
    agent: "codex",
    status: "active",
    ...overrides
  };
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

describe("readRegistry", () => {
  it("returns empty registry when file does not exist", async () => {
    const fs = createMemFs();
    const registry = await readRegistry(REGISTRY, fs);
    expect(registry).toEqual({ worktrees: [] });
  });

  it("parses existing registry YAML", async () => {
    const fs = createMemFs({
      [REGISTRY]:
        "worktrees:\n  - name: foo\n    path: /repo/.poe-code/worktrees/foo\n    branch: poe-code/foo\n    baseBranch: main\n    createdAt: '2026-01-01T00:00:00.000Z'\n    source: test\n    agent: codex\n    status: active\n"
    });
    const registry = await readRegistry(REGISTRY, fs);
    expect(registry.worktrees).toHaveLength(1);
    expect(registry.worktrees[0]!.name).toBe("foo");
  });

  it("returns empty registry for invalid YAML content", async () => {
    const fs = createMemFs({
      [REGISTRY]: "not-worktrees: true\n"
    });
    const registry = await readRegistry(REGISTRY, fs);
    expect(registry).toEqual({ worktrees: [] });
  });
});

describe("writeRegistry", () => {
  it("creates directory and writes YAML", async () => {
    const fs = createMemFs();
    const registry: WorktreeRegistry = {
      worktrees: [makeEntry()]
    };
    await writeRegistry(REGISTRY, registry, fs);
    const content = await fs.readFile(REGISTRY, "utf8");
    const parsed = parse(content) as WorktreeRegistry;
    expect(parsed.worktrees).toHaveLength(1);
    expect(parsed.worktrees[0]!.name).toBe("test-worktree");
  });
});

describe("addWorktreeEntry", () => {
  it("adds entry to empty registry", async () => {
    const fs = createMemFs();
    await addWorktreeEntry(REGISTRY, makeEntry(), fs);
    const registry = await readRegistry(REGISTRY, fs);
    expect(registry.worktrees).toHaveLength(1);
  });

  it("appends entry to existing registry", async () => {
    const fs = createMemFs();
    await addWorktreeEntry(REGISTRY, makeEntry({ name: "first" }), fs);
    await addWorktreeEntry(REGISTRY, makeEntry({ name: "second" }), fs);
    const registry = await readRegistry(REGISTRY, fs);
    expect(registry.worktrees).toHaveLength(2);
    expect(registry.worktrees.map((w) => w.name)).toEqual(["first", "second"]);
  });
});

describe("removeWorktreeEntry", () => {
  it("removes entry by name", async () => {
    const fs = createMemFs();
    await addWorktreeEntry(REGISTRY, makeEntry({ name: "keep" }), fs);
    await addWorktreeEntry(REGISTRY, makeEntry({ name: "remove" }), fs);
    await removeWorktreeEntry(REGISTRY, "remove", fs);
    const registry = await readRegistry(REGISTRY, fs);
    expect(registry.worktrees).toHaveLength(1);
    expect(registry.worktrees[0]!.name).toBe("keep");
  });
});

describe("updateWorktreeStatus", () => {
  it("updates status of existing entry", async () => {
    const fs = createMemFs();
    await addWorktreeEntry(REGISTRY, makeEntry({ name: "wt", status: "active" }), fs);
    await updateWorktreeStatus(REGISTRY, "wt", "done", { fs });
    const registry = await readRegistry(REGISTRY, fs);
    expect(registry.worktrees[0]!.status).toBe("done");
  });

  it("throws when entry not found", async () => {
    const fs = createMemFs();
    await expect(
      updateWorktreeStatus(REGISTRY, "missing", "done", { fs })
    ).rejects.toThrow('Worktree "missing" not found in registry');
  });
});

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
