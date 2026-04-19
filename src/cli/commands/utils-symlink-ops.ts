import { isNotFound } from "@poe-code/config-mutations";
import type { FileSystem } from "../../utils/file-system.js";

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
          await fs.rename(op.from, op.to);
        }
        break;
      }
      case "symlink": {
        opts.log(`symlink ${op.path} -> ${op.target}`);
        if (!opts.dryRun) {
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
