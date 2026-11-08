import { FsError } from "../contracts/errors.js";
import type { ChmodOptions, FileStagingEntry, FileStat } from "../contracts/filesystem.js";
import { dirname } from "../contracts/virtual-path.js";
import { snapshotDirectoryAncestry } from "./staging-ancestry.js";

export interface ConditionalChmodOptions extends ChmodOptions {
  readonly parent: FileStat;
  readonly expected: FileStat;
  readonly ancestors: readonly FileStagingEntry[];
}

export function snapshotConditionalChmod(path: string, options: ChmodOptions): ConditionalChmodOptions | undefined {
  const { signal, parent, expected, ancestors, commitGuard } = options;
  signal?.throwIfAborted();
  if (parent === undefined && expected === undefined && ancestors === undefined && commitGuard === undefined) return undefined;
  if (parent === undefined || expected === undefined || ancestors === undefined) {
    throw new FsError("EINVAL", { syscall: "chmod", path, message: "complete conditional chmod receipt is required" });
  }
  if (commitGuard !== undefined && typeof commitGuard !== "function") throw new FsError("EINVAL", { syscall: "chmod", path });
  const entries = snapshotDirectoryAncestry(ancestors);
  if (entries.at(-1)?.path !== dirname(path)) throw new FsError("EINVAL", { syscall: "chmod", path });
  return { ...(signal === undefined ? {} : { signal }), parent: { ...parent }, expected: { ...expected }, ancestors: entries,
    ...(commitGuard === undefined ? {} : { commitGuard }) };
}
