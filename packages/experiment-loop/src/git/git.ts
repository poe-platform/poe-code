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
    async commitAll(message: string, cwd: string): Promise<string> {
      await runOrThrow(exec, "git add -A", cwd);
      await runOrThrow(exec, `git reset -q HEAD -- ${EXPERIMENT_DOCS_PATH}`, cwd);

      const diffResult = await exec("git diff --cached --quiet", { cwd });

      if (diffResult.exitCode === 0) {
        return readCurrentHash(exec, cwd);
      }

      if (diffResult.exitCode !== 1) {
        throw new Error(
          diffResult.stderr || diffResult.stdout || "Failed to detect staged git changes"
        );
      }

      await runOrThrow(exec, `git commit -m ${shellEscape(message)}`, cwd);

      return readCurrentHash(exec, cwd);
    },

    async reset(commitHash: string, cwd: string): Promise<void> {
      await runOrThrow(exec, `git reset --hard ${shellEscape(commitHash)}`, cwd);
    },

    async currentHash(cwd: string): Promise<string> {
      return readCurrentHash(exec, cwd);
    }
  };
}
