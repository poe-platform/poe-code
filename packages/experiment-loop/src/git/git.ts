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
  const { stdout } = await runOrThrow(exec, "git rev-parse --short HEAD", cwd);

  return stdout.trim();
}

export function createDefaultGit(exec: ExecFn): ExperimentGit {
  return {
    async reset(commitHash: string, cwd: string): Promise<void> {
      const stashResult = await exec(
        `git stash push -q --include-untracked -- ${EXPERIMENT_DOCS_PATH}`,
        { cwd }
      );
      const stashed = stashResult.exitCode === 0;

      await runOrThrow(exec, `git reset --hard ${shellEscape(commitHash)}`, cwd);

      if (stashed) {
        await exec("git stash pop -q", { cwd });
      }
    },

    async currentHash(cwd: string): Promise<string> {
      return readCurrentHash(exec, cwd);
    }
  };
}
