import { basename, dirname, joinPath, FsError, type CommandContext } from "safe-bash-contracts";
import { codeOf } from "safe-bash-io-engine/internal";
import { admitFilesystemModes } from "safe-bash-io-engine/commands/filesystem-requirements";
import type { DirectoryReader } from "safe-bash-io-engine/commands/directory-admission";
import type { CopyBackup } from "safe-bash-io-engine/commands/copy-backup";

export async function backupCopyTarget(
  context: CommandContext, source: string, target: string, backup: CopyBackup,
  readDirectory: DirectoryReader, preflight: boolean,
): Promise<void> {
  let highest = 0n;
  if (backup.mode !== "simple") {
    const prefix = `${basename(target)}.~`;
    for (const entry of await readDirectory(context, dirname(target))) {
      if (!entry.name.startsWith(prefix) || !entry.name.endsWith("~")) continue;
      const digits = entry.name.slice(prefix.length, -1);
      if (!digits || digits[0] === "0" || [...digits].some(character => character < "0" || character > "9")) continue;
      const number = BigInt(digits);
      if (number > highest) highest = number;
    }
  }
  const backupPath = backup.mode === "numbered" || highest > 0n ? `${target}.~${highest + 1n}~` : target + backup.suffix;
  // A suffix can name the source itself; reject this before moving any entry.
  const sourceEntry = joinPath(await context.fs.realpath(dirname(source), { signal: context.signal }), basename(source));
  const backupEntry = joinPath(await context.fs.realpath(dirname(backupPath), { signal: context.signal }), basename(backupPath));
  if (sourceEntry === backupEntry) throw new FsError("EINVAL", { path: backupPath, message: "backup would destroy source" });
  let existing, referent;
  try { existing = await context.fs.realpath(backupPath, { signal: context.signal }); }
  catch (error) { context.signal.throwIfAborted(); if (codeOf(error) !== "ENOENT") throw error; }
  try { referent = await context.fs.realpath(source, { signal: context.signal }); }
  catch (error) {
    context.signal.throwIfAborted();
    if (codeOf(error) !== "ENOENT" || (await context.fs.lstat(source, { signal: context.signal })).type !== "symlink") throw error;
  }
  if (existing !== undefined && existing === referent) {
    throw new FsError("EINVAL", { path: backupPath, message: "backup would destroy source" });
  }
  await admitFilesystemModes(context, "cp", ["backup"], [target, backupPath]);
  if (!preflight) await context.fs.rename(target, backupPath, { signal: context.signal });
}
