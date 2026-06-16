import { describe, it, expect, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { parse, stringify } from "yaml";
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

type ExtendedWorktreeFileSystem = WorktreeFileSystem & {
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
  symlink(target: string, path: string): Promise<void>;
};

function createMockExec(): ExecFn {
  return vi.fn<ExecFn>().mockResolvedValue({ stdout: "", stderr: "" });
}

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
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
      `git worktree add -b 'poe-code/my-feature' '${WORKTREE_DIR}/my-feature' 'main'`,
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
      `git worktree remove '${WORKTREE_DIR}/my-feature' --force`
    );
    expect(commands).toContain("git branch -D 'poe-code/my-feature'");

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

  it("rejects unsafe worktree names before running git commands", async () => {
    const invalidNames = ["", ".", "..", "../escape", "nested/name", "/absolute"];

    for (const name of invalidNames) {
      const fs = createMemFs();
      const exec = createMockExec();

      await expect(createWorktree({
        cwd: "/repo",
        name,
        baseBranch: "main",
        source: "test",
        agent: "codex",
        registryFile: REGISTRY,
        worktreeDir: WORKTREE_DIR,
        deps: { fs, exec }
      })).rejects.toThrow("Worktree name must be a safe single path segment.");

      expect(exec).not.toHaveBeenCalled();
      await expect(readRegistry(REGISTRY, fs)).resolves.toEqual({ worktrees: [] });
    }
  });

  it("quotes untrusted worktree operands in git commands", async () => {
    const fs = createMemFs();
    const exec = createMockExec();

    await createWorktree({
      cwd: "/repo",
      name: "safe-name",
      baseBranch: "main; false",
      source: "test",
      agent: "codex",
      registryFile: REGISTRY,
      worktreeDir: WORKTREE_DIR,
      deps: { fs, exec }
    });

    expect(exec.mock.calls.map(([command]) => command)).toContain(
      "git branch -D 'poe-code/safe-name'"
    );
    expect(exec.mock.calls.map(([command]) => command)).toContain(
      `git worktree add -b 'poe-code/safe-name' '${WORKTREE_DIR}/safe-name' 'main; false'`
    );
  });

  it("retains a failed registry tombstone when replacement checkout creation fails", async () => {
    const oldEntry = makeEntry({ name: "feature" });
    const fs = createMemFs({ [REGISTRY]: stringify({ worktrees: [oldEntry] }, { lineWidth: 0 }) });
    const exec = vi.fn<ExecFn>().mockImplementation(async (command) => {
      if (command.startsWith("git worktree add")) {
        throw new Error("replacement failed");
      }
      return { stdout: "", stderr: "" };
    });

    await expect(createWorktree({
      cwd: "/repo", name: "feature", baseBranch: "main", source: "new", agent: "codex",
      registryFile: REGISTRY, worktreeDir: WORKTREE_DIR, deps: { fs, exec }
    })).rejects.toThrow("replacement failed");

    await expect(readRegistry(REGISTRY, fs)).resolves.toEqual({
      worktrees: [{ ...oldEntry, status: "failed" }]
    });
  });

  it("rolls back a created checkout when registry persistence fails", async () => {
    const base = createMemFs() as ExtendedWorktreeFileSystem;
    const fs = {
      ...base,
      rename: async (oldPath: string, newPath: string) => {
        if (newPath === REGISTRY) {
          throw new Error("disk full");
        }
        await base.rename(oldPath, newPath);
      }
    } as ExtendedWorktreeFileSystem;
    const exec = createMockExec();

    await expect(createWorktree({
      cwd: "/repo", name: "feature", baseBranch: "main", source: "test", agent: "codex",
      registryFile: REGISTRY, worktreeDir: WORKTREE_DIR, deps: { fs, exec }
    })).rejects.toThrow("disk full");

    const commands = exec.mock.calls.map(([command]) => command);
    expect(commands.filter((command) => command === `git worktree remove '${WORKTREE_DIR}/feature' --force`)).toHaveLength(2);
    expect(commands.filter((command) => command === "git branch -D 'poe-code/feature'")).toHaveLength(2);
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

  it("does not treat inherited lstat error codes as missing registries", async () => {
    const baseFs = createMemFs({ [REGISTRY]: "worktrees: []\n" });
    const fs = {
      ...baseFs,
      lstat: vi.fn(async () => {
        throw new Error("registry lstat denied");
      })
    } as WorktreeFileSystem;

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(readRegistry(REGISTRY, fs)).rejects.toThrow("registry lstat denied");
    });
  });

  it("rejects inherited top-level registry fields", async () => {
    const fs = createMemFs({ [REGISTRY]: "{}\n" });

    await withObjectPrototypeProperties({ worktrees: [makeEntry()] }, async () => {
      await expect(readRegistry(REGISTRY, fs)).rejects.toThrow(/Invalid worktree registry/);
    });
  });

  it("rejects inherited worktree entry fields", async () => {
    const fs = createMemFs({ [REGISTRY]: "worktrees:\n  - {}\n" });

    await withObjectPrototypeProperties(makeEntry() as unknown as Record<string, unknown>, async () => {
      await expect(readRegistry(REGISTRY, fs)).rejects.toThrow(/Invalid worktree registry/);
    });
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
    await expect(readRegistry(REGISTRY, fs)).rejects.toThrow(/Invalid worktree registry/);
  });

  it("rejects valid YAML registries containing invalid worktree entries", async () => {
    const fs = createMemFs({ [REGISTRY]: "worktrees:\n  - null\n" });

    await expect(readRegistry(REGISTRY, fs)).rejects.toThrow(/Invalid worktree registry/);
    await expect(updateWorktreeStatus(REGISTRY, "missing", "done", { fs })).rejects.toThrow(/Invalid worktree registry/);
  });

  it("surfaces transient read failures rather than treating them as empty state", async () => {
    const base = createMemFs({ [REGISTRY]: "worktrees: []\n" });
    const fs = {
      ...base,
      readFile: async () => {
        throw new Error("disk unavailable");
      }
    } as WorktreeFileSystem;

    await expect(readRegistry(REGISTRY, fs)).rejects.toThrow("disk unavailable");
  });

  it("rejects reads through a symlinked registry file", async () => {
    const fs = createMemFs() as ExtendedWorktreeFileSystem;
    await fs.mkdir("/repo/.poe-code", { recursive: true });
    await fs.writeFile("/outside.yaml", "worktrees: []\n", { encoding: "utf8" });
    await fs.symlink("/outside.yaml", REGISTRY);

    await expect(readRegistry(REGISTRY, fs)).rejects.toThrow(/symbolic link/);
  });

  it("allows registry files below the macOS /var system alias", async () => {
    const base = createMemFs() as ExtendedWorktreeFileSystem;
    const registryFile = "/var/folders/app/.poe-code/worktrees.yaml";
    const fs = {
      ...base,
      lstat: async (filePath: string) => {
        if (filePath === "/var") {
          return { isSymbolicLink: () => true };
        }
        return base.lstat(filePath);
      }
    } as ExtendedWorktreeFileSystem;

    await writeRegistry(registryFile, { worktrees: [makeEntry()] }, fs);

    await expect(readRegistry(registryFile, fs)).resolves.toEqual({
      worktrees: [makeEntry()]
    });
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

  it("preserves the live registry when a staged write fails", async () => {
    const initial = { worktrees: [makeEntry({ name: "existing" })] };
    const base = createMemFs({ [REGISTRY]: stringify(initial, { lineWidth: 0 }) }) as ExtendedWorktreeFileSystem;
    let temporaryPath: string | undefined;
    const fs = {
      ...base,
      writeFile: async (
        filePath: string,
        data: string,
        options?: { encoding?: BufferEncoding; flag?: string }
      ) => {
        if (filePath !== REGISTRY) {
          temporaryPath = filePath;
          await base.writeFile(filePath, "partial", options);
          throw new Error("disk full");
        }
        await base.writeFile(filePath, data, options);
      }
    } as ExtendedWorktreeFileSystem;

    await expect(writeRegistry(REGISTRY, { worktrees: [makeEntry({ name: "new" })] }, fs)).rejects.toThrow("disk full");
    await expect(readRegistry(REGISTRY, base)).resolves.toEqual(initial);
    expect(temporaryPath?.startsWith(`${REGISTRY}.tmp-`)).toBe(true);
    await expect(base.readFile(temporaryPath ?? "", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("does not follow or remove a colliding temporary registry symlink", async () => {
    const base = createMemFs({ "/outside/worktrees.tmp": "outside-state\n" }) as ExtendedWorktreeFileSystem;
    await base.mkdir("/repo/.poe-code", { recursive: true });
    let temporaryPath: string | undefined;
    const fs = {
      ...base,
      writeFile: async (
        filePath: string,
        data: string,
        options?: { encoding?: BufferEncoding; flag?: string }
      ) => {
        if (filePath.startsWith(`${REGISTRY}.tmp-`)) {
          temporaryPath = filePath;
          await base.symlink("/outside/worktrees.tmp", filePath);
        }

        await base.writeFile(filePath, data, options);
      }
    } as ExtendedWorktreeFileSystem;

    await expect(writeRegistry(REGISTRY, { worktrees: [makeEntry()] }, fs)).rejects.toThrow();

    expect(temporaryPath).toBeDefined();
    await expect(base.readFile("/outside/worktrees.tmp", "utf8")).resolves.toBe("outside-state\n");
    expect((await base.lstat(temporaryPath as string)).isSymbolicLink()).toBe(true);
    await expect(base.readFile(REGISTRY, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects writes through a symlinked registry file", async () => {
    const fs = createMemFs() as ExtendedWorktreeFileSystem;
    await fs.mkdir("/repo/.poe-code", { recursive: true });
    await fs.writeFile("/outside.yaml", "worktrees: []\n", { encoding: "utf8" });
    await fs.symlink("/outside.yaml", REGISTRY);

    await expect(writeRegistry(REGISTRY, { worktrees: [makeEntry()] }, fs)).rejects.toThrow(/symbolic link/);
    await expect(fs.readFile("/outside.yaml", "utf8")).resolves.toBe("worktrees: []\n");
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
      "git worktree remove '/repo/.poe-code/worktrees/wt'",
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
      "git branch -D 'poe-code/wt'",
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

  it("restores registry status when git worktree removal fails", async () => {
    const fs = createMemFs();
    const entry = makeEntry({ name: "wt", status: "active" });
    await addWorktreeEntry(REGISTRY, entry, fs);
    const exec = vi.fn<ExecFn>().mockRejectedValue(new Error("git refused to remove worktree"));

    await expect(removeWorktree({
      cwd: "/repo",
      name: "wt",
      registryFile: REGISTRY,
      deps: { fs, exec }
    })).rejects.toThrow("git refused to remove worktree");

    await expect(readRegistry(REGISTRY, fs)).resolves.toEqual({
      worktrees: [entry]
    });
  });

  it("removes registry state even when optional branch deletion fails", async () => {
    const fs = createMemFs();
    await addWorktreeEntry(REGISTRY, makeEntry({ name: "wt", branch: "poe-code/wt" }), fs);
    const exec = vi.fn<ExecFn>().mockImplementation(async (command) => {
      if (command === "git branch -D 'poe-code/wt'") {
        throw new Error("branch protected");
      }
      return { stdout: "", stderr: "" };
    });

    await expect(removeWorktree({ cwd: "/repo", name: "wt", registryFile: REGISTRY, deleteBranch: true, deps: { fs, exec } })).rejects.toThrow("branch protected");
    await expect(readRegistry(REGISTRY, fs)).resolves.toEqual({ worktrees: [] });
  });
});
