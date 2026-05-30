import type { ExecFn, ExperimentGit } from "../types.js";

const EXPERIMENT_DOCS_PATH = ".poe-code/experiments";

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function runOrThrow(exec: ExecFn, command: string, cwd: string) {
  const result = await exec(command, { cwd });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `Command failed: ${command}`);
  }

  return result;
}

async function readCurrentHash(exec: ExecFn, cwd: string): Promise<string> {
  const status = await runOrThrow(
    exec,
    `git status --porcelain --untracked-files=all -- . ':(exclude)${EXPERIMENT_DOCS_PATH}'`,
    cwd
  );
  if (status.stdout.trim().length > 0) {
    throw new Error(
      `Experiment loop requires a clean working tree outside ${EXPERIMENT_DOCS_PATH}.`
    );
  }

  const { stdout } = await runOrThrow(exec, "git rev-parse --short HEAD", cwd);

  return stdout.trim();
}

async function readStashHash(exec: ExecFn, cwd: string): Promise<string | undefined> {
  const result = await exec("git rev-parse -q --verify refs/stash", { cwd });

  return result.exitCode === 0 && result.stdout.trim().length > 0 ? result.stdout.trim() : undefined;
}

export function createDefaultGit(exec: ExecFn): ExperimentGit {
  return {
    async reset(commitHash: string, cwd: string): Promise<void> {
      const previousStashHash = await readStashHash(exec, cwd);
      const stashResult = await exec(
        `git stash push -q --include-untracked -- ${EXPERIMENT_DOCS_PATH}`,
        { cwd }
      );
      const scopedStashHash = await readStashHash(exec, cwd);
      const stashed = stashResult.exitCode === 0 && scopedStashHash !== undefined && scopedStashHash !== previousStashHash;

      await runOrThrow(exec, `git reset --hard ${shellEscape(commitHash)}`, cwd);

      if (stashed) {
        await runOrThrow(exec, `git stash pop -q ${shellEscape("stash@{0}")}`, cwd);
      }
    },

    async currentHash(cwd: string): Promise<string> {
      return readCurrentHash(exec, cwd);
    }
  };
}
