import { describe, it, expect } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { parse } from "yaml";
import type { WorktreeFileSystem, Worktree, WorktreeRegistry } from "./types.js";
import {
  readRegistry,
  writeRegistry,
  addWorktreeEntry,
  removeWorktreeEntry,
  updateWorktreeStatus
} from "./registry.js";

const REGISTRY = "/repo/.poe-code/worktrees.yaml";

function createMemFs(
  files: Record<string, string> = {}
): WorktreeFileSystem {
  const vol = Volume.fromJSON(files, "/");
  return createFsFromVolume(vol).promises as unknown as WorktreeFileSystem;
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
