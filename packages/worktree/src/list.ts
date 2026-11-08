import { readRegistry } from "./registry.js";
import type { Worktree, WorktreeDeps } from "./types.js";

export type ListWorktreeEntry = Worktree & {
  gitExists: boolean;
};

export async function listWorktrees(
  cwd: string,
  registryFile: string,
  deps: WorktreeDeps
): Promise<ListWorktreeEntry[]> {
  const registry = await readRegistry(registryFile, deps.fs);
  const gitOutput = await deps.exec("git worktree list --porcelain", {
    cwd
  });

  const gitPaths = parseGitWorktreeList(gitOutput.stdout);

  return registry.worktrees.map((entry) => ({
    ...entry,
    gitExists: gitPaths.has(entry.path)
  }));
}

function parseGitWorktreeList(output: string): Set<string> {
  const paths = new Set<string>();
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      paths.add(line.slice("worktree ".length));
    }
  }
  return paths;
}
