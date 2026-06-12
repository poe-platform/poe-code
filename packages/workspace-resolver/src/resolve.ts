import path from "node:path";
import { hasOwnErrorCode } from "./error-codes.js";
import { cloneOrUpdate } from "./github/clone.js";
import { createWritableCheckout } from "./github/isolation.js";
import { parseLocator } from "./parse.js";
import type { ResolvedWorkspace, WorkspaceResolverOptions } from "./types.js";

export async function resolveWorkspace(
  input: string,
  options: WorkspaceResolverOptions
): Promise<ResolvedWorkspace> {
  const locator = parseLocator(input);
  if (locator.scheme === "local") {
    return {
      cwd: path.isAbsolute(locator.path) ? locator.path : path.resolve(options.baseDir, locator.path),
      locator
    };
  }

  if (locator.scheme === "ssh" || locator.scheme === "docker") {
    throw new Error(`Unsupported workspace locator scheme "${locator.scheme}".`);
  }

  const mode = options.mode ?? "read";
  const needsIsolatedCheckout =
    mode === "edit" || mode === "auto" || (mode === "read" && locator.ref !== undefined);
  const cacheLocator = needsIsolatedCheckout ? { ...locator, ref: undefined } : locator;
  const cacheDir = await cloneOrUpdate(cacheLocator, options);
  let writable:
    | Awaited<ReturnType<typeof createWritableCheckout>>
    | undefined;

  try {
    writable =
      needsIsolatedCheckout
        ? await createWritableCheckout(locator, cacheDir, options)
        : undefined;
    const workspaceRoot = writable?.cwd ?? cacheDir;
    const cwd = locator.subdir ? path.join(workspaceRoot, locator.subdir) : workspaceRoot;

    await assertPathExists(options.fs, cwd, workspaceRoot, locator);

    return {
      cwd,
      ...(writable ? { cleanup: writable.cleanup } : {}),
      locator
    };
  } catch (error) {
    await writable?.cleanup?.();
    throw error;
  }
}

async function assertPathExists(
  fs: WorkspaceResolverOptions["fs"],
  target: string,
  workspaceRoot: string,
  locator: ResolvedWorkspace["locator"]
): Promise<void> {
  if (locator.scheme === "github" && locator.subdir) {
    await assertGithubSubdirHasNoSymbolicLinks(fs, workspaceRoot, locator.subdir);
  }

  let stats: Awaited<ReturnType<WorkspaceResolverOptions["fs"]["stat"]>>;
  try {
    stats = await fs.stat(target);
  } catch {
    if (locator.scheme === "github" && locator.subdir) {
      throw new Error(
        `Workspace subdirectory "${locator.subdir}" does not exist in github://${locator.owner}/${locator.repo}.`
      );
    }
    throw new Error(`Workspace path "${target}" does not exist.`);
  }

  if (!stats.isDirectory()) {
    if (locator.scheme === "github" && locator.subdir) {
      throw new Error(`Workspace subdirectory "${locator.subdir}" is not a directory.`);
    }
    throw new Error(`Workspace path "${target}" is not a directory.`);
  }
}

async function assertGithubSubdirHasNoSymbolicLinks(
  fs: WorkspaceResolverOptions["fs"],
  workspaceRoot: string,
  subdir: string
): Promise<void> {
  let currentPath = workspaceRoot;
  for (const segment of subdir.split("/").filter(Boolean)) {
    currentPath = path.join(currentPath, segment);
    try {
      if ((await fs.lstat(currentPath)).isSymbolicLink()) {
        throw new Error(`Workspace subdirectory "${subdir}" must not be a symbolic link.`);
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }
      throw error;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR");
}
