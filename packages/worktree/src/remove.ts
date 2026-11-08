import { withRegistryTransaction } from "./registry.js";
import { worktreeNotFoundError } from "./not-found.js";
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
  await withRegistryTransaction(opts.registryFile, opts.deps.fs, async (registry, write) => {
    const entry = registry.worktrees.find((worktree) => worktree.name === opts.name);
    if (!entry) {
      throw worktreeNotFoundError(opts.name, registry.worktrees);
    }

    await write({
      worktrees: registry.worktrees.map((worktree) =>
        worktree.name === opts.name ? { ...worktree, status: "removing" } : worktree
      )
    });

    try {
      await opts.deps.exec(`git worktree remove ${shellQuote(entry.path)}`, {
        cwd: opts.cwd
      });
    } catch (error) {
      await write(registry).catch(() => undefined);
      throw error;
    }

    await write({ worktrees: registry.worktrees.filter((worktree) => worktree.name !== opts.name) });

    if (opts.deleteBranch) {
      await opts.deps.exec(`git branch -D ${shellQuote(entry.branch)}`, {
        cwd: opts.cwd
      });
    }
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
