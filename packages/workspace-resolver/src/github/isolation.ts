import path from "node:path";
import type { ParsedLocator, WorkspaceResolverOptions } from "../types.js";

let nextCheckoutSequence = 0;

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
    createCheckoutId()
  );
  const revision = locator.ref ?? "HEAD";

  await options.fs.mkdir(path.dirname(cwd), { recursive: true });
  const checkoutParentStats = await options.fs.lstat(path.dirname(cwd));
  if (checkoutParentStats.isSymbolicLink()) {
    throw new Error(`Workspace checkout parent "${path.dirname(cwd)}" must not be a symbolic link.`);
  }
  await assertExecSuccess(
    await options.exec("git", ["worktree", "add", "--detach", cwd, revision], {
      cwd: sourceCwd
    }),
    "git worktree add failed"
  );
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

function createCheckoutId(): string {
  nextCheckoutSequence += 1;
  return `${Date.now().toString(36)}-${process.pid.toString(36)}-${nextCheckoutSequence.toString(36)}`;
}

async function removeCheckout(
  cwd: string,
  sourceCwd: string,
  options: WorkspaceResolverOptions
): Promise<void> {
  const result = await options.exec("git", ["worktree", "remove", "--force", cwd], {
    cwd: sourceCwd
  });
  if (result.exitCode === 0) {
    return;
  }
  if (options.fs.rm) {
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
