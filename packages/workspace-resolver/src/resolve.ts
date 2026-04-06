import path from "node:path";
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
  const cacheDir = await cloneOrUpdate(locator, options);
  let writable:
    | Awaited<ReturnType<typeof createWritableCheckout>>
    | undefined;

  try {
    writable =
      mode === "read"
        ? undefined
        : await createWritableCheckout(locator, cacheDir, options);
    const workspaceRoot = writable?.cwd ?? cacheDir;
    const cwd = locator.subdir ? path.join(workspaceRoot, locator.subdir) : workspaceRoot;

    await assertPathExists(options.fs, cwd, locator);

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
  locator: ResolvedWorkspace["locator"]
): Promise<void> {
  try {
    await fs.stat(target);
  } catch {
    if (locator.scheme === "github" && locator.subdir) {
      throw new Error(
        `Workspace subdirectory "${locator.subdir}" does not exist in github://${locator.owner}/${locator.repo}.`
      );
    }
    throw new Error(`Workspace path "${target}" does not exist.`);
  }
}
