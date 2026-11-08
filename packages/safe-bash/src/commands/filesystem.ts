import { createCpCommand } from "./cp/index.js";
import { preflightOperands, maybeStat, needCapability, destinations, childOperand } from "safe-bash-io-engine/commands/filesystem-operands";
import { createTouchCommand } from "./touch/index.js";
import { createReadlinkCommand } from "./readlink/index.js";
import { createRealpathCommand } from "./realpath/index.js";
import { bindConditionalMutation } from "@poe-code/safe-fs/runtime-core";
import {
  basename, dirname, FsError, joinPath, normalizePath, relativePath,
  readBytes, writeBytes, type CommandContext, type CommandDefinition, type CommandHandler, type FileStat, type FileSystem,
} from "../contracts/index.js";
import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { codeOf, define, diagnostic, eachOperand, lines, options, output, pathOf, requireOperands, RESOLVED_EXIT_ZERO, UsageError, value } from "./internal.js";

const MKDIR_PARENTS_MODES = ["parents"] as const;
const MKDIR_DIR_MODES = ["directory"] as const;
const RM_RECURSIVE_MODES = ["recursive"] as const;
const RM_FILE_MODES = ["file"] as const;
import { escapeText, quoteShellOperand } from "../escaping.js";
import { compareCopyIdentity, compareObservedEntries } from "./copy-identity.js";
import { MoveBudget, moveAcrossDevices } from "./move.js";
import { admitFilesystemModes, filesystemCommandRequirements } from "./filesystem-requirements.js";
import { createDirectoryReader, type DirectoryReader } from "./directory-admission.js";
import { yieldTurn } from "../contracts/yield.js";
import { PublicDiagnostic } from "../diagnostics.js";
import { canonicalizeReadlinkMissing } from "./readlink-missing.js";
import { modeChange } from "./metadata/chmod.js";
import { creationUmask, getRuntimeBackingFileSystem } from "../fs/creation-mask.js";
import { matchBackupMode, normalizeBackupSuffix } from "safe-bash-io-engine/commands/copy-backup";

// Operand directories start at depth zero; files inside the last admitted
// directory do not consume another directory-recursion level.
const MKDIR_LONG_OPTIONS = Object.freeze({ parents: "p", mode: "m", verbose: "v" } as const);
const MV_LONG_OPTIONS = Object.freeze({
  force: "f", interactive: "i", "no-clobber": "n", update: "u", verbose: "v", backup: "backup:", suffix: "S",
  "no-target-directory": "T", "target-directory": "t",
} as const);
const RM_LONG_OPTIONS = Object.freeze({ recursive: "r", force: "f", dir: "d", verbose: "v" } as const);
const RMDIR_LONG_OPTIONS = Object.freeze({ parents: "p", verbose: "v", "ignore-fail-on-non-empty": false } as const);

async function admitNoReplaceRename(context: CommandContext, target: string): Promise<void> {
  let candidate = target;
  while (true) {
    try {
      const capabilities = await context.fs.capabilitiesFor?.(candidate, { signal: context.signal }) ?? context.fs.capabilities;
      context.signal.throwIfAborted();
      if (capabilities.atomicRenameNoReplace !== true) {
        throw new FsError("ENOTSUP", { syscall: "mv", path: target, message: "atomic no-replace rename is unavailable" });
      }
      return;
    } catch (error) {
      context.signal.throwIfAborted();
      if (codeOf(error) !== "ENOENT" || candidate === "/") throw error;
      candidate = dirname(candidate);
    }
  }
}

async function admitEmptyDirectory(context: CommandContext, path: string, readDirectory: DirectoryReader): Promise<void> {
  const stat = await maybeStat(context, path, false);
  if (stat && stat.type !== "directory") throw new FsError("ENOTDIR", { syscall: "rmdir", path });
  try { await admitFilesystemModes(context, "rmdir", ["directory"], [path]); }
  catch (error) {
    context.signal.throwIfAborted();
    if (codeOf(error) === "ENOTSUP") {
      const capabilities = await context.fs.capabilitiesFor?.(path, { signal: context.signal }) ?? context.fs.capabilities;
      if (capabilities.write !== false && capabilities.readdir !== false
        && (await readDirectory(context, path)).length) {
        throw new FsError("ENOTEMPTY", { syscall: "rmdir", path, cause: error });
      }
    }
    throw error;
  }
}

async function removeEmptyDirectory(context: CommandContext, path: string, readDirectory: DirectoryReader): Promise<void> {
  await admitEmptyDirectory(context, path, readDirectory);
  context.signal.throwIfAborted();
  if (!context.fs.rmdir) throw new FsError("ENOTSUP", { syscall: "rmdir", path });
  await context.fs.rmdir(path, { signal: context.signal });
}

function modeText(stat: FileStat): string {
  let text = stat.type === "directory" ? "d" : stat.type === "symlink" ? "l" : stat.type === "character" ? "c" : "-";
  for (const shift of [6, 3, 0]) {
    const mode = stat.mode >> shift;
    text += (mode & 4 ? "r" : "-") + (mode & 2 ? "w" : "-") + (mode & 1 ? "x" : "-");
  }
  if (stat.mode & 0o4000) text = text.slice(0, 3) + (stat.mode & 0o100 ? "s" : "S") + text.slice(4);
  if (stat.mode & 0o2000) text = text.slice(0, 6) + (stat.mode & 0o010 ? "s" : "S") + text.slice(7);
  if (stat.mode & 0o1000) text = text.slice(0, 9) + (stat.mode & 0o001 ? "t" : "T");
  return text;
}

export const defaultMkdirExecutors = new WeakSet<CommandHandler>();
export const defaultRmExecutors = new WeakSet<CommandHandler>();

