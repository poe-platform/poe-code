import { bindConditionalMutation, tryGetMemoryDirectoryEntryNamesSync } from "@poe-code/safe-fs/core";
import {
  basename, dirname, FsError, isPathWithin, joinPath, normalizePath, relativePath,
  readBytes, writeBytes, type CommandContext, type CommandDefinition, type FileStat, type FileSystem,
} from "../contracts/index.js";
import { codeOf, define, diagnostic, eachOperand, lines, options, output, pathOf, requireOperands, UsageError, value } from "./internal.js";
import { escapeText, quoteShellOperand } from "../escaping.js";
import { compareCopyIdentity, compareObservedEntries } from "./copy-identity.js";
import { copyCheckedSource, admitCopySource, admitCopyDestination } from "./copy-source.js";
import { MoveBudget, moveAcrossDevices } from "./move.js";
import { admitFilesystemModes, filesystemCommandRequirements } from "./filesystem-requirements.js";
import { createDirectoryReader, type DirectoryReader } from "./directory-admission.js";
import { yieldTurn } from "../contracts/yield.js";
import { PublicDiagnostic } from "../diagnostics.js";
import { touchTimes } from "./touch-times.js";
import { touchTarget } from "./touch-target.js";
import { canonicalizeReadlinkMissing } from "./readlink-missing.js";
import { canonicalizeExistingParent } from "./canonicalize-existing-parent.js";
import { modeChange } from "./metadata/chmod.js";
import { creationUmask, getRuntimeBackingFileSystem } from "../fs/creation-mask.js";
import { backupCopyTarget, copyOptions, matchBackupMode, normalizeBackupSuffix } from "./copy-backup.js";
import { admitCopyPreservation, preserveCopyMetadata, type CopyOptions } from "./copy-preserve.js";

// Operand directories start at depth zero; files inside the last admitted
// directory do not consume another directory-recursion level.
const MAX_RECURSIVE_DIRECTORY_DEPTH = 1024;
const MKDIR_LONG_OPTIONS = Object.freeze({ parents: "p", mode: "m", verbose: "v" } as const);
const TOUCH_LONG_OPTIONS = Object.freeze({ "no-create": "c", "no-dereference": "h", reference: "r", date: "d", time: "time:" } as const);
const MV_LONG_OPTIONS = Object.freeze({
  force: "f", interactive: "i", "no-clobber": "n", update: "u", verbose: "v", backup: "backup:", suffix: "S",
  "no-target-directory": "T", "target-directory": "t",
} as const);
const RM_LONG_OPTIONS = Object.freeze({ recursive: "r", force: "f", dir: "d", verbose: "v" } as const);
const RMDIR_LONG_OPTIONS = Object.freeze({ parents: "p", verbose: "v", "ignore-fail-on-non-empty": false } as const);

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
  // Copy-target resolution folds missing suffixes lexically. Missing-mode
  // canonicalization must instead resume symlink traversal after each '..'.
  if (mode === "realpath" && (path.split("/").includes("..") || path !== "/" && path.endsWith("/"))) {
    return canonicalizeReadlinkMissing(context, path);
  }
  if (mode !== "copy") {
    context.signal.throwIfAborted();
    try {
      const canonical = context.fs.canonicalizeMissingTarget?.(path, { signal: context.signal });
      context.signal.throwIfAborted();
      if (canonical !== undefined) return canonical;
    } catch (error) {
      context.signal.throwIfAborted();
      if (mode === "realpath" && (codeOf(error) === "ENOENT" || codeOf(error) === "ELOOP")) {
        return canonicalizeReadlinkMissing(context, path);
      }
      // Copy-target hooks require directories; realpath -m does not.
      if (mode !== "realpath" || codeOf(error) !== "ENOTDIR") throw error;
    }
  }
  const originalPath = path;
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
      if (mode === "realpath" && codeOf(error) === "ELOOP") return canonicalizeReadlinkMissing(context, originalPath);
      if (codeOf(error) !== "ENOENT" && !(mode === "realpath" && codeOf(error) === "ENOTDIR") || path === "/") throw error;
      const link = await maybeStat(context, path, false, mode === "realpath");
      if (link?.type === "symlink") {
        if (mode === "realpath") return canonicalizeReadlinkMissing(context, originalPath);
        throw error;
      }
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

