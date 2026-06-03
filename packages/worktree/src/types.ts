export type WorktreeStatus = "active" | "done" | "failed" | "removing";

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
};

export type WorktreeRegistry = {
  worktrees: Worktree[];
};

export type WorktreeFileSystem = {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(
    path: string,
    data: string,
    options?: { encoding?: BufferEncoding }
  ): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
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
