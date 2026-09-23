import {
  basename, dirname, FsError, isPathWithin, joinPath, normalizePath, relativePath,
  readBytes, writeBytes, type CommandContext, type CommandDefinition, type FileStat,
} from "../contracts/index.js";
import { codeOf, define, diagnostic, eachOperand, lines, options, output, pathOf, requireOperands, UsageError, value } from "./internal.js";
import { escapeText } from "../escaping.js";
import { compareCopyIdentity, compareObservedEntries } from "./copy-identity.js";
import { MoveBudget, moveAcrossDevices } from "./move.js";
import { admitFilesystemModes, filesystemCommandRequirements } from "./filesystem-requirements.js";
import { createDirectoryReader, type DirectoryReader } from "./directory-admission.js";
import { yieldTurn } from "../contracts/yield.js";
import { PublicDiagnostic } from "../diagnostics.js";
import { touchTimes } from "./touch-times.js";
import { canonicalizeReadlinkMissing } from "./readlink-missing.js";
import { backupCopyTarget, copyOptions } from "./copy-backup.js";
import { admitCopyPreservation, preserveCopyMetadata, type CopyOptions } from "./copy-preserve.js";

// Operand directories start at depth zero; files inside the last admitted
// directory do not consume another directory-recursion level.
const MAX_RECURSIVE_DIRECTORY_DEPTH = 1024;

async function preflightOperands(
  context: CommandContext, operands: readonly string[], check: (operand: string) => Promise<void>,
): Promise<void> {
  for (const operand of operands) {
    try { await check(operand); }
    catch (error) {
      context.signal.throwIfAborted();
      if (codeOf(error) === "ENOTSUP" || codeOf(error) === "EROFS"
        || codeOf(error) === "ENOTEMPTY" && error instanceof FsError && codeOf(error.cause) === "ENOTSUP") throw error;
    }
  }
}

async function maybeStat(context: CommandContext, path: string, follow = true): Promise<FileStat | undefined> {
  try { return await context.fs[follow ? "stat" : "lstat"](path, { signal: context.signal }); }
  catch (error) { context.signal.throwIfAborted(); if (codeOf(error) === "ENOENT") return undefined; throw error; }
}

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

async function canonicalMissing(
  context: CommandContext, path: string, mode: "copy" | "preflight" | "realpath" = "copy",
): Promise<string> {
  if (mode !== "copy") {
    context.signal.throwIfAborted();
    const canonical = context.fs.canonicalizeMissingTarget?.(path, { signal: context.signal });
    context.signal.throwIfAborted();
    if (canonical !== undefined) return canonical;
  }
  const suffix: string[] = [];
  let canonical: string;
  while (true) {
    if (mode === "realpath") {
      context.signal.throwIfAborted();
      if (suffix.length > 0 && suffix.length % 32 === 0) await yieldTurn(context.signal);
    }
    try { canonical = await context.fs.realpath(path, { signal: context.signal }); break; }
    catch (error) {
      context.signal.throwIfAborted();
      if (codeOf(error) !== "ENOENT" || path === "/") throw error;
      const link = await maybeStat(context, path, false);
      if (link?.type === "symlink") throw error;
      suffix.push(basename(path));
      path = dirname(path);
    }
  }
  for (let index = suffix.length - 1; index >= 0; index--) {
    if (mode === "realpath") {
      context.signal.throwIfAborted();
      if ((suffix.length - index) % 32 === 0) await yieldTurn(context.signal);
    }
    canonical = joinPath(canonical, suffix[index]!);
  }
  return canonical;
}

