import path from "node:path";
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
    createCheckoutId()
  );
  const revision = locator.ref ?? "HEAD";

  await options.fs.mkdir(path.dirname(cwd), { recursive: true });
  await assertExecSuccess(
    await options.exec("git", ["worktree", "add", "--detach", cwd, revision], {
      cwd: sourceCwd
    }),
    "git worktree add failed"
  );
  await options.fs.mkdir(cwd, { recursive: true });

  return {
    cwd,
    cleanup: async () => {
      const result = await options.exec("git", ["worktree", "remove", "--force", cwd], {
        cwd: sourceCwd
      });

      if (result.exitCode === 0) {
        return;
      }

      if (options.fs.rm) {
        await options.fs.rm(cwd, { recursive: true, force: true });
      }
    }
  };
}

function createCheckoutId(): string {
  return `${Date.now().toString(36)}-${process.pid.toString(36)}`;
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
