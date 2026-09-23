import { basename, dirname, FsError, type CommandContext } from "../contracts/index.js";
import { codeOf, options, UsageError, value } from "./internal.js";
import { admitFilesystemModes } from "./filesystem-requirements.js";
import { type DirectoryReader } from "./directory-admission.js";

export interface CopyBackup {
  readonly mode: "simple" | "numbered" | "existing";
  readonly suffix: string;
}

export function copyOptions(context: CommandContext) {
  // GNU's optional long backup argument only consumes an attached value.
  const args: string[] = [];
  let ended = false;
  for (let index = 0; index < context.args.length; index++) {
    const argument = context.args[index]!;
    args.push(!ended && argument === "--backup" ? `--backup=${context.env.VERSION_CONTROL ?? "existing"}` : argument);
    if (argument === "--") ended = true;
    const suffixOffset = argument.startsWith("-") && !argument.startsWith("--") ? argument.indexOf("S", 1) : -1;
    if (!ended && (argument === "--suffix" || suffixOffset > 0 && suffixOffset === argument.length - 1)) {
      if (context.args[index + 1] !== undefined) args.push(context.args[++index]!);
    }
  }
  const parsed = options(args, "rRfnvPLbB:S:", {
    recursive: "R", force: "f", "no-clobber": "n", verbose: "v", dereference: "L", "no-dereference": "P",
    backup: "B", suffix: "S",
  });
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
  return { ...parsed, backup };
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
  let existing;
  try { existing = await context.fs.realpath(backupPath, { signal: context.signal }); }
  catch (error) { context.signal.throwIfAborted(); if (codeOf(error) !== "ENOENT") throw error; }
  if (existing === await context.fs.realpath(source, { signal: context.signal })) {
    throw new FsError("EINVAL", { path: backupPath, message: "backup would destroy source" });
  }
  await admitFilesystemModes(context, "cp", ["backup"], [target, backupPath]);
  if (!preflight) await context.fs.rename(target, backupPath, { signal: context.signal });
}
