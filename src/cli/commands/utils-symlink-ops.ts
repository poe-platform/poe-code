import { dirname } from "node:path";
import { isNotFound } from "@poe-code/config-mutations";
import { hasOwnErrorCode } from "../../utils/error-codes.js";
import type { FileSystem } from "../../utils/file-system.js";

export async function tryLstat(fs: FileSystem, path: string) {
  try {
    return await fs.lstat(path);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

export function formatLoggedPath(
  message: string,
  env: { cwd: string; homeDir: string }
): string {
  return message
    .replaceAll(`${env.cwd}/`, "")
    .replaceAll(`${env.homeDir}/`, "~/");
}

export function isPermissionError(error: unknown): error is NodeJS.ErrnoException {
  return hasOwnErrorCode(error, "EACCES") || hasOwnErrorCode(error, "EPERM");
}

export type SymlinkOp =
  | { kind: "rename"; from: string; to: string }
  | { kind: "symlink"; target: string; path: string }
  | { kind: "noop"; reason: string }
  | { kind: "conflict"; message: string };

export async function applySymlinkOps(
  fs: FileSystem,
  ops: SymlinkOp[],
  opts: { dryRun: boolean; log: (msg: string) => void }
): Promise<{ conflicts: number }> {
  let conflicts = 0;
  const appliedOps: Array<Extract<SymlinkOp, { kind: "rename" | "symlink" }>> = [];

  try {
    for (const op of ops) {
      switch (op.kind) {
        case "rename": {
          opts.log(`rename ${op.from} -> ${op.to}`);
          if (!opts.dryRun) {
            await fs.mkdir(dirname(op.to), { recursive: true });
            await fs.rename(op.from, op.to);
            appliedOps.push(op);
          }
          break;
        }
        case "symlink": {
          opts.log(`symlink ${op.path} -> ${op.target}`);
          if (!opts.dryRun) {
            await fs.mkdir(dirname(op.path), { recursive: true });
            await fs.symlink(op.target, op.path);
            appliedOps.push(op);
          }
          break;
        }
        case "noop": {
          opts.log(op.reason);
          break;
        }
        case "conflict": {
          conflicts += 1;
          opts.log(op.message);
          break;
        }
        default: {
          const neverOp: never = op;
          throw new Error(`Unsupported symlink op: ${(neverOp as { kind: string }).kind}`);
        }
      }
    }
  } catch (error) {
    try {
      await rollbackSymlinkOps(fs, appliedOps);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        [
          `Symlink operation failed: ${formatUnknownError(error)}`,
          `Rollback failed: ${formatUnknownError(rollbackError)}`
        ].join(" ")
      );
    }
    throw error;
  }

  return { conflicts };
}

async function rollbackSymlinkOps(
  fs: FileSystem,
  appliedOps: Array<Extract<SymlinkOp, { kind: "rename" | "symlink" }>>
): Promise<void> {
  for (const op of appliedOps.reverse()) {
    if (op.kind === "symlink") {
      await fs.unlink(op.path);
      continue;
    }

    await fs.rename(op.to, op.from);
  }
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return String(error);
}

export async function isSymlinkPointingTo(
  fs: FileSystem,
  path: string,
  expectedTarget: string
): Promise<boolean> {
  try {
    const stats = await fs.lstat(path);
    if (!stats.isSymbolicLink()) {
      return false;
    }

    return (await fs.readlink(path)) === expectedTarget;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}
