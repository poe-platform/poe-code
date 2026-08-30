import { execFile } from "node:child_process";
import { mkdir, readlink, realpath, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { containsPath, isSamePath, resolveCanonicalPath } from "./canonical-path.js";

export type GitSavepoint = {
  head: string;
  stashRef?: string;
};

export type GitCommitOptions = {
  message: string;
  files?: string[];
};

export type GitWorktree = {
  path: string;
  branch: string;
};

export type GitWorktreeCreateOptions = {
  base?: string;
  path?: string;
};

type ExecFileResult = {
  stdout: string;
  stderr: string;
};

const GIT_EXEC_MAX_BUFFER = 10 * 1024 * 1024;
const SAVEPOINT_REF_PREFIX = "refs/poe-code/checkpoints/";

export function makeGitModule(cwd: string): {
  head(): Promise<string>;
  checkpoint(): Promise<GitSavepoint>;
  commit(options: GitCommitOptions): Promise<string>;
  revert(savepoint: GitSavepoint): Promise<void>;
  diff(): Promise<string>;
  worktreeCreate(branch: string, options?: GitWorktreeCreateOptions): Promise<GitWorktree>;
  worktreeRemove(path: string): Promise<void>;
  worktreeList(): Promise<GitWorktree[]>;
} {
  const normalizedCwd = readNonEmptyString(cwd, "Git module cwd");

  return {
    async head() {
      return runGitAndTrim(normalizedCwd, ["rev-parse", "HEAD"]);
    },

    async checkpoint() {
      const currentHead = await runGitAndTrim(normalizedCwd, ["rev-parse", "HEAD"]);
      const status = await runGitAndTrim(normalizedCwd, ["status", "--porcelain"]);

      if (status.length === 0) {
        return {
          head: currentHead
        };
      }

      const stashRef = createSavepointRef();
      const stashMessage = `poe-code checkpoint ${stashRef}`;

      await runGit(normalizedCwd, [
        "stash",
        "push",
        "--include-untracked",
        "--message",
        stashMessage
      ]);

      try {
        const stashOid = await runGitAndTrim(normalizedCwd, ["rev-parse", "stash@{0}"]);
        await runGit(normalizedCwd, ["update-ref", stashRef, stashOid]);
        await runGit(normalizedCwd, ["stash", "apply", "--index", stashRef]);
        await runGit(normalizedCwd, ["stash", "drop", "stash@{0}"]);

        return {
          head: currentHead,
          stashRef
        };
      } catch (error) {
        await cleanupFailedCheckpoint(normalizedCwd, stashRef);
        throw error;
      }
    },

    async commit(options) {
      const normalizedOptions = normalizeCommitOptions(options);

      if (normalizedOptions.files === undefined) {
        await runGit(normalizedCwd, ["add", "--all"]);
        await runGit(normalizedCwd, ["commit", "--message", normalizedOptions.message]);
      } else {
        await runGit(normalizedCwd, ["add", "--", ...normalizedOptions.files]);
        await runGit(normalizedCwd, [
          "commit",
          "--message",
          normalizedOptions.message,
          "--",
          ...normalizedOptions.files
        ]);
      }
      return runGitAndTrim(normalizedCwd, ["rev-parse", "HEAD"]);
    },

    async revert(savepoint) {
      const normalizedSavepoint = normalizeSavepoint(savepoint);

      try {
        await runGit(normalizedCwd, ["reset", "--hard", normalizedSavepoint.head]);
        await runGit(normalizedCwd, ["clean", "--force", "-d"]);

        if (normalizedSavepoint.stashRef !== undefined) {
          await runGit(normalizedCwd, ["stash", "apply", "--index", normalizedSavepoint.stashRef]);
        }
      } finally {
        if (normalizedSavepoint.stashRef !== undefined) {
          await deleteSavepointRef(normalizedCwd, normalizedSavepoint.stashRef);
        }
      }
    },

    async diff() {
      const { stdout } = await runGit(normalizedCwd, ["diff", "HEAD", "--"]);
      return stdout;
    },

    async worktreeCreate(branch, options) {
      const normalizedBranch = readNonEmptyString(branch, "Git worktree branch");
      const normalizedOptions = normalizeWorktreeCreateOptions(options);
      const repoRoot = await getRepoRoot(normalizedCwd);
      const worktreePath = await resolveWorktreePath(
        repoRoot,
        normalizedOptions.path ?? createDefaultWorktreePath(repoRoot, normalizedBranch),
        "Git worktree path"
      );

      if (await gitRefExists(normalizedCwd, `refs/heads/${normalizedBranch}`)) {
        throw new Error(`Git worktree branch '${normalizedBranch}' already exists.`);
      }

      await mkdir(dirname(worktreePath), { recursive: true });

      try {
        await runGit(normalizedCwd, [
          "worktree",
          "add",
          "-b",
          normalizedBranch,
          worktreePath,
          normalizedOptions.base
        ]);
      } catch (error) {
        if (isBranchAlreadyExistsError(error, normalizedBranch)) {
          throw new Error(`Git worktree branch '${normalizedBranch}' already exists.`);
        }

        throw error;
      }

      return {
        path: worktreePath,
        branch: normalizedBranch
      };
    },

    async worktreeRemove(path) {
      const repoRoot = await getRepoRoot(normalizedCwd);
      const worktreePath = await resolveWorktreePath(repoRoot, path, "Git worktree path");
      const worktrees = await listWorktrees(normalizedCwd);

      if (!worktrees.some((worktree) => resolve(worktree.path) === worktreePath)) {
        return;
      }

      await runGit(normalizedCwd, ["worktree", "remove", "--force", worktreePath]);
      await rm(worktreePath, { recursive: true, force: true });
    },

    async worktreeList() {
      return listWorktrees(normalizedCwd);
    }
  };
}

function normalizeCommitOptions(options: GitCommitOptions | unknown): GitCommitOptions {
  if (!isRecord(options)) {
    throw new Error("Git commit options must be an object.");
  }

  const files = getOwnProperty(options, "files");

  return {
    message: readNonEmptyString(getOwnProperty(options, "message"), "Git commit options message"),
    files:
      files === undefined ? undefined : readNonEmptyStringArray(files, "Git commit options files")
  };
}

function normalizeSavepoint(savepoint: GitSavepoint | unknown): GitSavepoint {
  if (!isRecord(savepoint)) {
    throw new Error("Git savepoint must be an object.");
  }

  const stashRefValue = getOwnProperty(savepoint, "stashRef");
  const stashRef =
    stashRefValue === undefined
      ? undefined
      : readNonEmptyString(stashRefValue, "Git savepoint stashRef");
  if (stashRef !== undefined && !stashRef.startsWith(SAVEPOINT_REF_PREFIX)) {
    throw new Error("Git savepoint stashRef must be a Poe checkpoint ref.");
  }

  return {
    head: readNonEmptyString(getOwnProperty(savepoint, "head"), "Git savepoint head"),
    stashRef
  };
}

function normalizeWorktreeCreateOptions(
  options: GitWorktreeCreateOptions | unknown
): GitWorktreeCreateOptions & {
  base: string;
} {
  if (options === undefined) {
    return {
      base: "HEAD"
    };
  }

  if (!isRecord(options)) {
    throw new Error("Git worktree create options must be an object.");
  }

  const base = getOwnProperty(options, "base");
  const path = getOwnProperty(options, "path");

  return {
    base:
      base === undefined ? "HEAD" : readNonEmptyString(base, "Git worktree create options base"),
    path:
      path === undefined ? undefined : readNonEmptyString(path, "Git worktree create options path")
  };
}

function createSavepointRef(): string {
  return `${SAVEPOINT_REF_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createDefaultWorktreePath(repoRoot: string, branch: string): string {
  return resolve(repoRoot, ".poe-code", "worktrees", createSafeBranchDirectoryName(branch));
}

function createSafeBranchDirectoryName(branch: string): string {
  return encodeURIComponent(branch);
}

async function getRepoRoot(cwd: string): Promise<string> {
  return runGitAndTrim(cwd, ["rev-parse", "--show-toplevel"]);
}

async function gitRefExists(cwd: string, ref: string): Promise<boolean> {
  try {
    await runGit(cwd, ["show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch (error) {
    void error;
    return false;
  }
}

async function listWorktrees(cwd: string): Promise<GitWorktree[]> {
  const { stdout } = await runGit(cwd, ["worktree", "list", "--porcelain"]);
  return parseWorktreeList(stdout);
}

function parseWorktreeList(output: string): GitWorktree[] {
  const worktrees: GitWorktree[] = [];
  let current: Partial<GitWorktree> = {};

  const finishCurrent = () => {
    if (current.path !== undefined && current.branch !== undefined) {
      worktrees.push({
        path: current.path,
        branch: current.branch
      });
    }

    current = {};
  };

  for (const line of output.split("\n")) {
    if (line.length === 0) {
      finishCurrent();
      continue;
    }

    if (line.startsWith("worktree ")) {
      current.path = line.slice("worktree ".length);
      continue;
    }

    if (line.startsWith("branch ")) {
      current.branch = parseBranchRef(line.slice("branch ".length));
    }
  }

  finishCurrent();
  return worktrees;
}

function parseBranchRef(ref: string): string {
  const branchPrefix = "refs/heads/";
  return ref.startsWith(branchPrefix) ? ref.slice(branchPrefix.length) : ref;
}

async function resolveWorktreePath(repoRoot: string, path: string, label: string): Promise<string> {
  const resolvedRoot = resolve(repoRoot);
  const resolvedPath = isAbsolute(path) ? resolve(path) : resolve(resolvedRoot, path);
  const canonicalRoot = await realpath(resolvedRoot);
  const canonicalPath = await resolveCanonicalPath({ realpath, readlink }, resolvedPath);

  // A worktree lives somewhere under the repository, never at the repository root
  // itself, so root-itself is rejected alongside anything outside it. Both answers
  // come from the filesystem rather than the spelling: on a case-insensitive
  // filesystem a differently cased path still names the repository root.
  const [inside, isRootItself] = await Promise.all([
    containsPath(stat, canonicalRoot, canonicalPath),
    isSamePath(stat, canonicalPath, canonicalRoot)
  ]);

  if (!inside || isRootItself) {
    throw new Error(`${label} must be inside the git repository.`);
  }

  return canonicalPath;
}

function isBranchAlreadyExistsError(error: unknown, branch: string): boolean {
  return (
    error instanceof Error &&
    error.message.includes(branch) &&
    error.message.includes("already exists")
  );
}

async function runGitAndTrim(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await runGit(cwd, args);
  return stdout.trim();
}

async function runGit(cwd: string, args: string[]): Promise<ExecFileResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "utf8",
        maxBuffer: GIT_EXEC_MAX_BUFFER
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `${formatGitCommand(args)} failed: ${pickGitFailureMessage(stdout, stderr, error)}`
            )
          );
          return;
        }

        resolve({
          stdout,
          stderr
        });
      }
    );
  });
}

async function cleanupFailedCheckpoint(cwd: string, stashRef: string): Promise<void> {
  await deleteSavepointRef(cwd, stashRef);
  const restored = await tryRunGit(cwd, ["stash", "apply", "--index", "stash@{0}"]);
  if (restored) {
    await tryRunGit(cwd, ["stash", "drop", "stash@{0}"]);
  }
}

async function deleteSavepointRef(cwd: string, stashRef: string): Promise<void> {
  await tryRunGit(cwd, ["update-ref", "--delete", stashRef]);
}

async function tryRunGit(cwd: string, args: string[]): Promise<boolean> {
  try {
    await runGit(cwd, args);
    return true;
  } catch (error) {
    void error;
    return false;
  }
}

function formatGitCommand(args: string[]): string {
  return ["git", ...args].join(" ");
}

function pickGitFailureMessage(stdout: string, stderr: string, error: Error): string {
  const stderrText = stderr.trim();

  if (stderrText.length > 0) {
    return stderrText;
  }

  const stdoutText = stdout.trim();

  if (stdoutText.length > 0) {
    return stdoutText;
  }

  return error.message;
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function readNonEmptyStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array of strings.`);
  }

  const entries = value.map((entry, index) => readNonEmptyString(entry, `${label}[${index}]`));
  return [...entries];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getOwnProperty<Name extends PropertyKey>(value: object, name: Name): unknown {
  return hasOwnProperty(value, name) ? value[name] : undefined;
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}
