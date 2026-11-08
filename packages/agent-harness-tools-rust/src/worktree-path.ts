import path from "node:path";

/** Keep repository-absolute paths inside the selected execution worktree. */
export function mapSourcePathIntoWorktree(sourceCwd: string, sourcePath: string, worktreeCwd: string): string {
  if (!path.isAbsolute(sourcePath)) return sourcePath;
  const worktreeRelative = path.relative(worktreeCwd, sourcePath);
  if (worktreeRelative === "" || (worktreeRelative !== ".." && !worktreeRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(worktreeRelative))) {
    return sourcePath;
  }
  const relativePath = path.relative(sourceCwd, sourcePath);
  if (relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath))) {
    return path.join(worktreeCwd, relativePath);
  }
  return sourcePath;
}
