import path from "node:path";
import type { ParsedLocator, WorkspaceResolverOptions } from "../types.js";

export function buildCachePath(
  homeDir: string,
  locator: Extract<ParsedLocator, { scheme: "github" }>
): string {
  return path.join(
    homeDir,
    ".poe-code",
    "workspaces",
    "github",
    `${locator.owner}-${locator.repo}`
  );
}

export function buildCloneUrl(locator: Extract<ParsedLocator, { scheme: "github" }>): string {
  return `https://github.com/${locator.owner}/${locator.repo}.git`;
}

export async function cloneOrUpdate(
  locator: Extract<ParsedLocator, { scheme: "github" }>,
  options: WorkspaceResolverOptions
): Promise<string> {
  const cacheDir = buildCachePath(options.homeDir, locator);
  const exists = await pathExists(options.fs, cacheDir);

  if (!exists) {
    await options.fs.mkdir(path.dirname(cacheDir), { recursive: true });
    await assertExecSuccess(
      await options.exec("git", ["clone", "--depth", "1", buildCloneUrl(locator), cacheDir]),
      "git clone failed"
    );
    await options.fs.mkdir(cacheDir, { recursive: true });
  } else {
    const statusResult = await options.exec("git", ["status", "--porcelain"], { cwd: cacheDir });
    if (statusResult.exitCode === 0 && statusResult.stdout.trim().length === 0) {
      await options.exec("git", ["pull", "--ff-only"], { cwd: cacheDir });
    }
  }

  if (locator.ref) {
    await assertExecSuccess(
      await options.exec("git", ["fetch", "origin"], { cwd: cacheDir }),
      "git fetch failed"
    );
    await assertExecSuccess(
      await options.exec("git", ["checkout", locator.ref], { cwd: cacheDir }),
      "git checkout failed"
    );
  }

  return cacheDir;
}

async function pathExists(
  fs: WorkspaceResolverOptions["fs"],
  target: string
): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

function assertExecSuccess(
  result: Awaited<ReturnType<WorkspaceResolverOptions["exec"]>>,
  fallback: string
): void {
  if (result.exitCode === 0) {
    return;
  }

  const detail = result.stderr.trim() || result.stdout.trim() || fallback;
  throw new Error(detail);
}