function childOperand(operand: string, name: string): string {
  while (operand.endsWith("/")) operand = operand.slice(0, -1);
  return `${operand}/${name}`;
}

async function copy(
  context: CommandContext, source: string, target: string,
  settings: CopyOptions, readDirectory: DirectoryReader, top = true, ancestors = new Set<string>(),
  preflight = false, displaySource = source, displayTarget = target, rootStat?: FileStat,
): Promise<void> {
  context.signal.throwIfAborted();
  const { flags, preserve: requestedPreserve, copiedLinks, backup } = settings;
  const attributesOnly = flags.has("attributes-only");
  const linkMode = flags.has("s") || flags.has("l");
  const link = await context.fs.lstat(source, { signal: context.signal });
  const preserveLink = link.type === "symlink" && (flags.has("P") || flags.has("H") && !top);
  // Archive copies preserve links without following them to mutate timestamps.
  // The filesystem contract currently has no no-follow timestamp operation.
  const preserve = flags.has("a") && preserveLink
    ? new Set([...requestedPreserve].filter(attribute => attribute !== "timestamps")) : requestedPreserve;
  const sourceStat = preserveLink ? link : await context.fs.stat(source, { signal: context.signal });
  rootStat ??= sourceStat;
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
  if (flags.has("u") && sourceStat.type !== "directory" && targetStat && targetStat.type !== "directory"
    && sourceStat.mtimeMs <= targetStat.mtimeMs) return;
  if (!preflight && !preserveLink && targetStat && await compareObservedEntries(context.fs, source, sourceStat, context.fs, target, targetStat, { signal: context.signal }) === "same") {
    throw new FsError("EINVAL", { path: source, dest: target, message: "source and destination are the same file" });
  }
  if (!preflight && sourceStat.type !== "directory" && targetStat && targetStat.type !== "directory"
    && settings.confirmOverwrite && !await settings.confirmOverwrite(displayTarget)) return;
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
    const capabilities = await context.fs.capabilitiesFor?.(target, { signal: context.signal }) ?? context.fs.capabilities;
    const directoryMode = capabilities.permissions === false ? undefined : sourceStat.mode & 0o777;
    const temporaryMode = !targetStat && directoryMode !== undefined && (directoryMode & 0o700) !== 0o700;
    if (temporaryMode) {
      await admitFilesystemModes(context, "cp", ["mode"], [target]);
      if (!context.fs.chmod) throw new FsError("ENOTSUP", { syscall: "chmod", path: target });
    }
    let created = false;
    ancestors.add(physicalSource);
    try {
      if (!targetStat && !preflight) {
        await context.fs.mkdir(target, {
          ...(directoryMode === undefined ? {} : { mode: directoryMode | (temporaryMode ? 0o700 : 0) }),
          signal: context.signal,
        });
        created = true;
      }
      // Unknown identity must not turn into an asserted filesystem boundary.
      const crossDevice = flags.has("x") && !top
        && compareCopyIdentity(rootStat, rootStat) === "same"
        && compareCopyIdentity(sourceStat, sourceStat) === "same"
        && (rootStat.identityScope !== sourceStat.identityScope || rootStat.dev !== sourceStat.dev);
      for (const entry of crossDevice ? [] : await readDirectory(context, source, true)) {
        await copy(context, joinPath(source, entry.name), joinPath(target, entry.name), settings, readDirectory, false, ancestors, preflight,
          childOperand(displaySource, entry.name), childOperand(displayTarget, entry.name), rootStat);
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
      const capabilities = await context.fs.capabilitiesFor?.(target, { creation: "exclusive", signal: context.signal }) ?? context.fs.capabilities;
      context.signal.throwIfAborted();
      await context.fs.writeFile(target, new Uint8Array(), {
        flag: "wx", ...(capabilities.permissions === false ? {} : { mode: sourceStat.mode & 0o777 }), signal: context.signal,
      });
    }
  } else {
    await admitCopySource(context, physicalSource);
    const exclusive = removeDestination || backup !== undefined;
    const publication = await admitCopyDestination(context, target, exclusive || !targetStat);
    const replace = removeDestination || flags.has("f") && targetStat !== undefined && targetStat.type !== "character";
    await admitFilesystemModes(context, "cp", [publication === "buffer" ? "file-create" : "file", ...replace ? ["replace", "exclusive"] : exclusive ? ["exclusive"] : []], [target], false,
      exclusive || publication === "buffer" ? "exclusive" : undefined);
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
      await copyCheckedSource(context, physicalSource, target, sourceStat, exclusive || publication === "buffer");
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
      await copyCheckedSource(context, physicalSource, target, sourceStat, true);
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
      const parsed = options(context.args, "pm:v", MKDIR_LONG_OPTIONS);
      requireOperands(parsed.operands);
      const mode = value(parsed, "m");
      const mask: unknown = Reflect.get(context.fs, creationUmask);
      const umask = typeof mask === "number" ? mask : 0o022;
      const directoryMode = mode === undefined ? undefined : modeChange(mode, umask)({ type: "directory", mode: 0o777 & ~umask });
      if (
        parsed.operands.length === 1 &&
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
          const operand = parsed.operands[0]!;
          const path = pathOf(context, operand);
          if (path !== "/dev" && !path.startsWith("/dev/")) {
            const recursive = parsed.flags.has("p");
            try {
              await admitFilesystemModes(context, "mkdir", [recursive ? "parents" : "directory"], [path]);
              await context.fs.mkdir(path, { recursive, ...(caps.permissions !== false ? { mode: 0o777 & ~umask } : {}), signal: context.signal });
              return { exitCode: 0 };
            } catch (error) {
              await diagnostic(context, error);
              return { exitCode: 1 };
            }
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
    }),
    define("touch", async context => {
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
      const answers = lines(readBytes(context.stdin, context.signal));
      let declined = false;
      const settings: CopyOptions = {
        ...parsed,
        ...parsed.flags.has("i") ? { confirmOverwrite: async (operand: string): Promise<boolean> => {
          await writeBytes(context.stderr, new TextEncoder().encode(`cp: overwrite ${quoteShellOperand(operand)}? `), context.signal);
          const answer = await answers.next();
          const first = answer.done ? undefined : answer.value.bytes[0];
          const accepted = first === 0x79 || first === 0x59;
          if (!accepted) declined = true;
          return accepted;
        } } : {},
      };
      try {
        const result = await eachOperand(context, destination.sources, async operand => {
          const source = pathOf(context, operand);
          const targetOperand = destination.targetOperand;
          await copy(context, source, destination.directory ? joinPath(destination.target, basename(source)) : destination.target,
            settings, readDirectory, true, new Set(), false, operand,
            destination.directory ? childOperand(targetOperand, basename(source)) : targetOperand);
        });
        return { exitCode: declined ? 1 : result.exitCode };
      } finally { await answers.return(undefined); }
    }),
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
      const parsed = options(args, "rRfdviI", RM_LONG_OPTIONS);
      if (force) parsed.flags.add("f"); else parsed.flags.delete("f");
      if (!parsed.flags.has("f")) requireOperands(parsed.operands);
      const recursive = parsed.flags.has("r") || parsed.flags.has("R");
      const backingMem = getRuntimeBackingFileSystem(context.fs) as { symlinkCount?: number; capabilitiesFor?: unknown } | undefined;
      const caps = context.fs.capabilities;
      const fastStockMemory =
        interactive === "never" &&
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
    define("readlink", async context => {
      const canonicalOptions: Record<string, string> = { canonicalize: "f", "canonicalize-existing": "e", "canonicalize-missing": "m" };
      let verboseMode = "default" as "default" | "verbose" | "quiet";
      const parsed = options(context.args, "femnzvqs", { ...canonicalOptions, zero: "z", "no-newline": "n", verbose: "v", quiet: "q", silent: "s" }, false, undefined, undefined, key => {
        if (key === "v") verboseMode = "verbose";
        else if (key === "q" || key === "s") verboseMode = "quiet";
      });
      requireOperands(parsed.operands);
      if (parsed.flags.has("n") && parsed.operands.length > 1 && verboseMode !== "quiet") {
        await diagnostic(context, new PublicDiagnostic("ignoring --no-newline with multiple arguments"));
      }
      let mode = "link";
      for (const argument of context.args) {
        if (argument === "--") break;
        const flags = argument.startsWith("--") ? canonicalOptions[argument.slice(2)] ?? ""
          : argument.startsWith("-") ? argument.slice(1) : "";
        for (const flag of flags) if (flag === "f" || flag === "e" || flag === "m") mode = flag;
      }
      const operandContext = verboseMode === "quiet"
        ? { ...context, stderr: { async write() {} } }
        : verboseMode === "default"
        ? { ...context, stderr: { async write(bytes: Uint8Array) {
            const text = new TextDecoder().decode(bytes);
            if (!text.includes("EINVAL") && !text.includes("ENOENT")) await context.stderr.write(bytes);
          } } }
        : context;
      return eachOperand(operandContext, parsed.operands, async operand => {
        const path = pathOf(context, operand);
        await admitFilesystemModes(context, "readlink", [mode === "link" ? "link" : "canonical"], [path]);
        let result: string;
        if (mode === "m") result = await canonicalizeReadlinkMissing(context, path);
        else if (mode === "e") result = await context.fs.realpath(path, { signal: context.signal });
        else if (mode === "f") result = await canonicalizeExistingParent(context, path);
        else {
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
      let mode = "E";
      let traversal = "P";
      let strip = false;
      const parsed = options(args, "EemszLPq", {
        canonicalize: "E", "canonicalize-existing": "e", "canonicalize-missing": "m",
        logical: "L", physical: "P", quiet: "q", strip: "s", "no-symlinks": "s", zero: "z",
      }, false, undefined, undefined, key => {
        if (key === "E" || key === "e" || key === "m") mode = key;
        if (key === "L") traversal = "L";
        if (key === "P") { traversal = "P"; strip = false; }
        if (key === "s") strip = true;
      });
      requireOperands(parsed.operands);
      const canonical = async (operand: string): Promise<string> => {
        let path = pathOf(context, operand);
        if (strip || traversal === "L") {
          context.signal.throwIfAborted();
          const lexical = normalizePath(path);
          if (mode !== "m") {
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
              if (mode === "e" || index < components.length - 1) {
                const stat = mode === "e" ? await context.fs.stat(prefix, { signal: context.signal }) : await maybeStat(context, prefix);
                if (index < components.length - 1 && stat !== undefined && stat.type !== "directory") throw new FsError("ENOTDIR", { path: prefix });
              }
            }
            if (mode === "e") await context.fs.stat(lexical, { signal: context.signal });
          }
          if (strip) return lexical;
          path = lexical;
        }
        await admitFilesystemModes(context, "realpath", ["canonical"], [path], mode === "m");
        if (mode === "m") {
          try { await maybeStat(context, path, false, true); }
          catch (error) {
            context.signal.throwIfAborted();
            if (codeOf(error) !== "ELOOP") throw error;
            return canonicalizeReadlinkMissing(context, path);
          }
        }
        return mode === "m" ? await canonicalMissing(context, path, "realpath")
          : mode === "e" ? await context.fs.realpath(path, { signal: context.signal })
          : await canonicalizeExistingParent(context, path);
      };
      const baseOperand = relative.get("--relative-base");
      const toOperand = relative.get("--relative-to") ?? baseOperand;
      let base: string | undefined;
      let to: string | undefined;
      try {
        base = baseOperand === undefined ? undefined : await canonical(baseOperand);
        to = toOperand === undefined ? undefined : await canonical(toOperand);
      } catch (error) {
        context.signal.throwIfAborted();
        if (!parsed.flags.has("q")) await diagnostic(context, error);
        return { exitCode: 1 };
      }
      const operandContext = parsed.flags.has("q") ? { ...context, stderr: { async write() {} } } : context;
      return eachOperand(operandContext, parsed.operands, async operand => {
        const resolved = await canonical(operand);
        const display = to !== undefined && (base === undefined || isPathWithin(base, to) && isPathWithin(base, resolved))
          ? relativePath(to, resolved) || "." : resolved;
        await output(context, display + (parsed.flags.has("z") ? "\0" : "\n"));
      });
    }),
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
        if (ancestors.size > MAX_RECURSIVE_DIRECTORY_DEPTH) {
          throw new FsError("ELOOP", { path, message: `ls directory depth limit exceeded (${MAX_RECURSIVE_DIRECTORY_DEPTH})` });
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
}
