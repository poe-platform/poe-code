import { removeWorktreeEntry, readRegistry, writeRegistry } from "./registry.js";
import type { WorktreeDeps } from "./types.js";

export type RemoveWorktreeOptions = {
  cwd: string;
  name: string;
  registryFile: string;
  deleteBranch?: boolean;
  deps: WorktreeDeps;
};

export async function removeWorktree(
  opts: RemoveWorktreeOptions
): Promise<void> {
  const registry = await readRegistry(opts.registryFile, opts.deps.fs);
  const entry = registry.worktrees.find((w) => w.name === opts.name);
  if (!entry) {
    throw new Error(`Worktree "${opts.name}" not found in registry`);
  }

  await writeRegistry(opts.registryFile, {
    worktrees: registry.worktrees.map((worktree) =>
      worktree.name === opts.name ? { ...worktree, status: "removing" } : worktree
    )
  }, opts.deps.fs);

  try {
    await opts.deps.exec(`git worktree remove ${shellQuote(entry.path)}`, {
      cwd: opts.cwd
    });
  } catch (error) {
    await writeRegistry(opts.registryFile, registry, opts.deps.fs).catch(() => undefined);
    throw error;
  }

  await removeWorktreeEntry(opts.registryFile, opts.name, opts.deps.fs);

  if (opts.deleteBranch) {
    await opts.deps.exec(`git branch -D ${shellQuote(entry.branch)}`, {
      cwd: opts.cwd
    });
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
