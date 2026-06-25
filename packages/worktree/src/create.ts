import { join } from "node:path";
import { readRegistry, writeRegistry } from "./registry.js";
import type { Worktree, WorktreeDeps } from "./types.js";

export type CreateWorktreeOptions = {
  cwd: string;
  name: string;
  baseBranch: string;
  source: string;
  agent: string;
  registryFile: string;
  worktreeDir: string;
  storyId?: string;
  planPath?: string;
  prompt?: string;
  sourceCwd?: string;
  deps: WorktreeDeps;
};

export async function createWorktree(
  opts: CreateWorktreeOptions
): Promise<Worktree> {
  assertSafeWorktreeName(opts.name);
  await assertInsideGitWorkTree(opts.cwd, opts.deps);
  const destinationStatus = await opts.deps.exec("git status --porcelain=v1 -z", {
    cwd: opts.cwd
  });
  if (destinationStatus.stdout.length > 0) {
    throw new Error(
      "Cannot run with --worktree because the destination checkout has uncommitted changes.\nCommit, stash, or discard those changes before starting a worktree run."
    );
  }
  const baseHead = (
    await opts.deps.exec(`git rev-parse ${shellQuote(opts.baseBranch)}`, { cwd: opts.cwd })
  ).stdout.trim();
  const branch = `poe-code/${opts.name}`;
  const worktreePath = join(opts.worktreeDir, opts.name);
  const registry = await readRegistry(opts.registryFile, opts.deps.fs);
  const existing = registry.worktrees.find((worktree) => worktree.name === opts.name);

  if (existing !== undefined) {
    await writeRegistry(opts.registryFile, {
      worktrees: registry.worktrees.map((worktree) =>
        worktree.name === opts.name ? { ...worktree, status: "removing" } : worktree
      )
    }, opts.deps.fs);
  }

  // Clean up any existing worktree/branch from a previous run
  try {
    await opts.deps.exec(`git worktree remove ${shellQuote(worktreePath)} --force`, { cwd: opts.cwd });
  } catch { /* worktree may not exist */ }
  try {
    await opts.deps.exec(`git branch -D ${shellQuote(branch)}`, { cwd: opts.cwd });
  } catch { /* branch may not exist */ }

  try {
    await opts.deps.exec(
      `git worktree add -b ${shellQuote(branch)} ${shellQuote(worktreePath)} ${shellQuote(opts.baseBranch)}`,
      { cwd: opts.cwd }
    );
  } catch (error) {
    if (existing !== undefined) {
      await writeRegistry(opts.registryFile, {
        worktrees: registry.worktrees.map((worktree) =>
          worktree.name === opts.name ? { ...worktree, status: "failed" } : worktree
        )
      }, opts.deps.fs).catch(() => undefined);
    }
    throw error;
  }

  const entry: Worktree = {
    name: opts.name,
    path: worktreePath,
    branch,
    baseBranch: opts.baseBranch,
    createdAt: new Date().toISOString(),
    source: opts.source,
    agent: opts.agent,
    status: "active",
    ...(opts.storyId !== undefined && { storyId: opts.storyId }),
    ...(opts.planPath !== undefined && { planPath: opts.planPath }),
    ...(opts.prompt !== undefined && { prompt: opts.prompt }),
    sourceCwd: opts.sourceCwd ?? opts.cwd,
    baseHead
  };

  try {
    await writeRegistry(opts.registryFile, {
      worktrees: [...registry.worktrees.filter((worktree) => worktree.name !== opts.name), entry]
    }, opts.deps.fs);
  } catch (error) {
    await opts.deps.exec(`git worktree remove ${shellQuote(worktreePath)} --force`, { cwd: opts.cwd }).catch(() => undefined);
    await opts.deps.exec(`git branch -D ${shellQuote(branch)}`, { cwd: opts.cwd }).catch(() => undefined);
    if (existing !== undefined) {
      await writeRegistry(opts.registryFile, {
        worktrees: registry.worktrees.map((worktree) =>
          worktree.name === opts.name ? { ...worktree, status: "failed" } : worktree
        )
      }, opts.deps.fs).catch(() => undefined);
    }
    throw error;
  }

  return entry;
}

async function assertInsideGitWorkTree(cwd: string, deps: WorktreeDeps): Promise<void> {
  try {
    const result = await deps.exec("git rev-parse --is-inside-work-tree", { cwd });
    if (result.stdout.trim() === "true") {
      return;
    }
  } catch {
    // Normalize git's various cwd/repository failures into the worktree-mode error below.
  }
  throw new Error("Cannot run with --worktree because the destination path is not inside a git work tree.");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function assertSafeWorktreeName(name: string): void {
  if (
    name.length === 0 ||
    name !== name.trim() ||
    name === "." ||
    name === ".." ||
    name.startsWith("/") ||
    name.startsWith("\\") ||
    name.startsWith(".") ||
    name.endsWith(".") ||
    name.endsWith(".lock") ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..")
  ) {
    throw new Error("Worktree name must be a safe single path segment.");
  }

  for (const character of name) {
    const code = character.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isUppercase = code >= 65 && code <= 90;
    const isLowercase = code >= 97 && code <= 122;
    if (!isDigit && !isUppercase && !isLowercase && character !== "-" && character !== "_" && character !== ".") {
      throw new Error("Worktree name must be a safe single path segment.");
    }
  }
}
