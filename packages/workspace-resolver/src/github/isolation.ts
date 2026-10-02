import { posixPath as path } from "@poe-code/safe-fs/contracts";
import { assertPathHasNoSymbolicLinks } from "../path-safety.js";
import type { ParsedLocator, WorkspaceResolverOptions } from "../types.js";

export async function createWritableCheckout(
  locator: Extract<ParsedLocator, { scheme: "github" }>,
  sourceCwd: string,
  options: WorkspaceResolverOptions
): Promise<{ cwd: string; cleanup: () => Promise<void> }> {
  const cwd = path.join(
    options.homeDir,
    ".poe-code",
    "workspaces",
    "checkouts",
    `${locator.owner}-${locator.repo}`,
    globalThis.crypto.randomUUID()
  );
  const revision = locator.ref ?? "HEAD";

  await assertPathHasNoSymbolicLinks(options.fs, cwd);
  await options.fs.mkdir(path.dirname(cwd), { recursive: true });
  await assertPathHasNoSymbolicLinks(options.fs, cwd);
  try {
    await assertExecSuccess(
      await options.exec("git", ["worktree", "add", "--detach", cwd, revision], {
        cwd: sourceCwd
      }),
      "git worktree add failed"
    );
  } catch (error) {
    await removeCheckout(cwd, sourceCwd, options).catch(() => undefined);
    throw error;
  }
  try {
    await options.fs.mkdir(cwd, { recursive: true });
  } catch (error) {
    await removeCheckout(cwd, sourceCwd, options).catch(() => undefined);
    throw error;
  }

  return {
    cwd,
    cleanup: async () => {
      await removeCheckout(cwd, sourceCwd, options);
    }
  };
}

async function removeCheckout(
  cwd: string,
  sourceCwd: string,
  options: WorkspaceResolverOptions
): Promise<void> {
  await assertPathHasNoSymbolicLinks(options.fs, cwd);
  const result = await options.exec("git", ["worktree", "remove", "--force", cwd], {
    cwd: sourceCwd
  });
  if (result.exitCode === 0) {
    return;
  }
  if (options.fs.rm) {
    await assertPathHasNoSymbolicLinks(options.fs, cwd);
    await options.fs.rm(cwd, { recursive: true, force: true });
    return;
  }
  assertExecSuccess(result, "git worktree remove failed");
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