function needCapability(context: CommandContext, capability: "symlink" | "link" | "readlink" | "utimes"): void {
  const declaration = { symlink: "symlinks", link: "hardlinks", readlink: "readlink", utimes: "timestamps" }[capability];
  if (!context.fs.capabilitiesFor && context.fs.capabilities[declaration] === false) throw new FsError("ENOTSUP", { syscall: capability });
  if (!context.fs[capability]) throw new FsError("ENOTSUP", { syscall: capability });
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

async function destinations(context: CommandContext, operands: readonly string[], targetDirectory?: string, noTargetDirectory = false) {
  if (targetDirectory !== undefined && noTargetDirectory) throw new UsageError("cannot combine --target-directory and --no-target-directory");
  requireOperands(operands, targetDirectory === undefined ? 2 : 1, noTargetDirectory ? 2 : Infinity);
  const targetOperand = targetDirectory ?? operands.at(-1)!;
  const target = pathOf(context, targetOperand);
  const stat = await maybeStat(context, target);
  if (targetDirectory !== undefined && stat?.type !== "directory") throw new FsError(stat ? "ENOTDIR" : "ENOENT", { path: target });
  const directory = !noTargetDirectory && stat?.type === "directory";
  if (operands.length > 2 && !directory) throw new FsError("ENOTDIR", { path: target });
  return { target, targetOperand, directory, sources: targetDirectory === undefined ? operands.slice(0, -1) : operands };
}

function childOperand(operand: string, name: string): string {
  while (operand.endsWith("/")) operand = operand.slice(0, -1);
  return `${operand}/${name}`;
}

async function copy(
  context: CommandContext, source: string, target: string,
  settings: CopyOptions, readDirectory: DirectoryReader, top = true, ancestors = new Set<string>(),
  preflight = false, displaySource = source, displayTarget = target,
): Promise<void> {
  context.signal.throwIfAborted();
  const { flags, preserve, copiedLinks, backup } = settings;
  const attributesOnly = flags.has("attributes-only");
  const linkMode = flags.has("s") || flags.has("l");
  const link = await context.fs.lstat(source, { signal: context.signal });
  const preserveLink = link.type === "symlink" && !flags.has("L") && (flags.has("P") || !top);
  const sourceStat = preserveLink ? link : await context.fs.stat(source, { signal: context.signal });
  const removeDestination = flags.has("remove-destination") && sourceStat.type !== "directory";
  const targetStat = await maybeStat(context, target, !preserveLink && !removeDestination && !linkMode);
  const physicalSource = preserveLink
    ? joinPath(await context.fs.realpath(dirname(source), { signal: context.signal }), basename(source))
    : await context.fs.realpath(source, { signal: context.signal });
  const physicalTarget = preserveLink || removeDestination || linkMode
    ? joinPath(preflight ? await canonicalMissing(context, dirname(target), "preflight")
      : await context.fs.realpath(dirname(target), { signal: context.signal }), basename(target))
    : await canonicalMissing(context, target, preflight ? "preflight" : "copy");
  if (physicalSource === physicalTarget || compareCopyIdentity(sourceStat, targetStat) === "same") {
    throw new FsError("EINVAL", { path: source, dest: target, message: "source and destination are the same file" });
  }
  if (flags.has("n") && await maybeStat(context, target, false)) return;
  if (!preflight && !preserveLink && targetStat && await compareObservedEntries(context.fs, source, sourceStat, context.fs, target, targetStat, { signal: context.signal }) === "same") {
    throw new FsError("EINVAL", { path: source, dest: target, message: "source and destination are the same file" });
  }
  const metadata = settings.sourceMetadata.get(physicalSource) ?? sourceStat;
  if (preserve.has("timestamps") && !settings.sourceMetadata.has(physicalSource)) settings.sourceMetadata.set(physicalSource, metadata);
  await admitCopyPreservation(context, preserve, sourceStat, target, targetStat);
  const previousSource = settings.copiedTargets.get(physicalTarget);
  if (previousSource && compareCopyIdentity(previousSource, sourceStat) !== "same") {
    throw new PublicDiagnostic(`will not overwrite just-created '${displayTarget}' with '${displaySource}'`);
  }
  let links: Map<string, { path: string; stat?: FileStat }> | undefined;
  let identity: string | undefined;
  if (preserve.has("links") && sourceStat.type !== "directory") {
    if (compareCopyIdentity(sourceStat, sourceStat) !== "same") {
      throw new FsError("ENOTSUP", { syscall: "cp", path: source, message: "preserving links requires scoped file identity" });
    }
    links = copiedLinks.get(sourceStat.identityScope!);
    if (!links) { links = new Map(); copiedLinks.set(sourceStat.identityScope!, links); }
    identity = `${sourceStat.dev}:${sourceStat.ino}`;
  }
  const previous = links?.get(identity!);
  if (previous) {
    await admitFilesystemModes(context, "cp", ["hardlink"], [previous.path, target]);
    needCapability(context, "link");
    const existing = await maybeStat(context, target, false);
    if (existing?.type === "directory") throw new FsError("EISDIR", { path: target });
    if (!preflight && compareCopyIdentity(previous.stat, await context.fs.lstat(previous.path, { signal: context.signal })) !== "same") {
      throw new FsError("ENOTSUP", { syscall: "cp", path: previous.path, message: "copied hard-link source changed" });
    }
    if (!preflight && compareCopyIdentity(previous.stat, existing) === "same") return;
    if (existing) {
      await admitFilesystemModes(context, "cp", ["replace"], [target]);
      if (compareCopyIdentity(link, existing) !== "distinct" || compareCopyIdentity(sourceStat, existing) !== "distinct") {
        throw new FsError("ENOTSUP", { path: target, message: "hard-link copy unlink lacks authoritative distinctness" });
      }
      if (backup) await backupCopyTarget(context, source, target, backup, readDirectory, preflight);
      else if (!preflight) await context.fs.rm(target, { recursive: false, signal: context.signal });
    }
    if (!preflight) await context.fs.link!(previous.path, target, { signal: context.signal });
  } else if (sourceStat.type === "directory") {
    if (!flags.has("r") && !flags.has("R")) throw new FsError("EISDIR", { path: source, message: "omitting directory (use -R)" });
    if (isPathWithin(physicalSource, physicalTarget)) throw new FsError("EINVAL", { path: target, message: "cannot copy a directory into itself" });
    if (ancestors.has(physicalSource)) throw new FsError("ELOOP", { path: source });
    if (targetStat && targetStat.type !== "directory") throw new FsError("ENOTDIR", { path: target });
    context.signal.throwIfAborted();
    if (ancestors.size > MAX_RECURSIVE_DIRECTORY_DEPTH) {
      throw new FsError("ELOOP", { path: source, message: `cp directory depth limit exceeded (${MAX_RECURSIVE_DIRECTORY_DEPTH})` });
    }
    await admitFilesystemModes(context, "cp", [attributesOnly ? "attributes-recursive" : "recursive"], [target]);
    const temporaryMode = !targetStat && (sourceStat.mode & 0o700) !== 0o700;
    if (temporaryMode) {
      await admitFilesystemModes(context, "cp", ["mode"], [target]);
      if (!context.fs.chmod) throw new FsError("ENOTSUP", { syscall: "chmod", path: target });
    }
    let created = false;
    ancestors.add(physicalSource);
    try {
      if (!targetStat && !preflight) {
        await context.fs.mkdir(target, { mode: (sourceStat.mode & 0o777) | (temporaryMode ? 0o700 : 0), signal: context.signal });
        created = true;
      }
      for (const entry of await readDirectory(context, source, true)) {
        await copy(context, joinPath(source, entry.name), joinPath(target, entry.name), settings, readDirectory, false, ancestors, preflight,
          childOperand(displaySource, entry.name), childOperand(displayTarget, entry.name));
      }
    } finally {
      ancestors.delete(physicalSource);
      if (created && temporaryMode) {
        // Restore the temporary mode even when copying was cancelled.
        try { await context.fs.chmod!(target, sourceStat.mode & 0o777); }
        finally { context.signal.throwIfAborted(); }
      }
    }
  } else if (linkMode) {
    const symbolic = flags.has("s");
    await admitFilesystemModes(context, "cp", [symbolic ? "symlink" : "hardlink"], [source, target]);
    needCapability(context, symbolic ? "symlink" : "link");
    if (symbolic && !displaySource.startsWith("/")
      && dirname(physicalTarget) !== await context.fs.realpath(context.cwd, { signal: context.signal })) {
      throw new PublicDiagnostic("can make relative symbolic links only in current directory");
    }
    if (targetStat) {
      if (targetStat.type === "directory") throw new FsError("EISDIR", { path: target });
      await admitFilesystemModes(context, "cp", ["replace"], [target]);
      if (compareCopyIdentity(link, targetStat) !== "distinct" || compareCopyIdentity(sourceStat, targetStat) !== "distinct") {
        throw new FsError("ENOTSUP", { path: target, message: "link copy unlink lacks authoritative distinctness" });
      }
      if (backup) await backupCopyTarget(context, source, target, backup, readDirectory, preflight);
      else if (!preflight) await context.fs.rm(target, { recursive: false, signal: context.signal });
    }
    if (!preflight) {
      if (symbolic) await context.fs.symlink!(displaySource, target, { signal: context.signal });
      else await context.fs.link!(preserveLink ? source : physicalSource, target, { signal: context.signal });
    }
  } else if (preserveLink) {
    await admitFilesystemModes(context, "cp", ["symlink"], [target]);
    needCapability(context, "symlink"); needCapability(context, "readlink");
    const linkTarget = await context.fs.readlink!(source, { signal: context.signal });
    const existing = await maybeStat(context, target, false);
    if (existing) {
      if (attributesOnly && !backup && !removeDestination) throw new FsError("EEXIST", { syscall: "symlink", path: target });
      await admitFilesystemModes(context, "cp", ["replace"], [target]);
      if (existing.type === "directory") throw new FsError("EISDIR", { path: target });
      const sourceEntry = await context.fs.lstat(source, { signal: context.signal });
      const identity = compareCopyIdentity(sourceEntry, existing);
      if (identity === "same") throw new FsError("EINVAL", { path: source, dest: target, message: "source and destination are the same file" });
      if (identity === "unknown") throw new FsError("ENOTSUP", { path: source, dest: target, message: "symbolic link copy unlink lacks authoritative distinctness" });
      context.signal.throwIfAborted();
      if (backup) await backupCopyTarget(context, source, target, backup, readDirectory, preflight);
      else if (!preflight) await context.fs.rm(target, { recursive: false, signal: context.signal });
    }
    if (!preflight) await context.fs.symlink!(linkTarget, target, { signal: context.signal });
  } else if (attributesOnly) {
    await admitFilesystemModes(context, "cp", [targetStat && !backup && !removeDestination ? "attributes" : "attributes-create", ...removeDestination ? ["replace"] : []], [target]);
    if (targetStat?.type === "directory") throw new FsError("EISDIR", { path: target });
    if (removeDestination && targetStat) {
      const identity = targetStat.type === "symlink" ? compareCopyIdentity(sourceStat, targetStat)
        : await compareObservedEntries(context.fs, source, sourceStat, context.fs, target, targetStat, { signal: context.signal });
      if (identity === "same") throw new FsError("EINVAL", { path: source, dest: target, message: "source and destination are the same file" });
      if (identity === "unknown") throw new FsError("ENOTSUP", { path: source, dest: target, message: "copy unlink lacks authoritative distinctness" });
    }
    if (backup && targetStat) await backupCopyTarget(context, source, target, backup, readDirectory, preflight);
    else if (removeDestination && targetStat && !preflight) await context.fs.rm(target, { recursive: false, signal: context.signal });
    if ((!targetStat || backup || removeDestination) && !preflight) {
      await context.fs.writeFile(target, new Uint8Array(), { flag: "wx", mode: sourceStat.mode & 0o777, signal: context.signal });
    }
  } else {
    const replace = removeDestination || flags.has("f") && targetStat !== undefined && targetStat.type !== "character";
    await admitFilesystemModes(context, "cp", ["file", ...replace ? ["replace", "exclusive"] : []], [target]);
    if (targetStat?.type === "directory") throw new FsError("EISDIR", { path: target });
    if (removeDestination && targetStat) {
      const identity = targetStat.type === "symlink" ? compareCopyIdentity(sourceStat, targetStat)
        : await compareObservedEntries(context.fs, source, sourceStat, context.fs, target, targetStat, { signal: context.signal });
      if (identity === "same") throw new FsError("EINVAL", { path: source, dest: target, message: "source and destination are the same file" });
      if (identity === "unknown") throw new FsError("ENOTSUP", { path: source, dest: target, message: "copy unlink lacks authoritative distinctness" });
    }
    if (backup && await maybeStat(context, target, false)) await backupCopyTarget(context, source, target, backup, readDirectory, preflight);
    if (preflight) {
      if (links) {
        links.set(identity!, { path: target });
        settings.copiedTargets.set(physicalTarget, sourceStat);
      }
      return;
    }
    try {
      if (removeDestination && targetStat && !backup) await context.fs.rm(target, { recursive: false, signal: context.signal });
      await context.fs.copyFile(source, target, { exclusive: removeDestination, signal: context.signal });
    }
    catch (error) {
      context.signal.throwIfAborted();
      if (removeDestination || !replace || codeOf(error) !== "EACCES") throw error;
      const existing = await maybeStat(context, target, false);
      if (existing) {
        const sourceEntry = await context.fs.lstat(source, { signal: context.signal });
        const sourceContents = await context.fs.stat(source, { signal: context.signal });
        const contentsIdentity = existing.type === "symlink" ? compareCopyIdentity(sourceContents, existing)
          : await compareObservedEntries(context.fs, source, sourceContents, context.fs, target, existing, { signal: context.signal });
        const entryIdentity = sourceEntry.type === "symlink" ? compareCopyIdentity(sourceEntry, existing) : contentsIdentity;
        const identities = [entryIdentity, contentsIdentity];
        if (identities.includes("same")) throw new FsError("EINVAL", { path: source, dest: target, message: "source and destination are the same file" });
        if (identities.includes("unknown")) throw new FsError("ENOTSUP", { path: source, dest: target, message: "forced copy unlink lacks authoritative distinctness" });
        await context.fs.rm(target, { recursive: false, signal: context.signal });
      }
      await context.fs.copyFile(source, target, { exclusive: true, signal: context.signal });
    }
  }
  if (!preflight) await preserveCopyMetadata(context, preserve, metadata, target);
  context.signal.throwIfAborted();
  if (links) settings.copiedTargets.set(physicalTarget, sourceStat);
  if (links && !previous) links.set(identity!, { path: target, ...preflight ? {} : { stat: await context.fs.lstat(target, { signal: context.signal }) } });
  if (!preflight && flags.has("v")) await output(context, `'${escapeText(displaySource, "display")}' -> '${escapeText(displayTarget, "display")}'\n`);
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

export function filesystemCommands(maxDirectoryEntries?: number): CommandDefinition[] {
  const readDirectory = createDirectoryReader(maxDirectoryEntries);
  return [
    define("mkdir", async context => {
      const parsed = options(context.args, "pm:v", { parents: "p", mode: "m", verbose: "v" });
      requireOperands(parsed.operands);
      const mode = value(parsed, "m");
      if (mode !== undefined && !/^[0-7]{1,4}$/u.test(mode)) throw new UsageError(`invalid mode '${mode}' (octal required)`);
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
          await context.fs.mkdir(path, { recursive, ...(stat || mode === undefined ? {} : { mode: parseInt(mode, 8) }), signal: context.signal });
          if (!stat && parsed.flags.has("v")) await output(context, `mkdir: created directory '${escapeText(operand, "display")}'\n`);
        }
      };
      await preflightOperands(context, parsed.operands, operand => createDirectory(operand, true));
      return eachOperand(context, parsed.operands, operand => createDirectory(operand, false));
    }),
    define("touch", async context => {
      const parsed = options(context.args, "camr:d:t:", { "no-create": "c", reference: "r", date: "d" });
      requireOperands(parsed.operands);
      const reference = value(parsed, "r");
      const date = value(parsed, "d"), timestamp = value(parsed, "t");
      if (timestamp !== undefined && (date !== undefined || reference !== undefined)) {
        throw new PublicDiagnostic("cannot specify times from more than one source");
      }
      const now = Date.now();
      const explicit = reference !== undefined || date !== undefined || timestamp !== undefined;
      const base = reference === undefined ? { atimeMs: now, mtimeMs: now }
        : await context.fs.stat(pathOf(context, reference), { signal: context.signal });
      const times = date === undefined && timestamp === undefined ? base
        : touchTimes(date, timestamp, context.env.TZ ?? "UTC", base);
      await preflightOperands(context, parsed.operands, async operand => {
        const path = pathOf(context, operand);
        const existing = await maybeStat(context, path);
        const modes = existing ? ["existing"] : parsed.flags.has("c") ? ["no-create"]
          : explicit ? ["create", "existing"] : ["create"];
        await admitFilesystemModes(context, "touch", modes, [path]);
      });
      return eachOperand(context, parsed.operands, async operand => {
        const path = pathOf(context, operand);
        let existing = await maybeStat(context, path);
        if (!existing) {
          if (parsed.flags.has("c")) return;
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
    }),
    define("cp", async context => {
      const parsed = copyOptions(context);
      if ((parsed.values.get("t")?.length ?? 0) > 1) throw new UsageError("multiple target directories specified");
      const destination = await destinations(context, parsed.operands, value(parsed, "t"), parsed.flags.has("T"));
      await preflightOperands(context, destination.sources, async operand => {
        const source = pathOf(context, operand);
        await copy(context, source, destination.directory ? joinPath(destination.target, basename(source)) : destination.target,
          parsed, readDirectory, true, new Set(), true, operand);
      });
      parsed.copiedLinks.clear();
      parsed.copiedTargets.clear();
      return eachOperand(context, destination.sources, async operand => {
        const source = pathOf(context, operand);
        const targetOperand = destination.targetOperand;
        await copy(context, source, destination.directory ? joinPath(destination.target, basename(source)) : destination.target,
          parsed, readDirectory, true, new Set(), false, operand,
          destination.directory ? childOperand(targetOperand, basename(source)) : targetOperand);
      });
    }),
    define("mv", async context => {
      let ended = false;
      let optionValue = false;
      const args = context.args.map(argument => {
        if (optionValue) { optionValue = false; return argument; }
        if (argument === "--") ended = true;
        if (!ended && ["-S", "--suffix", "-t", "--target-directory"].includes(argument)) optionValue = true;
        return !ended && argument === "--backup" ? `--backup=${context.env.VERSION_CONTROL || "existing"}` : argument;
      });
      const parsed = options(args, "fnvbB:S:Tt:", {
        force: "f", "no-clobber": "n", verbose: "v", backup: "B", suffix: "S",
        "no-target-directory": "T", "target-directory": "t",
      });
      const control = value(parsed, "B") ?? (parsed.flags.has("b") ? context.env.VERSION_CONTROL || "existing" : "none");
      const modes: Readonly<Record<string, string>> = { none: "none", off: "none", numbered: "numbered", t: "numbered", existing: "existing", nil: "existing", simple: "simple", never: "simple" };
      const backupMode = modes[control];
      if (!backupMode) throw new UsageError(`invalid argument '${control}' for backup type`);
      if (backupMode !== "none" && parsed.flags.has("n")) throw new UsageError("options --backup and --no-clobber are mutually exclusive");
      const backupSuffix = value(parsed, "S") || context.env.SIMPLE_BACKUP_SUFFIX || "~";
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
      await preflightOperands(context, destination.sources, async operand => {
        const source = pathOf(context, operand);
        const target = destination.directory ? joinPath(destination.target, basename(source)) : destination.target;
        if (parsed.flags.has("n") && await maybeStat(context, target, false)) return;
        await admitFilesystemModes(context, "mv", ["rename"], [source, target]);
        if (parsed.flags.has("n")) await admitNoReplaceRename(context, target);
      });
      return eachOperand(context, destination.sources, async operand => {
        const source = pathOf(context, operand);
        const target = destination.directory ? joinPath(destination.target, basename(source)) : destination.target;
        if (parsed.flags.has("n") && await maybeStat(context, target, false)) return;
        if (parsed.flags.has("n")) await admitNoReplaceRename(context, target);
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
                if (!digits || !Array.from(digits).every(char => char >= "0" && char <= "9")) continue;
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
            if (!await moveAcrossDevices(context, source, target, parsed.flags.has("n"), budget)) {
              if (!parsed.flags.has("n")) throw new FsError("EINVAL", { path: source, dest: target, message: "source and destination are the same file" });
              return;
            }
          }
        } catch (error) {
          if (backup) await context.fs.rename(backup, target, { signal: context.signal });
          throw error;
        }
        if (parsed.flags.has("v")) {
          const targetOperand = targetDirectory ?? parsed.operands.at(-1)!;
          const displayTarget = destination.directory ? childOperand(targetOperand, basename(source)) : targetOperand;
          await output(context, `renamed '${escapeText(operand, "display")}' -> '${escapeText(displayTarget, "display")}'\n`);
        }
      });
    }),
    define("rm", async context => {
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
      const parsed = options(args, "rRfdviI", { recursive: "r", force: "f", dir: "d", verbose: "v" });
      if (force) parsed.flags.add("f"); else parsed.flags.delete("f");
      if (!parsed.flags.has("f")) requireOperands(parsed.operands);
      const recursive = parsed.flags.has("r") || parsed.flags.has("R");
      const answers = lines(readBytes(context.stdin, context.signal));
      const confirm = async (question: string): Promise<boolean> => {
        await writeBytes(context.stderr, new TextEncoder().encode(`rm: ${question}? `), context.signal);
        const answer = await answers.next();
        const text = answer.done ? "" : new TextDecoder().decode(answer.value.bytes).trimStart();
        return text[0] === "y" || text[0] === "Y";
      };
      try {
        if (interactive === "once" && (recursive || parsed.operands.length > 3)
          && !await confirm(`remove ${parsed.operands.length} argument${parsed.operands.length === 1 ? "" : "s"}${recursive ? " recursively" : ""}`)) return { exitCode: 0 };
        await preflightOperands(context, parsed.operands, async operand => {
          const path = pathOf(context, operand);
          const stat = await maybeStat(context, path, false);
          if (!stat) return;
          const mode = stat.type === "directory" ? parsed.flags.has("r") || parsed.flags.has("R") ? "recursive" : "directory" : "file";
          if (mode === "directory") await admitEmptyDirectory(context, path, readDirectory);
          else await admitFilesystemModes(context, "rm", [mode], [path]);
        });
        const remove = async (operand: string, depth = 0): Promise<boolean> => {
          const path = pathOf(context, operand);
          if (path === "/" || [".", ".."].includes(operand.replace(/\/+$/u, "").split("/").at(-1)!)) throw new FsError("EBUSY", { path, message: "refusing to remove root, '.' or '..'" });
          const stat = await maybeStat(context, path, false);
          if (!stat) {
            if (parsed.flags.has("f")) return true;
            throw new FsError("ENOENT", { path });
          }
          if (stat.type === "directory" && !recursive && !parsed.flags.has("d")) throw new FsError("EISDIR", { path });
          if (interactive === "always") {
            const display = escapeText(operand, "display");
            if (stat.type === "directory" && recursive) {
              if (depth > MAX_RECURSIVE_DIRECTORY_DEPTH) throw new FsError("ELOOP", { path });
              const entries = await readDirectory(context, path, true);
              if (entries.length) {
                if (!await confirm(`descend into directory '${display}'`)) return false;
                let removed = true;
                for (const entry of entries) if (!await remove(childOperand(operand, entry.name), depth + 1)) removed = false;
                if (!removed) return false;
              }
            }
            const type = stat.type === "file" ? stat.size === 0 ? "regular empty file" : "regular file" : stat.type === "symlink" ? "symbolic link" : "directory";
            if (!await confirm(`remove ${type} '${display}'`)) return false;
          }
          if (stat.type === "directory" && (!recursive || interactive === "always")) {
            try { await removeEmptyDirectory(context, path, readDirectory); }
            catch (error) {
              context.signal.throwIfAborted();
              if (!parsed.flags.has("f") || codeOf(error) !== "ENOENT") throw error;
            }
          } else {
            await context.fs.rm(path, { recursive, force: parsed.flags.has("f"), signal: context.signal });
          }
          if (parsed.flags.has("v")) await output(context, `removed '${escapeText(operand, "display")}'\n`);
          return true;
        };
        return await eachOperand(context, parsed.operands, async operand => { await remove(operand); });
      } finally { await answers.return(undefined); }
    }),
    define("rmdir", async context => {
      const parsed = options(context.args, "pv", { parents: "p", verbose: "v", "ignore-fail-on-non-empty": false });
      requireOperands(parsed.operands);
      await preflightOperands(context, parsed.operands, async operand => {
        let path = pathOf(context, operand);
        const stop = dirname(pathOf(context, operand.split("/").find(part => part && part !== ".") ?? operand));
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
        const stop = dirname(pathOf(context, operand.split("/").find(part => part && part !== ".") ?? operand));
        do {
          if (path === "/") throw new FsError("EBUSY", { path });
          try { await removeEmptyDirectory(context, path, readDirectory); }
          catch (error) {
            context.signal.throwIfAborted();
            if (parsed.flags.has("ignore-fail-on-non-empty") && codeOf(error) === "ENOTEMPTY") return;
            throw error;
          }
          if (parsed.flags.has("v")) await output(context, `rmdir: removing directory '${escapeText(path, "display")}'\n`);
          path = dirname(path);
        } while (parsed.flags.has("p") && path !== "/" && path !== stop);
      });
    }),
    define("ln", async context => {
      let ended = false;
      let optionValue = false;
      const args = context.args.map(argument => {
        if (optionValue) { optionValue = false; return argument; }
        if (argument === "--") ended = true;
        if (!ended && (argument === "-S" || argument === "--suffix" || argument === "-t" || argument === "--target-directory")) optionValue = true;
        return !ended && argument === "--backup" ? `--backup=${context.env.VERSION_CONTROL || "existing"}` : argument;
      });
      const parsed = options(args, "sfnTvbB:S:t:", { symbolic: "s", force: "f", "no-dereference": "n", "no-target-directory": "T", verbose: "v", backup: "B", suffix: "S", "target-directory": "t" });
      const targetDirectory = value(parsed, "t");
      if (targetDirectory !== undefined && parsed.flags.has("T")) throw new UsageError("cannot combine --target-directory and --no-target-directory");
      const control = value(parsed, "B") ?? (parsed.flags.has("b") ? context.env.VERSION_CONTROL || "existing" : "none");
      const modes: Readonly<Record<string, string>> = { none: "none", off: "none", numbered: "numbered", t: "numbered", existing: "existing", nil: "existing", simple: "simple", never: "simple" };
      const backupMode = Object.hasOwn(modes, control) ? modes[control]! : undefined;
      if (!backupMode) throw new UsageError(`invalid argument '${control}' for backup type`);
      const backupSuffix = value(parsed, "S") || context.env.SIMPLE_BACKUP_SUFFIX || "~";
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
        const replacing = (parsed.flags.has("f") || backupMode !== "none") && await maybeStat(context, destination, false);
        await admitFilesystemModes(context, "ln", [symbolic ? "symbolic" : "hard", ...replacing ? [backupMode !== "none" ? "backup" : "replace"] : []], [destination]);
      });
      return eachOperand(context, operands.slice(0, -1), async operand => {
        const destination = directory ? joinPath(target, basename(operand)) : target;
        const source = pathOf(context, operand);
        if (!symbolic && source === destination) throw new FsError("EEXIST", { path: destination });
        const existing = await maybeStat(context, destination, false);
        let backup: string | undefined;
        if (existing && (parsed.flags.has("f") || backupMode !== "none")) {
          if (existing.type === "directory") throw new FsError("EISDIR", { path: destination });
          if (!symbolic) {
            await context.fs.stat(source, { signal: context.signal });
            const sourceEntry = joinPath(await context.fs.realpath(dirname(source), { signal: context.signal }), basename(source));
            const targetEntry = joinPath(await context.fs.realpath(dirname(destination), { signal: context.signal }), basename(destination));
            if (sourceEntry === targetEntry) throw new FsError("EEXIST", { path: destination, message: "source and destination are the same file" });
          }
          if (backupMode !== "none") {
            let largest = 0n;
            if (backupMode !== "simple") {
              const prefix = basename(destination) + ".~";
              for (const entry of await readDirectory(context, dirname(destination))) {
                if (!entry.name.startsWith(prefix) || !entry.name.endsWith("~")) continue;
                const digits = entry.name.slice(prefix.length, -1);
                if (!digits || !Array.from(digits).every(char => char >= "0" && char <= "9")) continue;
                const number = BigInt(digits);
                if (number > largest) largest = number;
              }
            }
            backup = backupMode === "numbered" || largest > 0n ? `${destination}.~${largest + 1n}~` : destination + backupSuffix;
            if (backup === source || backup === destination) throw new FsError("EINVAL", { path: backup, message: "backup would overwrite source or destination" });
            const backupStat = await maybeStat(context, backup, false);
            if (!symbolic && backupStat) {
              const sourceStat = await context.fs.stat(source, { signal: context.signal });
              if (await compareObservedEntries(context.fs, source, sourceStat, context.fs, backup, backupStat, { signal: context.signal }) !== "distinct") throw new FsError("EINVAL", { path: backup, message: "backup would overwrite source" });
            }
            await admitFilesystemModes(context, "ln", ["backup"], [destination, backup]);
            await context.fs.rename(destination, backup, { signal: context.signal });
          } else await context.fs.rm(destination, { signal: context.signal });
        }
        try {
          if (symbolic) await context.fs.symlink!(operand, destination, { signal: context.signal });
          else await context.fs.link!(source, destination, { signal: context.signal });
        } catch (error) {
          if (backup) await context.fs.rename(backup, destination, { signal: context.signal });
          throw error;
        }
        if (parsed.flags.has("v")) {
          const displayTarget = directory ? childOperand(operands.at(-1)!, basename(operand)) : operands.at(-1)!;
          await output(context, `'${escapeText(displayTarget, "display")}' ${symbolic ? "->" : "=>"} '${escapeText(operand, "display")}'\n`);
        }
      });
    }),
    define("readlink", async context => {
      const canonicalOptions: Record<string, string> = { canonicalize: "f", "canonicalize-existing": "e", "canonicalize-missing": "m" };
      const parsed = options(context.args, "femnz", { ...canonicalOptions, zero: "z", "no-newline": "n" });
      requireOperands(parsed.operands);
      if (parsed.flags.has("n") && parsed.operands.length > 1) {
        await diagnostic(context, new PublicDiagnostic("ignoring --no-newline with multiple arguments"));
      }
      let mode = "link";
      for (const argument of context.args) {
        if (argument === "--") break;
        const flags = argument.startsWith("--") ? canonicalOptions[argument.slice(2)] ?? ""
          : argument.startsWith("-") ? argument.slice(1) : "";
        for (const flag of flags) if (flag === "f" || flag === "e" || flag === "m") mode = flag;
      }
      return eachOperand(context, parsed.operands, async operand => {
        const path = pathOf(context, operand);
        await admitFilesystemModes(context, "readlink", [mode === "link" ? "link" : "canonical"], [path]);
        let result: string;
        if (mode === "m") result = await canonicalizeReadlinkMissing(context, path);
        else if (mode === "e") result = await context.fs.realpath(path, { signal: context.signal });
        else if (mode === "f") {
          const existing = await maybeStat(context, path, false);
          result = existing ? await context.fs.realpath(path, { signal: context.signal }) : joinPath(await context.fs.realpath(dirname(path), { signal: context.signal }), basename(path));
        } else {
          needCapability(context, "readlink");
          result = await context.fs.readlink!(path, { signal: context.signal });
        }
        await output(context, result + (parsed.flags.has("n") && parsed.operands.length === 1 ? "" : parsed.flags.has("z") ? "\0" : "\n"));
      });
    }),
    define("realpath", async context => {
      const args: string[] = [];
      const relative = new Map<string, string>();
      let ended = false;
      for (let index = 0; index < context.args.length; index++) {
        const argument = context.args[index]!;
        if (argument === "--") ended = true;
        const key = argument.split("=", 1)[0]!;
        if (!ended && (key === "--relative-to" || key === "--relative-base")) {
          const equals = argument.indexOf("=");
          const directory = equals < 0 ? context.args[++index] : argument.slice(equals + 1);
          if (directory === undefined) throw new UsageError(`option '${key}' requires an argument`);
          relative.set(key, directory);
        } else args.push(argument);
      }
      const parsed = options(args, "emsz", { "canonicalize-existing": "e", "canonicalize-missing": "m", strip: "s", "no-symlinks": "s", zero: "z" });
      requireOperands(parsed.operands);
      const canonical = async (operand: string): Promise<string> => {
        const path = pathOf(context, operand);
        if (parsed.flags.has("s")) {
          context.signal.throwIfAborted();
          const lexical = normalizePath(path);
          if (!parsed.flags.has("m")) {
            let prefix = "/";
            const components = path.split("/");
            for (let index = 1; index < components.length; index++) {
              const component = components[index]!;
              if (!component || component === "." && index < components.length - 1) continue;
              if (component === ".." || component === ".") {
                const parent = await context.fs.stat(prefix, { signal: context.signal });
                if (parent.type !== "directory") throw new FsError("ENOTDIR", { path: prefix });
              }
              prefix = normalizePath(component, prefix);
              if (parsed.flags.has("e") || index < components.length - 1) {
                const stat = parsed.flags.has("e") ? await context.fs.stat(prefix, { signal: context.signal }) : await maybeStat(context, prefix);
                if (index < components.length - 1 && stat !== undefined && stat.type !== "directory") throw new FsError("ENOTDIR", { path: prefix });
              }
            }
            if (parsed.flags.has("e")) await context.fs.stat(lexical, { signal: context.signal });
          }
          return lexical;
        }
        await admitFilesystemModes(context, "realpath", ["canonical"], [path]);
        const existing = await maybeStat(context, path, false);
        return parsed.flags.has("m") ? await canonicalMissing(context, path, "realpath")
          : parsed.flags.has("e") || existing ? await context.fs.realpath(path, { signal: context.signal })
          : joinPath(await context.fs.realpath(dirname(path), { signal: context.signal }), basename(path));
      };
      const baseOperand = relative.get("--relative-base");
      const toOperand = relative.get("--relative-to") ?? baseOperand;
      const base = baseOperand === undefined ? undefined : await canonical(baseOperand);
      const to = toOperand === undefined ? undefined : await canonical(toOperand);
      return eachOperand(context, parsed.operands, async operand => {
        const resolved = await canonical(operand);
        const display = to !== undefined && (base === undefined || isPathWithin(base, to) && isPathWithin(base, resolved))
          ? relativePath(to, resolved) || "." : resolved;
        await output(context, display + (parsed.flags.has("z") ? "\0" : "\n"));
      });
    }),
    define("ls", async context => {
      let sort: "name" | "time" | "size" = "name";
      let indicator: "none" | "slash" | "file-type" | "classify" = "none";
      let ended = false;
      const args: string[] = [];
      for (let index = 0; index < context.args.length; index++) {
        const argument = context.args[index]!;
        if (!ended && (argument === "--sort" || argument.startsWith("--sort="))) {
          const selection = argument === "--sort" ? context.args[++index] : argument.slice(7);
          if (selection !== "time" && selection !== "size") throw new UsageError("--sort requires 'time' or 'size'");
          sort = selection;
          args.push(selection === "time" ? "-t" : "-S");
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
        args.push(argument);
        if (argument === "--") ended = true;
        if (!ended && argument.startsWith("-") && !argument.startsWith("--")) for (const flag of argument.slice(1)) {
          if (flag === "t") sort = "time";
          else if (flag === "S") sort = "size";
          else if (flag === "F") indicator = "classify";
          else if (flag === "p") indicator = "slash";
        }
      }
      const parsed = options(args, "aAl1dFprRLhtSQ", { "quote-name": "Q", all: "a", "almost-all": "A", directory: "d", classify: "F", reverse: "r", recursive: "R", dereference: "L", "human-readable": "h" });
      const formatName = (name: string): string => {
        if (!parsed.flags.has("Q")) return escapeText(name, "display");
        let quoted = '"';
        for (const character of name) {
          quoted += character === '"' ? '\\"' : character === "\x07" ? "\\a" : escapeText(character, "display");
        }
        return quoted + '"';
      };
      const operands = parsed.operands.length ? parsed.operands : ["."];
      interface ListingEntry { path: string; display: string; stat: FileStat }
      let outputWritten = false;
      const inspect = async (path: string, display: string, operand = false): Promise<ListingEntry> => {
        await admitFilesystemModes(context, "ls", ["entry"], [path]);
        let stat = await context.fs[parsed.flags.has("L") ? "stat" : "lstat"](path, { signal: context.signal });
        context.signal.throwIfAborted();
        if (operand && stat.type === "symlink" && !parsed.flags.has("L") && !parsed.flags.has("d") && !parsed.flags.has("l") && indicator !== "classify") {
          try {
            const target = await context.fs.stat(path, { signal: context.signal });
            if (target.type === "directory") stat = target;
          } catch (error) { context.signal.throwIfAborted(); if (codeOf(error) !== "ENOENT") throw error; }
          context.signal.throwIfAborted();
        }
        return { path, display, stat };
      };
      const order = async (entries: ListingEntry[], lexical = false): Promise<void> => {
        await yieldTurn(context.signal);
        if (sort !== "name" || !lexical) entries.sort((left, right) => {
          context.signal.throwIfAborted();
          if (sort !== "name") {
            const key = sort === "time" ? "mtimeMs" : "size";
            if (left.stat[key] > right.stat[key]) return -1;
            if (left.stat[key] < right.stat[key]) return 1;
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
      const suffixFor = (stat: FileStat): string => {
        if (stat.type === "directory" && indicator !== "none") return "/";
        if ((indicator === "file-type" || indicator === "classify") && stat.type === "symlink") return "@";
        if (indicator === "classify" && stat.type === "file" && stat.mode & 0o111) return "*";
        return "";
      };
      const render = async ({ path, display, stat }: ListingEntry): Promise<void> => {
        let suffix = suffixFor(stat);
        if (parsed.flags.has("l")) {
          let size = parsed.flags.has("h") ? humanSize(stat.size, path) : String(stat.size);
          const date = new Date(stat.mtimeMs).toISOString().slice(0, 16).replace("T", " ");
          let target = "";
          if (stat.type === "symlink") {
            await admitFilesystemModes(context, "ls", ["link"], [path]);
            needCapability(context, "readlink");
            const link = await context.fs.readlink!(path, { signal: context.signal });
            const targetStat = indicator === "none" || indicator === "slash" ? undefined : await maybeStat(context, path);
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
          await output(context, `${modeText(stat)} ${stat.nlink ?? 1} ${stat.uid ?? 0} ${stat.gid ?? 0} ${size} ${date} ${formatName(display)}${suffix}${target}\n`);
        } else await output(context, `${formatName(display)}${suffix}\n`);
        outputWritten = true;
      };
      const list = async ({ path, display }: ListingEntry, header: boolean, ancestors = new Set<string>()): Promise<void> => {
        context.signal.throwIfAborted();
        await admitFilesystemModes(context, "ls", ["directory"], [path]);
        const physical = await context.fs.realpath(path, { signal: context.signal });
        if (ancestors.has(physical)) throw new FsError("ELOOP", { path });
        context.signal.throwIfAborted();
        if (ancestors.size > MAX_RECURSIVE_DIRECTORY_DEPTH) {
          throw new FsError("ELOOP", { path, message: `ls directory depth limit exceeded (${MAX_RECURSIVE_DIRECTORY_DEPTH})` });
        }
        ancestors.add(physical);
        try {
          if (header) { await output(context, `${outputWritten ? "\n" : ""}${formatName(display)}:\n`); outputWritten = true; }
          const entries = await readDirectory(context, path, true);
          const names = entries.map(entry => entry.name).filter(name => parsed.flags.has("a") || parsed.flags.has("A") || !name.startsWith("."));
          if (parsed.flags.has("a")) for (const name of [".", ".."]) {
            const index = names.findIndex(entry => entry > name);
            names.splice(index < 0 ? names.length : index, 0, name);
          }
          const children: ListingEntry[] = [];
          for (const [index, name] of names.entries()) {
            if (index % 128 === 0) await yieldTurn(context.signal);
            children.push(await inspect(joinPath(path, name), name));
          }
          await order(children, true);
          for (const child of children) await render(child);
          if (parsed.flags.has("R")) for (const child of children) {
            if (child.display === "." || child.display === "..") continue;
            if (child.stat.type === "directory") await list({ ...child, display: `${display.replace(/\/$/u, "")}/${child.display}` }, true, ancestors);
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
}
