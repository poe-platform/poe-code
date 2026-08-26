export type WorktreeStatus =
  | "active"
  | "reconciling"
  | "conflicted"
  | "cleanup_failed"
  | "done"
  | "failed"
  | "removing";

export type WorktreeReconciliationSummary = {
  committed: "none" | "present" | "merged_by_agent" | "failed";
  uncommitted: "none" | "present" | "applied_by_agent" | "failed";
  removed: boolean;
  cleanup: "not_needed" | "removed_by_agent" | "nudged" | "failed";
  conflictFiles: string[];
  threadId?: string;
};

export type Worktree = {
  name: string;
  path: string;
  branch: string;
  baseBranch: string;
  createdAt: string;
  source: string;
  agent: string;
  status: WorktreeStatus;
  storyId?: string;
  planPath?: string;
  prompt?: string;
  sourceCwd?: string;
  baseHead?: string;
  reconciledAt?: string;
  reconciliation?: WorktreeReconciliationSummary;
};

export type WorktreeRegistry = {
  worktrees: Worktree[];
};

export type WorktreeFileSystem = {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(
    path: string,
    data: string,
    options?: { encoding?: BufferEncoding; flag?: string }
  ): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rmdir(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
};

export type ExecResult = {
  stdout: string;
  stderr: string;
};

export type ExecFn = (
  command: string,
  options?: { cwd?: string }
) => Promise<ExecResult>;

export type WorktreeDeps = {
  fs: WorktreeFileSystem;
  exec: ExecFn;
};
