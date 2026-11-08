export type {
  Worktree,
  WorktreeStatus,
  WorktreeReconciliationSummary,
  WorktreeRegistry,
  WorktreeFileSystem,
  ExecFn,
  ExecResult,
  WorktreeDeps
} from "./types.js";
export { createWorktree, type CreateWorktreeOptions } from "./create.js";
export { removeWorktree, type RemoveWorktreeOptions } from "./remove.js";
export { listWorktrees, type ListWorktreeEntry } from "./list.js";
export { readRegistry, updateWorktreeEntry, updateWorktreeStatus } from "./registry.js";
export {
  reconcileWorktree,
  type ReconcileWorktreeOptions,
  type WorktreeReconcilePhase,
  type WorktreeReconciliationAgent
} from "./reconcile.js";
