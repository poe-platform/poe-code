import { UserError } from "@poe-code/user-error";
import type { Worktree } from "./types.js";

/**
 * The registry is invisible until listed, so a wrong name is answered with the
 * names that would have worked plus the command that shows them.
 */
export function worktreeNotFoundError(name: string, worktrees: Worktree[]): UserError {
  const known = worktrees.map((worktree) => worktree.name);
  return new UserError(
    [
      `Worktree "${name}" not found in registry`,
      known.length > 0
        ? `Known worktrees: ${known.join(", ")}`
        : "No worktrees are registered.",
      "Run `poe-code worktree list` to see registered worktrees."
    ].join("\n")
  );
}
