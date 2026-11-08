import { tryGetMemoryDirectoryEntryNamesSync } from "@poe-code/safe-fs/runtime-core";
import { basename, dirname, FsError, type CommandContext, type FileStat, type FileSystem } from "safe-bash-contracts";
import { getRuntimeBackingFileSystem } from "safe-bash-contracts/runtime-control";
import { codeOf, pathOf, requireOperands, UsageError } from "../internal.js";
export async function preflightOperands(
  context: CommandContext, operands: readonly string[], check: (operand: string) => Promise<void>,
): Promise<void> {
  // One operand can contain a whole tree; checks may also snapshot metadata before reads change it.
  for (const operand of operands) {
    try { await check(operand); }
    catch (error) {
      context.signal.throwIfAborted();
      if (codeOf(error) === "ENOTSUP" || codeOf(error) === "EROFS"
        || codeOf(error) === "ENOTEMPTY" && error instanceof FsError && codeOf(error.cause) === "ENOTSUP") throw error;
    }
  }
}

export async function maybeStat(context: CommandContext, path: string, follow = true, allowNonDirectory = false): Promise<FileStat | undefined> {
  if (!allowNonDirectory && path !== "/" && path !== "/dev" && !path.startsWith("/dev/")) {
    const backing = getRuntimeBackingFileSystem(context.fs) as (FileSystem & { symlinkCount?: number }) | undefined;
    if (backing && backing.symlinkCount === 0) {
      const parentEntries = tryGetMemoryDirectoryEntryNamesSync(backing, dirname(path));
      if (parentEntries !== undefined && !parentEntries.has(basename(path))) {
        context.fs.canonicalizeMissingTarget?.(path, { signal: context.signal });
        return undefined;
      }
    }
  }
  try { return await context.fs[follow ? "stat" : "lstat"](path, { signal: context.signal }); }
  catch (error) {
    context.signal.throwIfAborted();
    const code = codeOf(error);
    if (
      code === "ENOENT"
      || (allowNonDirectory && code === "ENOTDIR")
      || (follow && (code === "ENOTDIR" || code === "ELOOP") && await context.fs.lstat(path, { signal: context.signal }).then(stat => stat.type === "symlink", () => false))
    ) {
      return undefined;
    }
    throw error;
  }
}

export function needCapability(context: CommandContext, capability: "symlink" | "link" | "readlink" | "utimes"): void {
  const declaration = { symlink: "symlinks", link: "hardlinks", readlink: "readlink", utimes: "timestamps" }[capability];
  if (!context.fs.capabilitiesFor && context.fs.capabilities[declaration] === false) throw new FsError("ENOTSUP", { syscall: capability });
  if (!context.fs[capability]) throw new FsError("ENOTSUP", { syscall: capability });
}

export async function destinations(context: CommandContext, operands: readonly string[], targetDirectory?: string, noTargetDirectory = false) {
  if (targetDirectory !== undefined && noTargetDirectory) throw new UsageError("cannot combine --target-directory and --no-target-directory");
  requireOperands(operands, targetDirectory === undefined ? 2 : 1, noTargetDirectory ? 2 : Infinity);
  const targetOperand = targetDirectory ?? operands.at(-1)!;
  const target = pathOf(context, targetOperand);
  let stat: FileStat | undefined;
  try { stat = await maybeStat(context, target); }
  catch (error) {
    context.signal.throwIfAborted();
    if (codeOf(error) !== "ELOOP" && codeOf(error) !== "ENOTDIR") throw error;
    stat = await context.fs.lstat(target, { signal: context.signal });
    if (stat.type !== "symlink") throw error;
  }
  if (targetDirectory !== undefined && stat?.type !== "directory") throw new FsError(stat ? "ENOTDIR" : "ENOENT", { path: target });
  const directory = !noTargetDirectory && stat?.type === "directory";
  if (operands.length > 2 && !directory) throw new FsError("ENOTDIR", { path: target });
  return { target, targetOperand, directory, sources: targetDirectory === undefined ? operands.slice(0, -1) : operands };
}

export function childOperand(operand: string, name: string): string {
  while (operand.endsWith("/")) operand = operand.slice(0, -1);
  return `${operand}/${name}`;
}
