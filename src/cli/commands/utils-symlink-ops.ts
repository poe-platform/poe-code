import { dirname } from "node:path";
import { isNotFound } from "@poe-code/config-mutations";
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
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EACCES" || error.code === "EPERM")
  );
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

  for (const op of ops) {
    switch (op.kind) {
      case "rename": {
        opts.log(`rename ${op.from} -> ${op.to}`);
        if (!opts.dryRun) {
          await fs.mkdir(dirname(op.to), { recursive: true });
          await fs.rename(op.from, op.to);
        }
        break;
      }
      case "symlink": {
        opts.log(`symlink ${op.path} -> ${op.target}`);
        if (!opts.dryRun) {
          await fs.mkdir(dirname(op.path), { recursive: true });
          await fs.symlink(op.target, op.path);
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

  return { conflicts };
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