export function filesystemCommands(maxDirectoryEntries?: number, maxRecursiveDirectoryDepth = Infinity): CommandDefinition[] {
  if (maxRecursiveDirectoryDepth !== Infinity && (!Number.isSafeInteger(maxRecursiveDirectoryDepth) || maxRecursiveDirectoryDepth < 0)) {
    throw new RangeError("maxRecursiveDirectoryDepth must be a nonnegative safe integer or Infinity");
  }
  const readDirectory = createDirectoryReader(maxDirectoryEntries);
  const commands = [
    define("mkdir", context => {
      if (!context.argumentValues && !context.signal.aborted && context.args.length >= 1) {
        const fastCtx = context as { _fastMemoryBackingFs?: FileSystem & { symlinkCount?: number; tryMkdirFastSync?: (path: string, recursive: boolean, mode: number | undefined) => boolean }; _fastUmask?: number; _chargeFastFsOp?: () => void; _hasInfiniteFsOpsLimit?: boolean };
        const backingMem = fastCtx._fastMemoryBackingFs;
        const umask = (fastCtx as { _state?: { umask?: number } })._state?.umask ?? 0o022;
        if (
          fastCtx._hasInfiniteFsOpsLimit === true &&
          backingMem !== undefined &&
          typeof backingMem.tryMkdirFastSync === "function" &&
          backingMem.capabilitiesFor === undefined &&
          backingMem.symlinkCount === 0 &&
          !backingMem.capabilities.readOnly &&
          backingMem.capabilities.implicitDirectories !== true &&
          (umask & 0o300) === 0 &&
          Object.getPrototypeOf(backingMem)?.constructor?.name === "MemoryFileSystem" &&
          !Object.prototype.hasOwnProperty.call(backingMem, "mkdir") &&
          !Object.prototype.hasOwnProperty.call(backingMem, "lstat") &&
          !Object.prototype.hasOwnProperty.call(backingMem, "stat")
        ) {
          const rawArgs = context.args;
          let recursive = false;
          let ended = false;
          let operandCount = 0;
          let fastOk = true;
          for (let i = 0; i < rawArgs.length; i++) {
            const a = rawArgs[i]!;
            if (!ended) {
              if (a === "--") { ended = true; continue; }
              if (a === "-p" || a === "--parents") { recursive = true; continue; }
              if (a.length > 1 && a.charCodeAt(0) === 45) { fastOk = false; break; }
            }
            if (!a) { fastOk = false; break; }
            const p = pathOf(context, a);
            if (p === "/dev" || p.startsWith("/dev/") || p.length > 512) { fastOk = false; break; }
            operandCount++;
          }
          if (fastOk && operandCount === 1) {
            let admitted = false;
            try {
              assertCommandRequirements(context, filesystemCommandRequirements.mkdir, recursive ? MKDIR_PARENTS_MODES : MKDIR_DIR_MODES, backingMem.capabilities);
              admitted = true;
            } catch {
              admitted = false;
            }
            if (admitted) {
              const effectiveMode = backingMem.capabilities.permissions !== false ? 0o777 & ~umask : undefined;
              let allCreated = true;
              ended = false;
              for (let i = 0; i < rawArgs.length; i++) {
                const a = rawArgs[i]!;
                if (!ended) {
                  if (a === "--") { ended = true; continue; }
                  if (a === "-p" || a === "--parents") continue;
                }
                if (!backingMem.tryMkdirFastSync(pathOf(context, a), recursive, effectiveMode)) {
                  allCreated = false;
                  break;
                }
              }
              if (allCreated) {
                for (let c = 0; c < operandCount; c++) fastCtx._chargeFastFsOp!();
                return RESOLVED_EXIT_ZERO;
              }
            }
          }
        }
      }
      return (async () => {
      const parsed = options(context.args, "pm:v", MKDIR_LONG_OPTIONS);
      requireOperands(parsed.operands);
      const mode = value(parsed, "m");
      const mask: unknown = Reflect.get(context.fs, creationUmask);
      const umask = typeof mask === "number" ? mask : 0o022;
      const directoryMode = mode === undefined ? undefined : modeChange(mode, umask)({ type: "directory", mode: 0o777 & ~umask });
      if (
        parsed.operands.length >= 1 &&
        !parsed.flags.has("v") &&
        directoryMode === undefined &&
        (umask & 0o300) === 0
      ) {
        const backingMem = getRuntimeBackingFileSystem(context.fs) as { symlinkCount?: number; capabilitiesFor?: unknown } | undefined;
        const caps = context.fs.capabilities;
        if (
          backingMem !== undefined &&
          backingMem.capabilitiesFor === undefined &&
          backingMem.symlinkCount === 0 &&
          !caps.readOnly &&
          caps.implicitDirectories !== true &&
          Object.getPrototypeOf(backingMem)?.constructor?.name === "MemoryFileSystem" &&
          !Object.prototype.hasOwnProperty.call(backingMem, "mkdir") &&
          !Object.prototype.hasOwnProperty.call(backingMem, "lstat") &&
          !Object.prototype.hasOwnProperty.call(backingMem, "stat")
        ) {
          let allSafe = true;
          for (let i = 0; i < parsed.operands.length; i++) {
            const p = pathOf(context, parsed.operands[i]!);
            if (p === "/dev" || p.startsWith("/dev/")) {
              allSafe = false;
              break;
            }
          }
          if (allSafe) {
            const recursive = parsed.flags.has("p");
            const effectiveMode = caps.permissions !== false ? 0o777 & ~umask : undefined;
            let exitCode = 0;
            try {
              for (let i = 0; i < parsed.operands.length; i++) {
                await admitFilesystemModes(context, "mkdir", [recursive ? "parents" : "directory"], [pathOf(context, parsed.operands[i]!)]);
              }
            } catch (error) {
              await diagnostic(context, error);
              return { exitCode: 1 };
            }
            for (let i = 0; i < parsed.operands.length; i++) {
              try {
                await context.fs.mkdir(pathOf(context, parsed.operands[i]!), { recursive, ...(effectiveMode === undefined ? {} : { mode: effectiveMode }), signal: context.signal });
              } catch (error) {
                exitCode = 1;
                await diagnostic(context, error);
              }
            }
            return { exitCode };
          }
        }
      }
      const createDirectory = async (operand: string, preflight: boolean): Promise<void> => {
        const path = pathOf(context, operand);
        const recursive = parsed.flags.has("p");
        const stat = await maybeStat(context, path, recursive);
        if (stat) {
          if (!recursive || stat.type !== "directory") throw new FsError("EEXIST", { syscall: "mkdir", path });
          const capabilities = await context.fs.capabilitiesFor?.(path, { signal: context.signal }) ?? context.fs.capabilities;
          context.signal.throwIfAborted();
          if (capabilities.implicitDirectories !== true) return;
        }
        await admitFilesystemModes(context, "mkdir", [recursive ? "parents" : "directory"], [path]);
        if (!preflight) {
          const created: string[] = [];
          if (!stat && parsed.flags.has("v")) {
            if (recursive) {
              const seen = new Set<string>();
              for (let index = 1; index < operand.length; index++) {
                if (operand[index] !== "/" || operand[index - 1] === "/") continue;
                const parent = operand.slice(0, index);
                const parentPath = normalizePath(pathOf(context, parent));
                if (parentPath === normalizePath(path) || seen.has(parentPath)) continue;
                seen.add(parentPath);
                if (!await maybeStat(context, parentPath)) created.push(parent);
              }
            }
            created.push(operand);
          }
          if (recursive && !stat && (directoryMode !== undefined || (umask & 0o300) !== 0)) {
            await context.fs.mkdir(dirname(path), { recursive: true, mode: (0o777 & ~umask) | 0o300, signal: context.signal });
          }
          const effectiveMode = stat
            ? undefined
            : directoryMode !== undefined
              ? directoryMode
              : !context.fs.capabilitiesFor && context.fs.capabilities.permissions !== false
                ? 0o777 & ~umask
                : undefined;
          await context.fs.mkdir(path, { recursive, ...(effectiveMode === undefined ? {} : { mode: effectiveMode }), signal: context.signal });
          for (const directory of created) await output(context, `mkdir: created directory '${escapeText(directory, "display")}'\n`);
        }
      };
      await preflightOperands(context, parsed.operands, operand => createDirectory(operand, true));
      return eachOperand(context, parsed.operands, operand => createDirectory(operand, false));
      })();
    }),
    createTouchCommand(),
    createCpCommand({ limits: { ...(maxDirectoryEntries === undefined ? {} : { maxDirectoryEntries }), maxRecursiveDirectoryDepth } }),
    define("mv", async context => {
      let ended = false;
      let optionValue = false;
      let overwrite: "f" | "i" | "n" | undefined;
      const args = context.args.map(argument => {
        if (optionValue) { optionValue = false; return argument; }
        if (argument === "--") ended = true;
        if (ended) return argument;
        if (argument === "--force") overwrite = "f";
        else if (argument === "--interactive") overwrite = "i";
        else if (argument === "--no-clobber") overwrite = "n";
        else if (argument.startsWith("-") && !argument.startsWith("--")) {
          for (let offset = 1; offset < argument.length; offset++) {
            const flag = argument[offset];
            if (flag === "S" || flag === "t") {
              optionValue = offset === argument.length - 1;
              break;
            }
            if (flag === "f" || flag === "i" || flag === "n") overwrite = flag;
          }
        }
        if (argument === "--suffix" || argument === "--target-directory") optionValue = true;
        return argument === "--backup" ? `--backup=${context.env.VERSION_CONTROL || "existing"}` : argument;
      });
      const parsed = options(args, "finuvbS:Tt:", MV_LONG_OPTIONS);
      for (const flag of ["f", "i", "n"]) if (flag !== overwrite) parsed.flags.delete(flag);
      const control = value(parsed, "backup") ?? (parsed.flags.has("b") || parsed.flags.has("S") ? context.env.VERSION_CONTROL || "existing" : "none");
      const backupMode = matchBackupMode(control);
      if (backupMode !== "none" && parsed.flags.has("n")) throw new UsageError("options --backup and --no-clobber are mutually exclusive");
      const backupSuffix = normalizeBackupSuffix(value(parsed, "S") ?? context.env.SIMPLE_BACKUP_SUFFIX);
      if ((parsed.values.get("t")?.length ?? 0) > 1) throw new UsageError("multiple target directories specified");
      const targetDirectory = value(parsed, "t");
      if (targetDirectory !== undefined && parsed.flags.has("T")) throw new UsageError("cannot combine --target-directory and --no-target-directory");
      let destination;
      if (targetDirectory !== undefined) {
        requireOperands(parsed.operands);
        const target = pathOf(context, targetDirectory);
        if ((await context.fs.stat(target, { signal: context.signal })).type !== "directory") throw new FsError("ENOTDIR", { path: target });
        destination = { target, directory: true, sources: parsed.operands };
      } else if (parsed.flags.has("T")) {
        requireOperands(parsed.operands, 2, 2);
        destination = { target: pathOf(context, parsed.operands[1]!), directory: false, sources: parsed.operands.slice(0, 1) };
      } else destination = await destinations(context, parsed.operands);
      const budget = new MoveBudget(context.signal);
      const shouldSkip = async (source: string, target: string): Promise<boolean> => {
        if (!parsed.flags.has("n") && !parsed.flags.has("u")) return false;
        const targetStat = await maybeStat(context, target, false);
        if (!targetStat) return false;
        if (parsed.flags.has("n")) return true;
        const sourceStat = await context.fs.lstat(source, { signal: context.signal });
        if (sourceStat.type === "directory" || targetStat.type === "directory"
          || !(sourceStat.mtimeMs <= targetStat.mtimeMs)) return false;
        const identity = sourceStat.type === "symlink" || targetStat.type === "symlink"
          ? compareCopyIdentity(sourceStat, targetStat)
          : await compareObservedEntries(context.fs, source, sourceStat, context.fs, target, targetStat, { signal: context.signal });
        if (source === target || identity === "same") {
          throw new FsError("EINVAL", { path: source, dest: target, message: "source and destination are the same file" });
        }
        return true;
      };
      await preflightOperands(context, destination.sources, async operand => {
        const source = pathOf(context, operand);
        const target = destination.directory ? joinPath(destination.target, basename(source)) : destination.target;
        if (await shouldSkip(source, target)) return;
        await admitFilesystemModes(context, "mv", ["rename"], [source, target]);
        if (parsed.flags.has("n")) await admitNoReplaceRename(context, target);
      });
      const answers = lines(readBytes(context.stdin, context.signal));
      let declined = false;
      try {
        const result = await eachOperand(context, destination.sources, async operand => {
          const source = pathOf(context, operand);
          const target = destination.directory ? joinPath(destination.target, basename(source)) : destination.target;
          if (await shouldSkip(source, target)) return;
          if (parsed.flags.has("n")) await admitNoReplaceRename(context, target);
          const targetOperand = targetDirectory ?? parsed.operands.at(-1)!;
          const displayTarget = destination.directory ? childOperand(targetOperand, basename(source)) : targetOperand;
          if (parsed.flags.has("i")) {
            const sourceStat = await context.fs.lstat(source, { signal: context.signal });
            const targetStat = await maybeStat(context, target, false);
            if (targetStat) {
              if (source === target || await compareObservedEntries(context.fs, source, sourceStat, context.fs, target, targetStat, { signal: context.signal }) === "same") {
                throw new FsError("EINVAL", { path: source, dest: target, message: "source and destination are the same file" });
              }
              await writeBytes(context.stderr, new TextEncoder().encode(`mv: overwrite ${quoteShellOperand(displayTarget)}? `), context.signal);
              const answer = await answers.next();
              const first = answer.done ? undefined : answer.value.bytes[0];
              if (first !== 0x79 && first !== 0x59) { declined = true; return; }
            }
          }
          let backup: string | undefined;
          if (backupMode !== "none") {
            const sourceStat = await context.fs.lstat(source, { signal: context.signal });
            const targetStat = await maybeStat(context, target, false);
            if (targetStat) {
              const identity = await compareObservedEntries(context.fs, source, sourceStat, context.fs, target, targetStat, { signal: context.signal });
              if (source === target || identity === "same") throw new FsError("EINVAL", { path: source, dest: target, message: "source and destination are the same file" });
              if (identity === "unknown") throw new FsError("ENOTSUP", { path: source, dest: target, message: "backup rename lacks authoritative distinctness" });
              if ((sourceStat.type === "directory") !== (targetStat.type === "directory")) throw new FsError(sourceStat.type === "directory" ? "ENOTDIR" : "EISDIR", { path: target });
              let largest = 0n;
              if (backupMode !== "simple") {
                const prefix = `${basename(target)}.~`;
                for (const entry of await readDirectory(context, dirname(target))) {
                  if (!entry.name.startsWith(prefix) || !entry.name.endsWith("~")) continue;
                  const digits = entry.name.slice(prefix.length, -1);
                  if (!digits || digits[0] === "0" || !Array.from(digits).every(char => char >= "0" && char <= "9")) continue;
                  const number = BigInt(digits);
                  if (number > largest) largest = number;
                }
              }
              backup = backupMode === "numbered" || largest > 0n ? `${target}.~${largest + 1n}~` : target + backupSuffix;
              if (backup === source || backup === target) throw new FsError("EINVAL", { path: backup, message: "backup would overwrite source or destination" });
              const backupStat = await maybeStat(context, backup, false);
              if (backupStat && await compareObservedEntries(context.fs, source, sourceStat, context.fs, backup, backupStat, { signal: context.signal }) !== "distinct") throw new FsError("EINVAL", { path: backup, message: "backup would overwrite source" });
              await admitFilesystemModes(context, "mv", ["rename"], [target, backup]);
              await context.fs.rename(target, backup, { signal: context.signal });
            }
          }
          try {
            try { await context.fs.rename(source, target, { signal: context.signal, ...(parsed.flags.has("n") ? { noReplace: true } : {}) }); }
            catch (error) {
              context.signal.throwIfAborted();
              if (parsed.flags.has("n")) {
                if (codeOf(error) === "EEXIST") return;
                throw error;
              }
              if (codeOf(error) !== "EXDEV") throw error;
              const moved = await moveAcrossDevices(context, source, target, parsed.flags.has("n"), budget, parsed.flags.has("u"));
              if (moved === "skipped") return;
              if (!moved) {
                if (!parsed.flags.has("n")) throw new FsError("EINVAL", { path: source, dest: target, message: "source and destination are the same file" });
                return;
              }
            }
          } catch (error) {
            if (backup) await context.fs.rename(backup, target, { signal: context.signal });
            throw error;
          }
          if (parsed.flags.has("v")) {
            await output(context, `renamed '${escapeText(operand, "display")}' -> '${escapeText(displayTarget, "display")}'\n`);
          }
        });
        return { exitCode: declined ? 1 : result.exitCode };
      } finally { await answers.return(undefined); }
    }),
    define("rm", context => {
      if (maxRecursiveDirectoryDepth === Infinity && !context.argumentValues && !context.signal.aborted && (context.args.length === 1 || context.args.length === 2)) {
        const fastCtx = context as { _fastMemoryBackingFs?: FileSystem & { symlinkCount?: number; tryRmFastSync?: (path: string, recursive: boolean, force: boolean) => boolean }; _chargeFastFsOp?: () => void; _hasInfiniteFsOpsLimit?: boolean };
        const backingMem = fastCtx._fastMemoryBackingFs;
        if (
          fastCtx._hasInfiniteFsOpsLimit === true &&
          backingMem !== undefined &&
          typeof backingMem.tryRmFastSync === "function" &&
          backingMem.capabilitiesFor === undefined &&
          backingMem.symlinkCount === 0 &&
          !backingMem.capabilities.readOnly &&
          backingMem.capabilities.remove !== false &&
          backingMem.capabilities.recursiveRemove !== false &&
          backingMem.capabilities.removeDirectory !== false &&
          Object.getPrototypeOf(backingMem)?.constructor?.name === "MemoryFileSystem" &&
          !Object.prototype.hasOwnProperty.call(backingMem, "lstat") &&
          !Object.prototype.hasOwnProperty.call(backingMem, "stat") &&
          !Object.prototype.hasOwnProperty.call(backingMem, "realpath") &&
          !Object.prototype.hasOwnProperty.call(backingMem, "rm") &&
          !Object.prototype.hasOwnProperty.call(backingMem, "rmdir")
        ) {
          let recursive = false;
          let force = false;
          let operand: string | undefined;
          let fastOk = true;
          for (let i = 0; i < context.args.length; i++) {
            const a = context.args[i]!;
            if (a === "-rf" || a === "-fr" || a === "-Rf" || a === "-fR") { recursive = true; force = true; }
            else if (a === "-r" || a === "-R") { recursive = true; }
            else if (a === "-f") { force = true; }
            else if (a.length > 0 && a.charCodeAt(0) !== 45 && operand === undefined) { operand = a; }
            else { fastOk = false; break; }
          }
          if (fastOk && operand !== undefined && (!recursive || maxRecursiveDirectoryDepth === Infinity)) {
            const path = pathOf(context, operand);
            if (path !== "/" && path !== "/dev" && !path.startsWith("/dev/") && path.length <= 512 && !operand.endsWith(".") && !operand.endsWith("/")) {
              let admitted = false;
              try {
                assertCommandRequirements(context, filesystemCommandRequirements.rm, recursive ? RM_RECURSIVE_MODES : RM_FILE_MODES, backingMem.capabilities);
                admitted = true;
              } catch {
                admitted = false;
              }
              if (admitted && backingMem.tryRmFastSync(path, recursive, force)) {
                fastCtx._chargeFastFsOp!();
                return RESOLVED_EXIT_ZERO;
              }
            }
          }
        }
      }
      return (async () => {
      let interactive: "never" | "once" | "always" = "never";
      let force = false;
      let ended = false;
      const args: string[] = [];
      for (const argument of context.args) {
        if (ended) { args.push(argument); continue; }
        if (argument === "--") { ended = true; args.push(argument); continue; }
        if (argument === "--interactive" || argument.startsWith("--interactive=")) {
          const policy = argument === "--interactive" ? "always" : argument.slice("--interactive=".length);
          const policies = { never: "never", no: "never", none: "never", once: "once", always: "always", yes: "always" } as const;
          const matches = Object.keys(policies).filter(name => policy && name.startsWith(policy));
          const modes = new Set(matches.map(name => policies[name as keyof typeof policies]));
          if (modes.size !== 1) throw new UsageError(`${modes.size ? "ambiguous" : "invalid"} argument '${policy}' for 'interactive'`);
          interactive = [...modes][0]!;
          if (interactive === "always") force = false;
          continue;
        }
        const flags = argument === "--force" ? "f" : argument.startsWith("-") && !argument.startsWith("--") ? argument.slice(1) : "";
        for (const flag of flags) {
          if (flag === "f") { force = true; interactive = "never"; }
          else if (flag === "i") { interactive = "always"; force = false; }
          else if (flag === "I") interactive = "once";
        }
        args.push(argument);
      }
      const parsed = options(args, "rRfdviI", RM_LONG_OPTIONS);
      if (force) parsed.flags.add("f"); else parsed.flags.delete("f");
      if (!parsed.flags.has("f")) requireOperands(parsed.operands);
      const recursive = parsed.flags.has("r") || parsed.flags.has("R");
      const recursiveTraversal = recursive && (interactive === "always" || maxRecursiveDirectoryDepth !== Infinity);
      const backingMem = getRuntimeBackingFileSystem(context.fs) as { symlinkCount?: number; capabilitiesFor?: unknown } | undefined;
      const caps = context.fs.capabilities;
      const fastStockMemory =
        interactive === "never" &&
        !recursiveTraversal &&
        backingMem !== undefined &&
        backingMem.capabilitiesFor === undefined &&
        backingMem.symlinkCount === 0 &&
        caps.remove !== false &&
        caps.recursiveRemove !== false &&
        caps.removeDirectory !== false &&
        !caps.readOnly &&
        Object.getPrototypeOf(backingMem)?.constructor?.name === "MemoryFileSystem" &&
        !Object.prototype.hasOwnProperty.call(backingMem, "lstat") &&
        !Object.prototype.hasOwnProperty.call(backingMem, "stat") &&
        !Object.prototype.hasOwnProperty.call(backingMem, "realpath") &&
        !Object.prototype.hasOwnProperty.call(backingMem, "rm") &&
        !Object.prototype.hasOwnProperty.call(backingMem, "rmdir");
      if (fastStockMemory && parsed.operands.length === 1 && !parsed.flags.has("v") && (recursive || !parsed.flags.has("d"))) {
        const operand = parsed.operands[0]!;
        const path = pathOf(context, operand);
        if (path !== "/" && path !== "/dev" && !path.startsWith("/dev/") && !operand.endsWith(".") && !operand.endsWith("/")) {
          try {
            await admitFilesystemModes(context, "rm", [recursive ? "recursive" : "file"], [path]);
            await context.fs.rm(path, { recursive, force: parsed.flags.has("f"), signal: context.signal });
            return { exitCode: 0 };
          } catch (error) {
            await diagnostic(context, error);
            return { exitCode: 1 };
          }
        }
      }
      let answers: AsyncGenerator<{ bytes: Uint8Array }> | undefined;
      const confirm = async (question: string): Promise<boolean> => {
        answers ??= lines(readBytes(context.stdin, context.signal));
        await writeBytes(context.stderr, new TextEncoder().encode(`rm: ${question}? `), context.signal);
        const answer = await answers.next();
        const text = answer.done ? "" : new TextDecoder().decode(answer.value.bytes).trimStart();
        return text[0] === "y" || text[0] === "Y";
      };
      try {
        if (interactive === "once" && (recursive || parsed.operands.length > 3)
          && !await confirm(`remove ${parsed.operands.length} argument${parsed.operands.length === 1 ? "" : "s"}${recursive ? " recursively" : ""}`)) return { exitCode: 0 };
        if (!fastStockMemory) {
        await preflightOperands(context, parsed.operands, async operand => {
          const path = pathOf(context, operand);
          const stat = await maybeStat(context, path, false);
          if (!stat) return;
          const mode = stat.type === "directory" ? parsed.flags.has("r") || parsed.flags.has("R") ? "recursive" : "directory" : "file";
          if (mode === "directory") await admitEmptyDirectory(context, path, readDirectory);
          else await admitFilesystemModes(context, "rm", [mode], [path]);
        });
        }
        const remove = async (operand: string, depth = 0): Promise<boolean> => {
          const path = pathOf(context, operand);
          if (path === "/" || [".", ".."].includes(operand.replace(/\/+$/u, "").split("/").at(-1)!)) throw new FsError("EBUSY", { path, message: "refusing to remove root, '.' or '..'" });
          if (fastStockMemory) {
            if (!recursive && parsed.flags.has("d")) {
              const stat = await maybeStat(context, path, false);
              if (!stat) {
                if (parsed.flags.has("f")) return true;
                throw new FsError("ENOENT", { path });
              }
              if (stat.type === "directory") {
                await context.fs.rmdir!(path, { signal: context.signal });
                if (parsed.flags.has("v")) await output(context, `removed '${escapeText(operand, "display")}'\n`);
                return true;
              }
            }
            await context.fs.rm(path, { recursive, force: parsed.flags.has("f"), signal: context.signal });
            if (parsed.flags.has("v")) await output(context, `removed '${escapeText(operand, "display")}'\n`);
            return true;
          }
          const stat = await maybeStat(context, path, false);
          if (!stat) {
            if (parsed.flags.has("f")) return true;
            throw new FsError("ENOENT", { path });
          }
          if (stat.type === "directory" && !recursive && !parsed.flags.has("d")) throw new FsError("EISDIR", { path });
          if (interactive === "always" || recursiveTraversal) {
            const display = escapeText(operand, "display");
            if (stat.type === "directory" && recursive) {
              if (depth > maxRecursiveDirectoryDepth) throw new FsError("ELOOP", { path });
              const entries = await readDirectory(context, path, true);
              if (entries.length) {
                if (interactive === "always" && !await confirm(`descend into directory '${display}'`)) return false;
                let removed = true;
                for (const entry of entries) if (!await remove(childOperand(operand, entry.name), depth + 1)) removed = false;
                if (!removed) return false;
              }
            }
            const type = stat.type === "file" ? stat.size === 0 ? "regular empty file" : "regular file" : stat.type === "symlink" ? "symbolic link" : "directory";
            if (interactive === "always" && !await confirm(`remove ${type} '${display}'`)) return false;
          }
          if (stat.type === "directory" && (!recursive || recursiveTraversal)) {
            try { await removeEmptyDirectory(context, path, readDirectory); }
            catch (error) {
              context.signal.throwIfAborted();
              if (!parsed.flags.has("f") || codeOf(error) !== "ENOENT") throw error;
            }
          } else {
            const parentDir = await context.fs.realpath(dirname(path), { signal: context.signal });
            const canonicalPath = parentDir === "/" ? `/${basename(path)}` : `${parentDir}/${basename(path)}`;
            const currentStat = canonicalPath === path && (getRuntimeBackingFileSystem(context.fs) as { symlinkCount?: number } | undefined)?.symlinkCount === 0
              ? stat
              : await maybeStat(context, canonicalPath, false);
            if (!currentStat || currentStat.type !== stat.type || (stat.ino !== undefined && currentStat.ino !== stat.ino) || (stat.dev !== undefined && currentStat.dev !== stat.dev)) {
              throw new FsError("EAGAIN", { syscall: "rm", path });
            }
            const ancestorPaths: string[] = ["/"];
            if (parentDir !== "/") {
              let prefix = "";
              for (const part of parentDir.split("/").filter(Boolean)) {
                prefix += `/${part}`;
                ancestorPaths.push(prefix);
              }
            }
            const ancestors = await Promise.all(ancestorPaths.map(async entryPath => ({
              path: entryPath,
              stat: await context.fs.lstat(entryPath, { signal: context.signal }),
            })));
            const parentStat = ancestors.at(-1)!.stat;
            await bindConditionalMutation(currentStat.identityScope, { path: canonicalPath, parent: parentStat, expected: currentStat, ancestors }, () =>
              context.fs.rm(canonicalPath, { recursive, force: parsed.flags.has("f"), signal: context.signal, parent: parentStat, expected: currentStat, ancestors } as never),
            );
          }
          if (parsed.flags.has("v")) await output(context, `removed '${escapeText(operand, "display")}'\n`);
          return true;
        };
        return await eachOperand(context, parsed.operands, async operand => { await remove(operand); });
      } finally { if (answers) await answers.return(undefined); }
      })();
    }),
    define("rmdir", async context => {
      const parsed = options(context.args, "pv", RMDIR_LONG_OPTIONS);
      requireOperands(parsed.operands);
      await preflightOperands(context, parsed.operands, async operand => {
        let path = pathOf(context, operand);
        const stop = operand.startsWith("/") ? "/" : dirname(pathOf(context, operand.split("/").find(part => part && part !== ".") ?? operand));
        do {
          try { await admitEmptyDirectory(context, path, readDirectory); }
          catch (error) {
            context.signal.throwIfAborted();
            if (parsed.flags.has("ignore-fail-on-non-empty") && codeOf(error) === "ENOTEMPTY") return;
            throw error;
          }
          path = dirname(path);
        } while (parsed.flags.has("p") && path !== "/" && path !== stop);
      });
      return eachOperand(context, parsed.operands, async operand => {
        let path = pathOf(context, operand);
        let displayPath = operand;
        const stop = operand.startsWith("/") ? "/" : dirname(pathOf(context, operand.split("/").find(part => part && part !== ".") ?? operand));
        do {
          if (path === "/") throw new FsError("EBUSY", { path });
          try { await removeEmptyDirectory(context, path, readDirectory); }
          catch (error) {
            context.signal.throwIfAborted();
            if (parsed.flags.has("ignore-fail-on-non-empty") && codeOf(error) === "ENOTEMPTY") return;
            throw error;
          }
          if (parsed.flags.has("v")) await output(context, `rmdir: removing directory, '${escapeText(displayPath, "display")}'\n`);
          path = dirname(path);
          displayPath = dirname(displayPath);
        } while (parsed.flags.has("p") && path !== "/" && path !== stop);
      });
    }),
    define("ln", async context => {
      let ended = false;
      let optionValue = false;
      let logical = false;
      let interactive = false;
      const args = context.args.map(argument => {
        if (optionValue) { optionValue = false; return argument; }
        if (argument === "--") ended = true;
        if (!ended) {
          if (argument === "--logical") logical = true;
          else if (argument === "--physical") logical = false;
          else if (argument === "--interactive") interactive = true;
          else if (argument === "--force") interactive = false;
          else if (argument === "--suffix" || argument === "--target-directory") optionValue = true;
          else if (argument.startsWith("-") && !argument.startsWith("--")) {
            for (let offset = 1; offset < argument.length; offset++) {
              const flag = argument[offset]!;
              if (flag === "L" || flag === "P") logical = flag === "L";
              if (flag === "i" || flag === "f") interactive = flag === "i";
              if (flag === "S" || flag === "t") {
                optionValue = offset === argument.length - 1;
                break;
              }
            }
          }
        }
        return !ended && argument === "--backup" ? `--backup=${context.env.VERSION_CONTROL || "existing"}` : argument;
      });
      const parsed = options(args, "srifnTvbLPS:t:", { symbolic: "s", relative: "r", interactive: "i", force: "f", "no-dereference": "n", "no-target-directory": "T", verbose: "v", logical: "L", physical: "P", backup: "backup:", suffix: "S", "target-directory": "t" });
      if (parsed.flags.has("r") && !parsed.flags.has("s")) throw new UsageError("cannot do --relative without --symbolic");
      const targetDirectory = value(parsed, "t");
      if (targetDirectory !== undefined && parsed.flags.has("T")) throw new UsageError("cannot combine --target-directory and --no-target-directory");
      const control = value(parsed, "backup") ?? (parsed.flags.has("b") || parsed.flags.has("S") ? context.env.VERSION_CONTROL || "existing" : "none");
      const backupMode = matchBackupMode(control);
      const backupSuffix = normalizeBackupSuffix(value(parsed, "S") ?? context.env.SIMPLE_BACKUP_SUFFIX);
      requireOperands(parsed.operands);
      if (parsed.flags.has("T")) requireOperands(parsed.operands, 2, 2);
      const operands = targetDirectory !== undefined ? [...parsed.operands, targetDirectory] : parsed.operands.length === 1 ? [...parsed.operands, "."] : parsed.operands;
      const target = pathOf(context, operands.at(-1)!);
      const directory = !parsed.flags.has("T") && (await maybeStat(context, target, targetDirectory !== undefined || !parsed.flags.has("n")))?.type === "directory";
      if (targetDirectory !== undefined && !directory) throw new FsError("ENOTDIR", { path: target });
      if (operands.length > 2 && !directory) throw new FsError("ENOTDIR", { path: target });
      const symbolic = parsed.flags.has("s");
      needCapability(context, symbolic ? "symlink" : "link");
      await preflightOperands(context, operands.slice(0, -1), async operand => {
        const destination = directory ? joinPath(target, basename(operand)) : target;
        const replacing = (interactive || parsed.flags.has("f") || backupMode !== "none") && await maybeStat(context, destination, false);
        await admitFilesystemModes(context, "ln", [symbolic ? "symbolic" : "hard", ...replacing ? [backupMode !== "none" ? "backup" : "replace"] : []], [destination]);
      });
      const answers = lines(readBytes(context.stdin, context.signal));
      let declined = false;
      try {
        const result = await eachOperand(context, operands.slice(0, -1), async operand => {
          const destination = directory ? joinPath(target, basename(operand)) : target;
          const sourcePath = symbolic ? operand : pathOf(context, operand);
          let source = !symbolic && logical ? await context.fs.realpath(sourcePath, { signal: context.signal }) : sourcePath;
          const linkTarget = parsed.flags.has("r")
            ? relativePath(
              await canonicalizeReadlinkMissing(context, dirname(destination)),
              await canonicalizeReadlinkMissing(context, operand.startsWith("/") ? operand : `${context.cwd}/${operand}`),
            ) || "." : operand;
          if (!symbolic && source === destination) throw new FsError("EEXIST", { path: destination });
          const existing = await maybeStat(context, destination, false);
          let backup: string | undefined;
          if (existing && (interactive || parsed.flags.has("f") || backupMode !== "none")) {
            if (symbolic) source = pathOf(context, operand);
            if (existing.type === "directory") throw new FsError("EISDIR", { path: destination });
            if (!symbolic) {
              if (logical) await context.fs.stat(source, { signal: context.signal });
              else await context.fs.lstat(source, { signal: context.signal });
            }
            const sourceEntry = joinPath(await canonicalizeReadlinkMissing(context, dirname(source)), basename(source));
            const targetEntry = joinPath(await context.fs.realpath(dirname(destination), { signal: context.signal }), basename(destination));
            if (sourceEntry === targetEntry) throw new FsError("EEXIST", { path: destination, message: "source and destination are the same file" });
            if (interactive) {
              const displayTarget = directory ? childOperand(operands.at(-1)!, basename(operand)) : operands.at(-1)!;
              await writeBytes(context.stderr, new TextEncoder().encode(`ln: replace '${escapeText(displayTarget, "display")}'? `), context.signal);
              const answer = await answers.next();
              const text = answer.done ? "" : new TextDecoder().decode(answer.value.bytes).trimStart();
              if (text[0] !== "y" && text[0] !== "Y") { declined = true; return; }
            }
            if (backupMode !== "none") {
              let largest = 0n;
              if (backupMode !== "simple") {
                const prefix = basename(destination) + ".~";
                for (const entry of await readDirectory(context, dirname(destination))) {
                  if (!entry.name.startsWith(prefix) || !entry.name.endsWith("~")) continue;
                  const digits = entry.name.slice(prefix.length, -1);
                  if (!digits || digits[0] === "0" || !Array.from(digits).every(char => char >= "0" && char <= "9")) continue;
                  const number = BigInt(digits);
                  if (number > largest) largest = number;
                }
              }
              backup = backupMode === "numbered" || largest > 0n ? `${destination}.~${largest + 1n}~` : destination + backupSuffix;
              if (backup === source || backup === destination) throw new FsError("EINVAL", { path: backup, message: "backup would overwrite source or destination" });
              const backupStat = await maybeStat(context, backup, false);
              if (!symbolic && backupStat) {
                const sourceStat = logical ? await context.fs.stat(source, { signal: context.signal }) : await context.fs.lstat(source, { signal: context.signal });
                if (await compareObservedEntries(context.fs, source, sourceStat, context.fs, backup, backupStat, { signal: context.signal }) !== "distinct") throw new FsError("EINVAL", { path: backup, message: "backup would overwrite source" });
              }
              await admitFilesystemModes(context, "ln", ["backup"], [destination, backup]);
              await context.fs.rename(destination, backup, { signal: context.signal });
            } else await context.fs.rm(destination, { signal: context.signal });
          }
          try {
            if (symbolic) await context.fs.symlink!(linkTarget, destination, { signal: context.signal });
            else await context.fs.link!(source, destination, { signal: context.signal });
          } catch (error) {
            if (backup) await context.fs.rename(backup, destination, { signal: context.signal });
            throw error;
          }
          if (parsed.flags.has("v")) {
            const displayTarget = directory ? childOperand(operands.at(-1)!, basename(operand)) : operands.at(-1)!;
            await output(context, `'${escapeText(displayTarget, "display")}' ${symbolic ? "->" : "=>"} '${escapeText(linkTarget, "display")}'\n`);
          }
        });
        return { exitCode: declined ? 1 : result.exitCode };
      } finally { await answers.return(undefined); }
    }),
    createReadlinkCommand(),
    createRealpathCommand(),
    define("ls", async context => {
      let hidden: "none" | "all" | "almost-all" = "none";
      let sort: "name" | "time" | "size" | "none" | "extension" | "version" = "name";
      let timeKey: "mtimeMs" | "atimeMs" | "ctimeMs" = "mtimeMs";
      let indicator: "none" | "slash" | "file-type" | "classify" = "none";
      let ended = false;
      const args: string[] = [];
      for (let index = 0; index < context.args.length; index++) {
        const argument = context.args[index]!;
        if (!ended && (argument === "--time" || argument.startsWith("--time="))) {
          const selection = argument === "--time" ? context.args[++index] : argument.slice(7);
          if (selection === undefined) throw new UsageError("option '--time' requires an argument");
          const aliases = { mtime: "mtimeMs", modification: "mtimeMs", atime: "atimeMs", access: "atimeMs", use: "atimeMs", ctime: "ctimeMs", status: "ctimeMs" } as const;
          const matches = Object.keys(aliases).filter(alias => alias.startsWith(selection));
          const alias = Object.hasOwn(aliases, selection) ? selection : matches.length === 1 ? matches[0] : undefined;
          if (alias === undefined) throw new UsageError(`invalid argument '${selection}' for '--time'`);
          timeKey = aliases[alias as keyof typeof aliases];
          continue;
        }
        if (!ended && (argument === "--sort" || argument.startsWith("--sort="))) {
          const selection = argument === "--sort" ? context.args[++index] : argument.slice(7);
          if (selection !== "time" && selection !== "size" && selection !== "none" && selection !== "name" && selection !== "extension" && selection !== "version") {
            throw new UsageError("--sort requires 'time' or 'size'");
          }
          sort = selection;
          if (selection === "time") args.push("-t");
          else if (selection === "size") args.push("-S");
          else if (selection === "none") args.push("-U");
          else if (selection === "extension") args.push("-X");
          else if (selection === "version") args.push("-v");
          continue;
        }
        if (!ended && (argument === "--indicator-style" || argument.startsWith("--indicator-style="))) {
          const selection = argument === "--indicator-style" ? context.args[++index] : argument.slice(18);
          if (selection === undefined) throw new UsageError("option '--indicator-style' requires an argument");
          const styles = ["none", "slash", "file-type", "classify"] as const;
          const matches = styles.filter(style => style.startsWith(selection));
          if (matches.length !== 1) {
            throw new PublicDiagnostic(`${matches.length ? "ambiguous" : "invalid"} argument '${selection}' for '--indicator-style'\nValid arguments are:\n${styles.map(style => `  - '${style}'`).join("\n")}\nTry 'ls --help' for more information.`);
          }
          indicator = matches[0]!;
          continue;
        }
        if (!ended && argument === "--classify") indicator = "classify";
        if (!ended && argument === "--file-type") { indicator = "file-type"; continue; }
        if (!ended && argument === "--ignore-backups") { args.push("-B"); continue; }
        args.push(argument);
        if (argument === "--") ended = true;
        if (!ended && argument.startsWith("-") && !argument.startsWith("--")) for (const flag of argument.slice(1)) {
          if (flag === "t") sort = "time";
          else if (flag === "c") timeKey = "ctimeMs";
          else if (flag === "u") timeKey = "atimeMs";
          else if (flag === "S") sort = "size";
          else if (flag === "U") sort = "none";
          else if (flag === "f") { sort = "none"; hidden = "all"; }
          else if (flag === "X") sort = "extension";
          else if (flag === "v") sort = "version";
          else if (flag === "F") indicator = "classify";
          else if (flag === "p") indicator = "slash";
        }
      }
      const parsed = options(args, "aAl1dFprRLhtSQcuiUfXvB", { inode: "i", "quote-name": "Q", all: "a", "almost-all": "A", directory: "d", classify: "F", reverse: "r", recursive: "R", dereference: "L", "human-readable": "h", "ignore-backups": "B" }, false, undefined, undefined, key => {
        if (key === "f") hidden = "all";
        if (key === "a") hidden = "all";
        else if (key === "A") hidden = "almost-all";
      });
      if (sort === "name" && timeKey !== "mtimeMs" && !parsed.flags.has("l")) sort = "time";
      const formatName = (name: string): string => {
        if (!parsed.flags.has("Q")) return escapeText(name, "display");
        let quoted = '"';
        for (const character of name) {
          quoted += character === '"' ? '\\"' : character === "\x07" ? "\\a" : escapeText(character, "display");
        }
        return quoted + '"';
      };
      const operands = parsed.operands.length ? parsed.operands : ["."];
      interface ListingEntry { path: string; display: string; stat: FileStat | Pick<FileStat, "type"> }
      let outputWritten = false;
      const inspect = async (path: string, display: string, operand = false): Promise<ListingEntry> => {
        await admitFilesystemModes(context, "ls", ["entry"], [path]);
        let stat = await context.fs[parsed.flags.has("L") ? "stat" : "lstat"](path, { signal: context.signal });
        context.signal.throwIfAborted();
        if (operand && stat.type === "symlink" && !parsed.flags.has("L") && !parsed.flags.has("d") && !parsed.flags.has("l") && indicator !== "classify") {
          try {
            const target = await context.fs.stat(path, { signal: context.signal });
            if (target.type === "directory") stat = target;
          } catch (error) { context.signal.throwIfAborted(); if (codeOf(error) !== "ENOENT" && codeOf(error) !== "ENOTDIR" && codeOf(error) !== "ELOOP") throw error; }
          context.signal.throwIfAborted();
        }
        return { path, display, stat };
      };
      const order = async (entries: ListingEntry[], lexical = false): Promise<void> => {
        await yieldTurn(context.signal);
        if (sort === "none") return;
        if (sort !== "name" || !lexical) entries.sort((left, right) => {
          context.signal.throwIfAborted();
          if (sort === "time" || sort === "size") {
            if (!("size" in left.stat) || !("size" in right.stat)) throw new Error("ls metadata sorting requires file stats");
            const key = sort === "time" ? timeKey : "size";
            if (left.stat[key] > right.stat[key]) return -1;
            if (left.stat[key] < right.stat[key]) return 1;
          } else if (sort === "extension") {
            const extOf = (s: string) => { const dot = s.lastIndexOf("."); return dot > 0 ? s.slice(dot + 1) : ""; };
            const le = extOf(left.display), re = extOf(right.display);
            if (le !== re) return le < re ? -1 : 1;
          } else if (sort === "version") {
            const cmp = left.display.localeCompare(right.display, undefined, { numeric: true });
            if (cmp !== 0) return cmp;
          }
          return left.display < right.display ? -1 : left.display > right.display ? 1 : 0;
        });
        if (parsed.flags.has("r")) entries.reverse();
        await yieldTurn(context.signal);
      };
      const humanSize = (size: number, path: string): string => {
        if (!Number.isSafeInteger(size) || size < 0) throw new FsError("EINVAL", { path, message: "human-readable size must be a nonnegative safe integer" });
        if (size < 1024) return String(size);
        const bytes = BigInt(size);
        const units = "KMGTPEZY";
        let unit = 0;
        let scale = 1024n;
        while (unit < units.length - 1 && bytes > 1023n * scale) { scale *= 1024n; unit++; }
        const tenths = (bytes * 10n + scale - 1n) / scale;
        return (tenths < 100n ? `${tenths / 10n}.${tenths % 10n}` : String((bytes + scale - 1n) / scale)) + units[unit]!;
      };
      const suffixFor = (stat: ListingEntry["stat"]): string => {
        if (stat.type === "directory" && indicator !== "none") return "/";
        if ((indicator === "file-type" || indicator === "classify") && stat.type === "symlink") return "@";
        if (indicator === "classify" && stat.type === "file") {
          if (!("mode" in stat)) throw new Error("ls file classification requires file stats");
          if (stat.mode & 0o111) return "*";
        }
        return "";
      };
      const render = async ({ path, display, stat }: ListingEntry): Promise<void> => {
        let suffix = suffixFor(stat);
        const inode = parsed.flags.has("i") ? `${"ino" in stat ? stat.ino ?? "?" : "?"} ` : "";
        if (parsed.flags.has("l")) {
          if (!("size" in stat)) throw new Error("ls long listing requires file stats");
          let size = parsed.flags.has("h") ? humanSize(stat.size, path) : String(stat.size);
          const date = new Date(stat[timeKey]).toISOString().slice(0, 16).replace("T", " ");
          let target = "";
          if (stat.type === "symlink") {
            await admitFilesystemModes(context, "ls", ["link"], [path]);
            needCapability(context, "readlink");
            const link = await context.fs.readlink!(path, { signal: context.signal });
            const targetStat = indicator === "none" || indicator === "slash" ? undefined : await maybeStat(context, path).catch(error => {
              context.signal.throwIfAborted();
              if (codeOf(error) === "ENOTDIR" || codeOf(error) === "ELOOP") return undefined;
              throw error;
            });
            suffix = "";
            target = ` -> ${formatName(link)}${targetStat ? suffixFor(targetStat) : ""}`;
          }
          if (stat.type === "character") {
            for (const number of [stat.rdevMajor, stat.rdevMinor]) {
              if (number !== undefined && (!Number.isSafeInteger(number) || number < 0)) {
                throw new FsError("EIO", { path, message: "invalid device number" });
              }
            }
            size = `${stat.rdevMajor ?? "?"}, ${stat.rdevMinor ?? "?"}`;
          }
          await output(context, `${inode}${modeText(stat)} ${stat.nlink ?? 1} ${stat.uid ?? 0} ${stat.gid ?? 0} ${size} ${date} ${formatName(display)}${suffix}${target}\n`);
        } else await output(context, `${inode}${formatName(display)}${suffix}\n`);
        outputWritten = true;
      };
      const list = async ({ path, display, stat }: ListingEntry, header: boolean, ancestors = new Set<string>()): Promise<void> => {
        context.signal.throwIfAborted();
        await admitFilesystemModes(context, "ls", ["directory"], [path]);
        const physical = await context.fs.realpath(path, { signal: context.signal });
        if (ancestors.has(physical)) throw new FsError("ELOOP", { path });
        context.signal.throwIfAborted();
        if (ancestors.size > maxRecursiveDirectoryDepth) {
          throw new FsError("ELOOP", { path, message: `ls directory depth limit exceeded (${maxRecursiveDirectoryDepth})` });
        }
        ancestors.add(physical);
        try {
          if (header) { await output(context, `${outputWritten ? "\n" : ""}${formatName(display)}:\n`); outputWritten = true; }
          const entries = await readDirectory(context, path, true);
          const byName = new Map(entries.map(entry => [entry.name, entry.type] as const));
          const names = entries.map(entry => entry.name).filter(name => (hidden !== "none" || !name.startsWith(".")) && (!parsed.flags.has("B") || !name.endsWith("~")));
          if (hidden === "all") for (const name of [".", ".."]) {
            const index = names.findIndex(entry => entry > name);
            names.splice(index < 0 ? names.length : index, 0, name);
          }
          const needsStat = parsed.flags.has("l") || parsed.flags.has("i") || sort === "time" || sort === "size";
          const children: ListingEntry[] = [];
          for (const [index, name] of names.entries()) {
            if (index % 128 === 0) await yieldTurn(context.signal);
            const childPath = joinPath(path, name);
            const entryType = byName.get(name) ?? "directory";
            if (needsStat || (parsed.flags.has("L") && entryType === "symlink") || (indicator === "classify" && entryType === "file")) {
              children.push(await inspect(childPath, name));
            } else {
              children.push({
                path: childPath,
                display: name,
                stat: name === "." ? stat : { type: entryType },
              });
            }
          }
          await order(children, true);
          for (const child of children) await render(child);
          if (parsed.flags.has("R")) for (const child of children) {
            if (child.display === "." || child.display === "..") continue;
            if (child.stat.type === "directory") await list({ ...child, display: childOperand(display, child.display) }, true, ancestors);
          }
        } finally { ancestors.delete(physical); }
      };
      const entries: ListingEntry[] = [];
      let admitted = 0;
      const result = await eachOperand(context, operands, async operand => {
        if (admitted++ % 128 === 0) await yieldTurn(context.signal);
        entries.push(await inspect(pathOf(context, operand), operand, true));
      });
      const files = entries.filter(entry => parsed.flags.has("d") || entry.stat.type !== "directory");
      const directories = entries.filter(entry => !parsed.flags.has("d") && entry.stat.type === "directory");
      await order(files);
      await order(directories);
      for (const entry of [...files, ...directories]) {
        const rendered = await eachOperand(context, [entry.display], async () => {
          if (entry.stat.type !== "directory" || parsed.flags.has("d")) await render(entry);
          else await list(entry, operands.length > 1 || parsed.flags.has("R"));
        });
        result.exitCode = Math.max(result.exitCode, rendered.exitCode);
      }
      return result;
    }),
  ].map(command => {
    const requirements = filesystemCommandRequirements[command.name as keyof typeof filesystemCommandRequirements];
    return requirements ? { ...command, filesystemRequirements: requirements } : command;
  });
  for (const command of commands) {
    if (command.name === "mkdir") defaultMkdirExecutors.add(command.execute);
    else if (command.name === "rm" && maxRecursiveDirectoryDepth === Infinity) defaultRmExecutors.add(command.execute);
  }
  return commands;
}
