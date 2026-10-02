import { basename, dirname, FsError, isPathWithin, joinPath, readBytes, writeBytes, commandRuntimeIdentity, type CommandContext, type CommandDefinition, type FileStat, type VirtualShellPlugin } from "safe-bash-contracts";
import { codeOf, define, eachOperand, lines, output, pathOf, UsageError, value } from "safe-bash-io-engine/internal";
import { escapeText, quoteShellOperand } from "safe-bash-contracts/escaping";
import { compareCopyIdentity, compareObservedEntries } from "safe-bash-contracts/filesystem-identity";
import { copyCheckedSource, admitCopySource, admitCopyDestination } from "safe-bash-io-engine/commands/copy-source";
import { admitFilesystemModes, filesystemCommandRequirements } from "safe-bash-io-engine/commands/filesystem-requirements";
import { createDirectoryReader, type DirectoryReader } from "safe-bash-io-engine/commands/directory-admission";
import { preflightOperands, maybeStat, needCapability, destinations, childOperand } from "safe-bash-io-engine/commands/filesystem-operands";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { backupCopyTarget } from "./copy-backup.js";
import { copyOptions } from "./copy-options.js";
import { admitCopyPreservation, preserveCopyMetadata, type CopyOptions } from "./copy-preserve.js";

async function canonicalMissing(
  context: CommandContext, path: string, mode: "copy" | "preflight" = "copy",
): Promise<string> {
  if (mode !== "copy") {
    context.signal.throwIfAborted();
    try {
      const canonical = context.fs.canonicalizeMissingTarget?.(path, { signal: context.signal });
      context.signal.throwIfAborted();
      if (canonical !== undefined) return canonical;
    } catch (error) {
      context.signal.throwIfAborted();
      throw error;
    }
  }
  const suffix: string[] = [];
  let canonical: string;
  while (true) {
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
    canonical = joinPath(canonical, suffix[index]!);
  }
  return canonical;
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
    if (ancestors.size > (settings.maxRecursiveDirectoryDepth ?? Infinity)) {
      throw new FsError("ELOOP", { path: source, message: `cp directory depth limit exceeded (${settings.maxRecursiveDirectoryDepth})` });
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

export interface CpLimits {
  readonly maxDirectoryEntries: number;
  readonly maxRecursiveDirectoryDepth: number;
}
export interface CpCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<CpLimits>;
}
export function createCpCommand(configuration: CpCommandsOptions = {}): CommandDefinition {
  const maxDirectoryEntries = configuration.limits?.maxDirectoryEntries;
  const maxRecursiveDirectoryDepth = configuration.limits?.maxRecursiveDirectoryDepth ?? Infinity;
  if (maxRecursiveDirectoryDepth !== Infinity && (!Number.isSafeInteger(maxRecursiveDirectoryDepth) || maxRecursiveDirectoryDepth < 0)) {
    throw new RangeError("maxRecursiveDirectoryDepth must be a nonnegative safe integer or Infinity");
  }
  const readDirectory = createDirectoryReader(maxDirectoryEntries);
  return { ...define("cp", async context => {
      const parsed = { ...copyOptions(context), maxRecursiveDirectoryDepth };
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
    }), runtimeIdentity: commandRuntimeIdentity, filesystemRequirements: filesystemCommandRequirements.cp };
}
export function createCpCommands(options: CpCommandsOptions = {}): readonly CommandDefinition[] {
  return [createCpCommand(options)];
}
export function cpCommands(options: CpCommandsOptions = {}): VirtualShellPlugin {
  const commands = createCpCommands(options);
  return {
    name: "cp-commands",
    setup(host) {
      if (!options.replace) for (const command of commands) {
        if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
      }
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}
