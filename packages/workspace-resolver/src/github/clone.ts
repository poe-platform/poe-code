import path from "node:path";
import { assertPathHasNoSymbolicLinks } from "../path-safety.js";
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
    `${locator.owner.length.toString(36)}-${locator.owner}-${locator.repo}`
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
  await assertPathHasNoSymbolicLinks(options.fs, cacheDir);
  const exists = await pathExists(options.fs, cacheDir);

  if (!exists) {
    await options.fs.mkdir(path.dirname(cacheDir), { recursive: true });
    await assertPathHasNoSymbolicLinks(options.fs, cacheDir);
    await assertExecSuccess(
      await options.exec("git", ["clone", "--depth", "1", buildCloneUrl(locator), cacheDir]),
      "git clone failed"
    );
  } else {
    const statusResult = await options.exec("git", ["status", "--porcelain"], { cwd: cacheDir });
    assertExecSuccess(statusResult, "git status failed");
    if (statusResult.exitCode === 0 && statusResult.stdout.trim().length === 0) {
      await assertExecSuccess(
        await options.exec("git", ["pull", "--ff-only"], { cwd: cacheDir }),
        "git pull failed"
      );
    }
  }

  if (locator.ref) {
    await fetchRef(cacheDir, locator.ref, options);
    await assertExecSuccess(
      await options.exec("git", ["checkout", "FETCH_HEAD", "--"], { cwd: cacheDir }),
      "git checkout failed"
    );
  }

  return cacheDir;
}

export async function fetchRef(
  cacheDir: string,
  ref: string,
  options: WorkspaceResolverOptions
): Promise<void> {
  await assertExecSuccess(
    await options.exec("git", ["fetch", "origin", "--", ref], { cwd: cacheDir }),
    "git fetch failed"
  );
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
