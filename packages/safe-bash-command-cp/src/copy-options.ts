import { FsError, type CommandContext, type FileStat } from "safe-bash-contracts";
import { options, UsageError, value } from "safe-bash-io-engine/internal";
import { matchBackupMode, normalizeBackupSuffix, type CopyBackup } from "safe-bash-io-engine/commands/copy-backup";
import type { CopyAttribute } from "./copy-preserve.js";
export function copyOptions(context: CommandContext) {
  // Optional long arguments only consume attached values.
  const args: string[] = [];
  const preserve = new Set<CopyAttribute>();
  let ended = false;
  let overwrite: "i" | "n" | undefined;
  let dereference: "H" | "L" | "P" | undefined;
  let update = "all";
  for (let index = 0; index < context.args.length; index++) {
    const argument = context.args[index]!;
    args.push(!ended && argument === "--backup" ? `--backup=${context.env.VERSION_CONTROL ?? "existing"}`
      : !ended && argument.startsWith("--u") && "--update".startsWith(argument) ? "--update=older"
      : !ended && argument.startsWith("--pr") && "--preserve".startsWith(argument) ? "--preserve=mode,ownership,timestamps" : argument);
    if (argument === "--") ended = true;
    const valueOffset = argument.startsWith("-") && !argument.startsWith("--")
      ? [...argument].findIndex((character, offset) => offset > 0 && (character === "S" || character === "t")) : -1;
    if (!ended) {
      if (argument === "--interactive") overwrite = "i";
      else if (argument === "--no-clobber") overwrite = "n";
      else if (argument.startsWith("-") && !argument.startsWith("--")) {
        for (const flag of argument.slice(1, valueOffset > 0 ? valueOffset : undefined)) {
          if (flag === "i" || flag === "n") overwrite = flag;
        }
      }
    }
    if (!ended && (argument === "--suffix" || argument === "--target-directory" || argument === "--no-preserve" || valueOffset > 0 && valueOffset === argument.length - 1)) {
      if (context.args[index + 1] !== undefined) args.push(context.args[++index]!);
    }
  }
  const parsed = options(args, "arRfinuvPHLpdbS:t:Tlsx", {
    archive: "a", preserve: "preserve:", "no-preserve": "no-preserve:", "attributes-only": false, parents: false, link: "l", "symbolic-link": "s",
    recursive: "R", "one-file-system": "x", force: "f", interactive: "i", "no-clobber": "n", update: "update:", verbose: "v", dereference: "L", "no-dereference": "P",
    backup: "backup:", suffix: "S", "target-directory": "t", "no-target-directory": "T", "remove-destination": false,
  }, false, undefined, undefined, (flag, argument) => {
    if (flag === "a" || flag === "d") dereference = "P";
    else if (flag === "H" || flag === "L" || flag === "P") dereference = flag;
    if (flag === "u") update = "older";
    else if (flag === "update") {
      if (argument !== "none" && argument !== "older" && argument !== "all") {
        throw new UsageError(`invalid argument '${argument}' for 'update'`);
      }
      update = argument;
    }
    if (flag === "a" || flag === "p") {
      for (const attribute of ["mode", "ownership", "timestamps"] as const) preserve.add(attribute);
    }
    if (flag === "a" || flag === "d") preserve.add("links");
    if (flag === "preserve" || flag === "no-preserve") {
      for (const attribute of argument!.split(",")) {
        if (attribute === "mode" || attribute === "ownership" || attribute === "timestamps" || attribute === "links") {
          if (flag === "preserve") preserve.add(attribute);
          else preserve.delete(attribute);
        } else if (attribute === "all" || attribute === "context" || attribute === "xattr") {
          if (flag === "preserve") throw new FsError("ENOTSUP", { syscall: "cp", message: `preserving ${attribute} is unavailable` });
          if (attribute === "all") preserve.clear();
        } else throw new UsageError(`invalid argument '${attribute}' for '${flag}'`);
      }
    }
  });
  if (overwrite) parsed.flags.delete(overwrite === "i" ? "n" : "i");
  if (parsed.flags.has("l") && parsed.flags.has("s")) throw new UsageError("cannot make both hard and symbolic links");
  if (parsed.flags.has("a")) {
    parsed.flags.add("R");
    parsed.flags.add("p");
  }
  for (const flag of ["H", "L", "P"]) parsed.flags.delete(flag);
  parsed.flags.add(dereference ?? (parsed.flags.has("R") || parsed.flags.has("r") ? "P" : "H"));
  let backup: CopyBackup | undefined;
  if (parsed.flags.has("b") || parsed.flags.has("backup") || parsed.flags.has("S")) {
    const control = value(parsed, "backup") ?? context.env.VERSION_CONTROL ?? "existing";
    const mode = matchBackupMode(control);
    if (mode !== "none") backup = { mode, suffix: normalizeBackupSuffix(value(parsed, "S") ?? context.env.SIMPLE_BACKUP_SUFFIX) };
  }
  if (backup && parsed.flags.has("n")) throw new UsageError("options --backup and --no-clobber are mutually exclusive");
  const copiedLinks = new Map<object | symbol, Map<string, { path: string; stat?: FileStat }>>();
  const sourceMetadata = new Map<string, FileStat>();
  const copiedTargets = new Map<string, FileStat>();
  return { ...parsed, backup, preserve, update, copiedLinks, sourceMetadata, copiedTargets };
}
