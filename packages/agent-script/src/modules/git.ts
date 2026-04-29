import { execFile } from "node:child_process";

export type GitSavepoint = {
  head: string;
  stashRef?: string;
};

export type GitCommitOptions = {
  message: string;
  files?: string[];
};

type ExecFileResult = {
  stdout: string;
  stderr: string;
};

const GIT_EXEC_MAX_BUFFER = 10 * 1024 * 1024;

export function makeGitModule(cwd: string): {
  head(): Promise<string>;
  checkpoint(): Promise<GitSavepoint>;
  commit(options: GitCommitOptions): Promise<string>;
  revert(savepoint: GitSavepoint): Promise<void>;
  diff(): Promise<string>;
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

      await runGit(normalizedCwd, ["stash", "push", "--include-untracked", "--message", stashMessage]);

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
        await cleanupSavepoint(normalizedCwd, stashRef);
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
    }
  };
}

function normalizeCommitOptions(options: GitCommitOptions | unknown): GitCommitOptions {
  if (!isRecord(options)) {
    throw new Error("Git commit options must be an object.");
  }

  return {
    message: readNonEmptyString(options.message, "Git commit options message"),
    ...(options.files === undefined ? {} : { files: readNonEmptyStringArray(options.files, "Git commit options files") })
  };
}

function normalizeSavepoint(savepoint: GitSavepoint | unknown): GitSavepoint {
  if (!isRecord(savepoint)) {
    throw new Error("Git savepoint must be an object.");
  }

  return {
    head: readNonEmptyString(savepoint.head, "Git savepoint head"),
    ...(savepoint.stashRef === undefined
      ? {}
      : { stashRef: readNonEmptyString(savepoint.stashRef, "Git savepoint stashRef") })
  };
}

function createSavepointRef(): string {
  return `refs/poe-code/checkpoints/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
          reject(new Error(`${formatGitCommand(args)} failed: ${pickGitFailureMessage(stdout, stderr, error)}`));
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

async function cleanupSavepoint(cwd: string, stashRef: string): Promise<void> {
  await deleteSavepointRef(cwd, stashRef);
  await tryRunGit(cwd, ["stash", "drop", "stash@{0}"]);
}

async function deleteSavepointRef(cwd: string, stashRef: string): Promise<void> {
  await tryRunGit(cwd, ["update-ref", "--delete", stashRef]);
}

async function tryRunGit(cwd: string, args: string[]): Promise<void> {
  try {
    await runGit(cwd, args);
  } catch (error) {
    void error;
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
