import path from "node:path";
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

function selectedFileScope(root: string, managedPaths: readonly string[], top: boolean): string {
  const relativePaths = [...new Set(managedPaths.map((filePath) => path.relative(root, filePath)))];
  const exclusions = relativePaths
    .filter((filePath) => filePath !== "" && filePath !== ".." && !filePath.startsWith(`..${path.sep}`) && !path.isAbsolute(filePath))
    .map((filePath) => shellEscape(`:(${top ? "top," : ""}exclude,literal)${filePath.split(path.sep).join("/")}`));
  return [top ? shellEscape(":(top)") : ".", ...exclusions].join(" ");
}

export function createExperimentCommitCommand(cwd: string, managedPaths: readonly string[], message: string): string {
  const scope = selectedFileScope(cwd, managedPaths.map((filePath) => path.resolve(cwd, filePath)), false);
  return `git add -A -- ${scope} && git commit -m ${shellEscape(message)} -- ${scope}`;
}

async function readCurrentHash(exec: ExecFn, cwd: string, scope?: string): Promise<string> {
  const status = await runOrThrow(
    exec,
    `git status --porcelain --untracked-files=all -- ${scope ?? `. ':(exclude)${EXPERIMENT_DOCS_PATH}'`}`,
    cwd
  );
  if (status.stdout.trim().length > 0) {
    throw new Error(
      `Experiment loop requires a clean working tree outside ${scope === undefined ? EXPERIMENT_DOCS_PATH : "the selected document and journal"}.`
    );
  }

  const { stdout } = await runOrThrow(exec, "git rev-parse --short HEAD", cwd);

  return stdout.trim();
}

async function readStashHash(exec: ExecFn, cwd: string): Promise<string | undefined> {
  const result = await exec("git rev-parse -q --verify refs/stash", { cwd });

  return result.exitCode === 0 && result.stdout.trim().length > 0 ? result.stdout.trim() : undefined;
}

export function createDefaultGit(exec: ExecFn, managedPaths?: readonly string[]): ExperimentGit {
  async function resolveScope(cwd: string): Promise<string | undefined> {
    if (managedPaths === undefined) return undefined;
    const { stdout } = await runOrThrow(exec, "git rev-parse --show-cdup", cwd);
    const root = path.resolve(cwd, stdout.trim());
    return selectedFileScope(root, managedPaths.map((filePath) => path.resolve(cwd, filePath)), true);
  }

  return {
    async reset(commitHash: string, cwd: string): Promise<void> {
      const scope = await resolveScope(cwd);
      if (scope !== undefined) {
        await runOrThrow(exec, `git restore --source=${shellEscape(commitHash)} --staged --worktree -- ${scope}`, cwd);
        await runOrThrow(exec, `git reset --mixed -q ${shellEscape(commitHash)}`, cwd);
        return;
      }

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
      return readCurrentHash(exec, cwd, await resolveScope(cwd));
    }
  };
}
