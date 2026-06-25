import path from "node:path";
import type { Command } from "commander";
import type { WorktreeExecutionOptions } from "../../sdk/types.js";

export type WorktreeCliOptions = {
  worktree?: boolean;
};

export function addWorktreeOptions(command: Command): Command {
  return command.option("--worktree", "Run in a managed git worktree and reconcile successful output.");
}

export function pickWorktreeOptions(options: Record<string, unknown>): WorktreeExecutionOptions {
  if (options.worktree !== true) {
    return false;
  }
  return true;
}

export function isWorktreeRequested(options: Record<string, unknown>): boolean {
  return options.worktree === true;
}

export function mapSourcePathIntoWorktree(
  sourceCwd: string,
  sourcePath: string,
  worktreeCwd: string
): string {
  if (!path.isAbsolute(sourcePath)) {
    return sourcePath;
  }
  const relativePath = path.relative(sourceCwd, sourcePath);
  if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
    return path.join(worktreeCwd, relativePath);
  }
  return sourcePath;
}
