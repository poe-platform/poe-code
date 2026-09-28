import type { CommandDefinition, CommandHandler } from "safe-bash-contracts";
import { tryGetMemoryDirectoryEntryNamesSync } from "@poe-code/safe-fs/core";
import { basename, dirname, FsError, type CommandContext, type FileStat, type FileSystem } from "safe-bash-contracts";
import { codeOf, define, eachOperand, options, pathOf, requireOperands, UsageError, value } from "safe-bash-command-io-engine/internal";
import { admitFilesystemModes } from "safe-bash-command-io-engine/commands/filesystem-requirements";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { touchTimes } from "safe-bash-command-io-engine/commands/touch-times";
import { touchTarget } from "safe-bash-command-io-engine/commands/touch-target";
import { getRuntimeBackingFileSystem } from "safe-bash-contracts/runtime-control";
const TOUCH_LONG_OPTIONS = Object.freeze({ "no-create": "c", "no-dereference": "h", reference: "r", date: "d", time: "time:" } as const);
async function preflightOperands(
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
async function maybeStat(context: CommandContext, path: string, follow = true, allowNonDirectory = false): Promise<FileStat | undefined> {
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
function needCapability(context: CommandContext, capability: "symlink" | "link" | "readlink" | "utimes"): void {
  const declaration = { symlink: "symlinks", link: "hardlinks", readlink: "readlink", utimes: "timestamps" }[capability];
  if (!context.fs.capabilitiesFor && context.fs.capabilities[declaration] === false) throw new FsError("ENOTSUP", { syscall: capability });
  if (!context.fs[capability]) throw new FsError("ENOTSUP", { syscall: capability });
}
import type { VirtualShellPlugin } from "safe-bash-contracts";
export interface TouchLimits { readonly maxArgumentBytes: number; }
export interface TouchCommandsOptions { readonly replace?: boolean; readonly limits?: Partial<TouchLimits>; }
export function createTouchCommand(configuration: TouchCommandsOptions = {}): CommandDefinition {
 const max = configuration.limits?.maxArgumentBytes ?? Infinity; if (max !== Infinity && (!Number.isSafeInteger(max) || max < 1)) throw new RangeError("maxArgumentBytes must be positive");
 const definition = define("touch", async context => {
  if (max !== Infinity) { let bytes = 0; for (const value of getCommandArguments(context).values) { bytes += shellValueByteLength(value); if (bytes > max) throw new FsError("EFBIG", { message: "argument byte limit exceeded" }); } }
      const parsed = options(context.args, "cafhmr:d:t:", TOUCH_LONG_OPTIONS);
      const selection = value(parsed, "time");
      if (selection !== undefined) {
        if (["atime", "access", "use"].includes(selection)) parsed.flags.add("a");
        else if (["mtime", "modify"].includes(selection)) parsed.flags.add("m");
        else throw new UsageError(`invalid argument '${selection}' for '--time'`);
      }
      requireOperands(parsed.operands);
      const follow = !parsed.flags.has("h");
      const inspectTarget = async (path: string) => {
        const stat = await maybeStat(context, path, follow);
        if (!follow && stat?.type === "symlink") {
          throw new FsError("ENOTSUP", { syscall: "touch", path, message: "symlink timestamps are unavailable" });
        }
        return stat;
      };
      const reference = value(parsed, "r");
      const date = value(parsed, "d"), timestamp = value(parsed, "t");
      if (timestamp !== undefined && (date !== undefined || reference !== undefined)) {
        throw new PublicDiagnostic("cannot specify times from more than one source");
      }
      const now = Date.now();
      const explicit = reference !== undefined || date !== undefined || timestamp !== undefined;
      const base = reference === undefined ? { atimeMs: now, mtimeMs: now }
        : await context.fs[follow ? "stat" : "lstat"](pathOf(context, reference), { signal: context.signal });
      const times = date === undefined && timestamp === undefined ? base
        : touchTimes(date, timestamp, context.env.TZ ?? "UTC", base);
      await preflightOperands(context, parsed.operands, async operand => {
        const path = pathOf(context, operand);
        const existing = await inspectTarget(path);
        const modes = existing ? ["existing"] : parsed.flags.has("c") ? ["no-create"]
          : explicit ? ["create", "existing"] : ["create"];
        const target = !existing && follow && !parsed.flags.has("c") ? await touchTarget(context, path) : path;
        await admitFilesystemModes(context, "touch", modes, [target]);
      });
      return eachOperand(context, parsed.operands, async operand => {
        let path = pathOf(context, operand);
        let existing = await inspectTarget(path);
        if (!existing) {
          if (parsed.flags.has("c")) return;
          if (follow) path = await touchTarget(context, path);
          await admitFilesystemModes(context, "touch", explicit ? ["create", "existing"] : ["create"], [path]);
          if (explicit) needCapability(context, "utimes");
          await context.fs.writeFile(path, new Uint8Array(), { flag: "wx", signal: context.signal });
          if (!explicit) return;
          existing = await context.fs.stat(path, { signal: context.signal });
        }
        needCapability(context, "utimes");
        await admitFilesystemModes(context, "touch", ["existing"], [path]);
        const accessOnly = parsed.flags.has("a") && !parsed.flags.has("m");
        const modifyOnly = parsed.flags.has("m") && !parsed.flags.has("a");
        await context.fs.utimes!(path, modifyOnly ? existing.atimeMs : times.atimeMs,
          accessOnly ? existing.mtimeMs : times.mtimeMs, { signal: context.signal });
      });
    });
 return definition;
}
export function createTouchCommands(options: TouchCommandsOptions = {}): readonly CommandDefinition[] { return [createTouchCommand(options)]; }
export function touchCommands(options: TouchCommandsOptions = {}): VirtualShellPlugin { const commands = createTouchCommands(options); return { name: "touch-commands", setup(host) { if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`); for (const command of commands) host.commands.register(command, {replace: options.replace ?? false}); } }; }

import { getCommandArguments } from "safe-bash-contracts";
import { shellValueByteLength } from "safe-bash-contracts/value";
