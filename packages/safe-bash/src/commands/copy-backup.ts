import { basename, dirname, joinPath, FsError, type CommandContext, type FileStat } from "../contracts/index.js";
import { codeOf, options, UsageError, value } from "./internal.js";
import { admitFilesystemModes } from "./filesystem-requirements.js";
import { type DirectoryReader } from "./directory-admission.js";
import type { CopyAttribute } from "./copy-preserve.js";

export interface CopyBackup {
  readonly mode: "simple" | "numbered" | "existing";
  readonly suffix: string;
}

export function copyOptions(context: CommandContext) {
  // GNU's optional long backup argument only consumes an attached value.
  const args: string[] = [];
  const preserve = new Set<CopyAttribute>();
  let ended = false;
  for (let index = 0; index < context.args.length; index++) {
    const argument = context.args[index]!;
    if (!ended && argument.startsWith("--preserve=")) {
      for (const attribute of argument.slice("--preserve=".length).split(",")) {
        if (attribute === "mode" || attribute === "ownership" || attribute === "timestamps" || attribute === "links") {
          preserve.add(attribute);
        } else if (attribute === "all" || attribute === "context" || attribute === "xattr") {
          throw new FsError("ENOTSUP", { syscall: "cp", message: `preserving ${attribute} is unavailable` });
        } else throw new UsageError(`invalid argument '${attribute}' for 'preserve'`);
      }
    } else args.push(!ended && argument === "--backup" ? `--backup=${context.env.VERSION_CONTROL ?? "existing"}` : argument);
    if (argument === "--") ended = true;
    const valueOffset = argument.startsWith("-") && !argument.startsWith("--")
      ? [...argument].findIndex((character, offset) => offset > 0 && (character === "S" || character === "t" || character === "B")) : -1;
    if (!ended && (argument === "--suffix" || argument === "--target-directory" || valueOffset > 0 && valueOffset === argument.length - 1)) {
      if (context.args[index + 1] !== undefined) args.push(context.args[++index]!);
    }
  }
  const parsed = options(args, "arRfnvPHLpdbB:S:t:T", {
    archive: "a", preserve: "p", "attributes-only": false,
    recursive: "R", force: "f", "no-clobber": "n", verbose: "v", dereference: "L", "no-dereference": "P",
    backup: "B", suffix: "S", "target-directory": "t", "no-target-directory": "T", "remove-destination": false,
  });
  if (parsed.flags.has("a")) {
    parsed.flags.add("R");
    parsed.flags.add("P");
  }
  if (parsed.flags.has("p")) for (const attribute of ["mode", "ownership", "timestamps"] as const) preserve.add(attribute);
  if (parsed.flags.has("d")) { parsed.flags.add("P"); preserve.add("links"); }
  if (parsed.flags.has("P") && parsed.flags.has("L")) throw new UsageError("-P and -L cannot be combined");
  let backup: CopyBackup | undefined;
  if (parsed.flags.has("b") || parsed.flags.has("B")) {
    const control = value(parsed, "B") ?? context.env.VERSION_CONTROL ?? "existing";
    const modes: Record<string, CopyBackup["mode"] | "none"> = {
      none: "none", off: "none", numbered: "numbered", t: "numbered",
      existing: "existing", nil: "existing", simple: "simple", never: "simple",
    };
    const mode = Object.hasOwn(modes, control) ? modes[control] : undefined;
    if (!mode) throw new UsageError(`invalid argument '${control}' for 'backup type'`);
    if (mode !== "none") backup = { mode, suffix: value(parsed, "S") ?? context.env.SIMPLE_BACKUP_SUFFIX ?? "~" };
  }
  if (backup && parsed.flags.has("n")) throw new UsageError("options --backup and --no-clobber are mutually exclusive");
  if (backup && (!backup.suffix || backup.suffix.includes("/"))) throw new UsageError("invalid backup suffix");
  const copiedLinks = new Map<object | symbol, Map<string, { path: string; stat?: FileStat }>>();
  const sourceMetadata = new Map<string, FileStat>();
  const copiedTargets = new Map<string, FileStat>();
  return { ...parsed, backup, preserve, copiedLinks, sourceMetadata, copiedTargets };
}

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
      if (!digits || [...digits].some(character => character < "0" || character > "9")) continue;
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
