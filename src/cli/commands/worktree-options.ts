import type { Command } from "commander";
import type { WorktreeExecutionOptions } from "../../sdk/types.js";
export { mapSourcePathIntoWorktree } from "@poe-code/agent-harness-tools";

export type WorktreeCliOptions = {
  worktree?: boolean;
};

export function addWorktreeOptions(command: Command): Command {
  return command.option("--worktree", "Run in a managed git worktree and reconcile successful output");
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
