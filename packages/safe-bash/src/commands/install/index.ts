import { FsError, basename, dirname, readBytes, writeBytes, type ByteSource, type CommandContext, type CommandDefinition, type FileStat, type FileSystemCapabilities, type VirtualShellPlugin } from "../../contracts/index.js";
import { commandRuntimeIdentity } from "../../contracts/command.js";
import { retainFileSystemCleanup } from "@poe-code/safe-fs/core";
import { assertCountedFileOutput, openFileOutput, writeFileOutputCounted } from "../../contracts/filesystem-output.js";
import { yieldTurn } from "../../contracts/yield.js";
import { codeOf, output, pathOf } from "../internal.js";
import { compareCopyIdentity, compareObservedEntries } from "../copy-identity.js";
import { helpText, parseArguments, type InstallArguments } from "./arguments.js";
import { parseMode, type InstallMode } from "./mode.js";
import { InstallError, quote, type InstallCommandsOptions, type InstallModeRequest } from "./options.js";
export type { InstallCommandsOptions, InstallContextRequest, InstallModeRequest } from "./options.js";

type SourceDescriptor = Awaited<ReturnType<NonNullable<CommandContext["fs"]["open"]>>>;

const errorMessages: Readonly<Record<string, string>> = {
  ENOENT: "No such file or directory", EACCES: "Permission denied", EPERM: "Operation not permitted", EEXIST: "File exists",
  EISDIR: "Is a directory", ENOTDIR: "Not a directory", EROFS: "Read-only file system", ENOSPC: "No space left on device",
  ENOTSUP: "Operation not supported", EOPNOTSUPP: "Operation not supported", ELOOP: "Too many levels of symbolic links",
  EFBIG: "File too large", EIO: "Input/output error", EINVAL: "Invalid argument", ENOTEMPTY: "Directory not empty",
};

function failure(message: string, error: unknown): InstallError {
  const code = codeOf(error);
  return new InstallError(`${message}: ${code && errorMessages[code] || (error instanceof Error ? error.message : String(error))}`);
}

async function maybeStat(context: CommandContext, path: string, follow = false): Promise<FileStat | undefined> {
  try {
    const stat = await context.fs[follow ? "stat" : "lstat"](path, { signal: context.signal });
    context.signal.throwIfAborted();
    return stat;
  } catch (error) { context.signal.throwIfAborted(); if (codeOf(error) === "ENOENT") return undefined; throw error; }
}

async function admit(context: CommandContext, path: string, capabilities: readonly string[]): Promise<FileSystemCapabilities> {
  const check = (available: FileSystemCapabilities) => {
    if (available.readOnly) throw new FsError("EROFS");
    if (capabilities.some(capability => available[capability] === false)) throw new FsError("ENOTSUP");
  };
  const globalCapabilities = context.fs.capabilities;
  check(globalCapabilities);
  if (!context.fs.capabilitiesFor) return globalCapabilities;
  let candidate = path;
  while (true) {
    context.signal.throwIfAborted();
    try {
      const available = await context.fs.capabilitiesFor(candidate, { signal: context.signal });
      check(available);
      return available;
    }
    catch (error) { if (codeOf(error) !== "ENOENT" || candidate === "/") throw error; candidate = dirname(candidate); }
  }
}

async function account(context: CommandContext, text: string | undefined, kind: "user" | "group", settings: InstallCommandsOptions): Promise<number | undefined> {
  if (text === undefined) return undefined;
  const resolver = kind === "user" ? settings.resolveUser : settings.resolveGroup;
  let id = await resolver?.(text, context);
  context.signal.throwIfAborted();
  if (id === undefined) {
    let digits = text, base = 10;
    while (digits && " \t\n\r\v\f".includes(digits[0]!)) digits = digits.slice(1);
    if (digits.startsWith("+")) digits = digits.slice(1);
    if (digits.startsWith("0x") || digits.startsWith("0X")) { base = 16; digits = digits.slice(2); }
    else if (digits.startsWith("0") && digits.length > 1) { base = 8; digits = digits.slice(1); }
    if (!digits || !Array.from(digits).every(character => "0123456789abcdef".indexOf(character.toLowerCase()) >= 0 && "0123456789abcdef".indexOf(character.toLowerCase()) < base)) {
      if (!resolver && text && !"+-0123456789".includes(text[0]!)) throw new InstallError(`cannot resolve ${kind} ${quote(text)}: Operation not supported (account database unavailable)`);
      throw new InstallError(`invalid ${kind} ${quote(text)}`);
    }
    id = Number.parseInt(digits, base);
  }
  if (!Number.isSafeInteger(id) || id < 0 || id > 4294967295) throw new InstallError(`invalid ${kind} ${quote(text)}`);
  return id === 4294967295 ? undefined : id;
}

interface Operation {
  readonly context: CommandContext;
  readonly args: InstallArguments;
  readonly settings: InstallCommandsOptions;
  readonly modes: InstallMode;
  readonly uid: number | undefined;
  readonly gid: number | undefined;
  readonly maxFileBytes: number;
}

async function setPermissions(operation: Operation, path: string, display: string, mode: number, kind: InstallModeRequest["kind"], change: boolean): Promise<void> {
  const { context, settings } = operation, fsOptions = { signal: context.signal };
  let directorySearchable = false;
  if (kind !== "file" && (mode & 0o2000) !== 0 && !settings.setMode) {
    try { await context.fs.access(path, 1, fsOptions); directorySearchable = true; }
    catch (error) { context.signal.throwIfAborted(); if (!["EACCES", "EPERM", "ENOTSUP", "EOPNOTSUPP"].includes(codeOf(error) ?? "")) throw error; }
  }
  try {
    if (change) {
      if (settings.setMode) await settings.setMode({ path, mode, kind }, context);
      else await context.fs.chmod!(path, mode, fsOptions);
    }
    context.signal.throwIfAborted();
  }
  catch (error) { throw failure(`cannot change permissions of ${quote(display)}`, error); }
  const actual = await context.fs.stat(path, fsOptions);
  const actualMode = actual.mode & 0o7777;
  const mayClearSetgid = kind !== "file" && (directorySearchable || settings.setMode !== undefined);
  if (actualMode !== mode && !(mayClearSetgid && actualMode === (mode & ~0o2000))) throw new InstallError(`cannot change permissions of ${quote(display)}: Operation not supported (backend did not retain requested mode)`);
}

async function attributes(operation: Operation, path: string, display: string, mode: number, source?: string, directoryStat?: FileStat, createdDirectory = false): Promise<void> {
  const { context, args, settings, uid, gid } = operation;
  const ownershipChanges = uid !== undefined && uid !== directoryStat?.uid || gid !== undefined && gid !== directoryStat?.gid;
  if (ownershipChanges) {
    try { await settings.chown!(path, uid, gid, context); context.signal.throwIfAborted(); }
    catch (error) { throw failure(`cannot change ownership of ${quote(display)}`, error); }
  }
  const change = !directoryStat || (directoryStat.mode & 0o7777) !== mode || ownershipChanges && (directoryStat.mode & 0o6111) !== 0;
  await setPermissions(operation, path, display, mode, directoryStat ? createdDirectory ? "new-directory" : "existing-directory" : "file", change);
  if (settings.securityContext?.enabled && (args.contextMode !== "preserve" || source !== undefined)) {
    if (!settings.securityContext.apply) throw new InstallError(`cannot set context of ${quote(display)}: Operation not supported`);
    await settings.securityContext.apply({ path, mode: args.contextMode ?? "default", ...(source === undefined ? {} : { source }), ...(args.contextLabel === undefined ? {} : { label: args.contextLabel }) }, context);
    context.signal.throwIfAborted();
  }
}

async function directories(operation: Operation, display: string, final: boolean): Promise<void> {
  const { context, args, modes, uid, gid } = operation;
  if (!display) throw failure(`cannot create directory ${quote(display)}`, new FsError("ENOENT"));
  const parts = display.split("/");
  let current = display.startsWith("/") ? "/" : "";
  const components = parts.filter(Boolean);
  if (!components.length) components.push(".");
  for (let index = 0; index < components.length; index++) {
    current = current && current !== "/" ? `${current}/${components[index]}` : `${current}${components[index]}`;
    const path = pathOf(context, current), last = index === components.length - 1;
    try {
      await admit(context, path, ["stat", "mkdir", "permissions"]);
      const before = await maybeStat(context, path, true);
      if (before && before.type !== "directory") throw new FsError("ENOTDIR");
      if (!before) {
        let creationMode = final && last ? modes.directory : 0o755;
        if (final && last) {
          if (uid !== undefined || gid !== undefined) creationMode &= ~0o077;
          else if ((modes.directoryMask & 0o6000) !== 0 || (modes.directory & 0o1000) !== 0) creationMode &= ~0o022;
        }
        await context.fs.mkdir(path, { mode: creationMode, signal: context.signal });
        if (args.verbose) await output(context, `install: creating directory ${quote(current)}\n`);
        if (!(final && last)) {
          const created = await context.fs.stat(path, { signal: context.signal });
          await setPermissions(operation, path, current, 0o755, "new-directory", (created.mode & 0o7777) !== 0o755);
        }
      }
      if (final && last) {
        const currentStat = before ?? await context.fs.stat(path, { signal: context.signal });
        await attributes(operation, path, display, currentStat.mode & 0o7777 & ~modes.directoryMask | modes.directory, undefined, currentStat, !before);
      }
      context.signal.throwIfAborted();
    } catch (error) { if (error instanceof InstallError) throw error; throw failure(`cannot create directory ${quote(current)}`, error); }
  }
}

async function backup(operation: Operation, destination: string, display: string, original: FileStat, source: string, sourceStat: FileStat, sourceDisplay: string): Promise<string> {
  const { context, args, settings } = operation;
  let numbered = args.backup === "numbered", highest = 0n;
  if (args.backup === "numbered" || args.backup === "existing") {
    const prefix = `${basename(destination)}.~`;
    for (const entry of await context.fs.readdir(dirname(destination), { signal: context.signal })) {
      if (!entry.name.startsWith(prefix) || !entry.name.endsWith("~")) continue;
      const digits = entry.name.slice(prefix.length, -1);
      if (!digits || digits[0] === "0" || !Array.from(digits).every(character => character >= "0" && character <= "9")) continue;
      const version = BigInt(digits);
      if (version > highest) highest = version;
    }
    numbered ||= highest > 0n;
  }
  const suffix = numbered ? `.~${highest + 1n}~` : args.suffix;
  const target = `${destination}${suffix}`, targetDisplay = `${display}${suffix}`;
  const sourceConflict = () => new InstallError(`backing up ${quote(display)} might destroy source;  ${quote(sourceDisplay)} not copied`);
  if (target === destination) throw sourceConflict();
  const previous = await maybeStat(context, target);
  if (previous) {
    const identity = await compareObservedEntries(context.fs, source, sourceStat, context.fs, target, previous, { signal: context.signal });
    if (identity === "unknown") throw new InstallError(`cannot safely replace backup ${quote(targetDisplay)}: Operation not supported (unknown identity)`);
    if (identity === "same" && await context.fs.realpath(source, { signal: context.signal }) === await context.fs.realpath(target, { signal: context.signal })) throw sourceConflict();
  }
  await admit(context, destination, ["rename", "remove"]);
  try {
    if (!numbered) await context.fs.rename(destination, target, { signal: context.signal });
    else if (settings.renameExclusive) await settings.renameExclusive(destination, target, context);
    else if (original.type === "file" && context.fs.link && context.fs.capabilities.hardlinks !== false) {
      await context.fs.link(destination, target, { signal: context.signal });
      const current = await maybeStat(context, destination), saved = await maybeStat(context, target);
      if (!current || !saved || await compareObservedEntries(context.fs, destination, original, context.fs, destination, current, { signal: context.signal }) !== "same"
        || await compareObservedEntries(context.fs, destination, original, context.fs, target, saved, { signal: context.signal }) !== "same") throw new FsError("ENOTSUP", { message: "backup identity changed during publication" });
      await context.fs.rm(destination, { signal: context.signal });
    } else throw new FsError("ENOTSUP", { message: "exclusive backup movement unavailable" });
  } catch (error) { throw failure(`cannot backup ${quote(display)}`, error); }
  return targetDisplay;
}

async function sameContent(operation: Operation, source: string, sourceStat: FileStat, destination: string, destinationStat: FileStat): Promise<boolean> {
  const { context, settings, modes, uid, gid, args, maxFileBytes } = operation;
  if (sourceStat.type !== "file" || destinationStat.type !== "file" || ((sourceStat.mode | destinationStat.mode | modes.file) & 0o7000)
    || sourceStat.size !== destinationStat.size || (destinationStat.mode & 0o7777) !== modes.file) return false;
  const owner = uid ?? settings.identity?.uid, group = gid ?? settings.identity?.gid;
  if (owner === undefined || group === undefined || destinationStat.uid === undefined || destinationStat.gid === undefined) throw new InstallError("cannot compare ownership: Operation not supported (caller or file identity unavailable)");
  if (owner !== destinationStat.uid || group !== destinationStat.gid) return false;
  if (settings.securityContext?.enabled && args.contextMode === "preserve") {
    if (!settings.securityContext.matches) throw new InstallError("cannot compare security contexts: Operation not supported");
    if (!await settings.securityContext.matches(source, destination, context)) return false;
  }
  try {
    const left = await context.fs.readFile(source, { signal: context.signal, maxBytes: maxFileBytes });
    const right = await context.fs.readFile(destination, { signal: context.signal, maxBytes: maxFileBytes });
    context.signal.throwIfAborted();
    return left.length === right.length && left.every((value, index) => value === right[index]);
  } catch (error) { context.signal.throwIfAborted(); if (codeOf(error) === "EFBIG") throw error; return false; }
}

async function installFile(operation: Operation, sourceDisplay: string, destinationDisplay: string): Promise<void> {
  const { context, args, modes, settings, maxFileBytes } = operation;
  const fsOptions = { signal: context.signal };
  if (args.parents) await directories(operation, dirname(destinationDisplay), false);
  let source: string, destination: string;
  let sourceStat: FileStat;
  try { source = pathOf(context, sourceDisplay); sourceStat = await context.fs.stat(source, fsOptions); }
  catch (error) { throw failure(`cannot stat ${quote(sourceDisplay)}`, error); }
  if (sourceStat.type === "directory") throw new InstallError(`omitting directory ${quote(sourceDisplay)}`);
  if (!destinationDisplay) throw new InstallError(`cannot overwrite directory ${quote(destinationDisplay)} with non-directory ${quote(sourceDisplay)}`);
  try { destination = pathOf(context, destinationDisplay); }
  catch (error) { throw failure(`cannot create regular file ${quote(destinationDisplay)}`, error); }
  const target = await maybeStat(context, destination);
  if (target?.type === "directory") throw new InstallError(`cannot overwrite directory ${quote(destinationDisplay)} with non-directory ${quote(sourceDisplay)}`);
  if (target?.type === "file") {
    const identity = await compareObservedEntries(context.fs, source, sourceStat, context.fs, destination, target, fsOptions);
    if (identity === "unknown") throw new InstallError(`cannot establish source/destination identity: Operation not supported`);
    if (identity === "same" && await context.fs.realpath(source, fsOptions) === await context.fs.realpath(destination, fsOptions)) throw new InstallError(`${quote(sourceDisplay)} and ${quote(destinationDisplay)} are the same file`);
  }
  if (args.compare && target && await sameContent(operation, source, sourceStat, destination, target)) return;
  const destinationCapabilities = await admit(context, destination, ["write", "exclusiveCreate", "permissions", ...(target ? ["remove"] : [])]);
  const streamingOutput = !!context.fs.writeStream && destinationCapabilities.streamingWrite !== false;
  if (!streamingOutput) assertCountedFileOutput(context);
  const removeAfterStripFailure = args.strip ? retainFileSystemCleanup(context.fs, cleanup => cleanup.rm(destination), { maxOperations: 1 }) : undefined;
  if (sourceStat.type === "file" && sourceStat.size > maxFileBytes) throw failure(`cannot copy ${quote(sourceDisplay)}`, new FsError("EFBIG"));
  let backupDisplay: string | undefined;
  if (target) {
    if (args.backup !== "none") backupDisplay = await backup(operation, destination, destinationDisplay, target, source, sourceStat, sourceDisplay);
    else {
      try { await context.fs.rm(destination, fsOptions); }
      catch (error) { throw failure(`cannot remove ${quote(destinationDisplay)}`, error); }
      if (args.verbose) await output(context, `removed ${quote(destinationDisplay)}\n`);
    }
  }
  if (args.verbose) await output(context, `${quote(sourceDisplay)} -> ${quote(destinationDisplay)}${backupDisplay === undefined ? "" : ` (backup: ${quote(backupDisplay)})`}\n`);
  let closed = false, completion: Promise<void> | undefined, cleanupFailure: { reason: unknown } | undefined;
  let bufferedWrite: Promise<number> | undefined;
  let opening: Promise<SourceDescriptor> | undefined, descriptorClose: Promise<void> | undefined, timestampStat = sourceStat;
  let iterator: AsyncIterator<Uint8Array> | undefined, returned: Promise<IteratorResult<Uint8Array>> | undefined;
  const closeDescriptor = (): Promise<void> => descriptorClose ??= (async () => {
    let descriptor: SourceDescriptor | undefined;
    try { descriptor = await opening; } catch { return; }
    await descriptor?.close();
  })();
  const returnSource = (): Promise<IteratorResult<Uint8Array>> => returned ??= Promise.resolve().then(() => iterator?.return ? iterator.return() : { done: true as const, value: undefined });
  const sourceBytes = (async function* () {
    if (closed) throw new FsError("EBADF");
    let chunks: ByteSource;
    const capabilities = await context.fs.capabilitiesFor?.(source, fsOptions) ?? context.fs.capabilities;
    context.signal.throwIfAborted();
    if (closed) throw new FsError("EBADF");
    if (context.fs.open && capabilities.open !== false) {
      opening = context.fs.open(source, { ...fsOptions, access: "read", creation: "never" });
      const descriptor = await opening;
      context.signal.throwIfAborted();
      if (closed) throw new FsError("EBADF");
      let openedStat: FileStat;
      try { openedStat = await descriptor.stat(fsOptions); }
      catch (error) { throw failure(`cannot fstat ${quote(sourceDisplay)}`, error); }
      const identity = compareCopyIdentity(sourceStat, openedStat);
      if (identity === "distinct") throw new InstallError(`skipping file ${quote(sourceDisplay)}, as it was replaced while being copied`);
      if (identity === "unknown") throw new InstallError("cannot establish opened source identity: Operation not supported");
      if (args.preserve && !args.strip && sourceStat.type === "file") timestampStat = openedStat;
      chunks = (async function* () {
        const buffer = new Uint8Array(65536);
        while (true) {
          context.signal.throwIfAborted();
          if (closed) throw new FsError("EBADF");
          const count = await descriptor.read(buffer, null, fsOptions);
          if (!Number.isSafeInteger(count) || count < 0 || count > buffer.length) throw new FsError("EIO");
          if (!count) return;
          yield buffer.subarray(0, count);
        }
      })();
    } else chunks = context.fs.readStream && capabilities.streamingRead !== false ? context.fs.readStream(source, fsOptions)
      : (async function* () { yield await context.fs.readFile(source, { ...fsOptions, maxBytes: maxFileBytes }); })();
    iterator = chunks[Symbol.asyncIterator]();
    let size = 0, untilYield = 65536;
    const guarded: ByteSource = { [Symbol.asyncIterator]: () => ({ next: () => iterator!.next(), return: returnSource }) };
    for await (const bytes of readBytes(guarded, context.signal)) {
      context.signal.throwIfAborted();
      if (closed) throw new FsError("EBADF");
      size += bytes.byteLength;
      if (size > maxFileBytes) throw new FsError("EFBIG");
      const owned = new Uint8Array(bytes);
      untilYield -= Math.max(64, owned.byteLength);
      if (untilYield <= 0) { await yieldTurn(context.signal); untilYield = 65536; }
      yield owned;
    }
  })();
  const close = (): Promise<void> => {
    closed = true;
    return completion ??= (async () => {
      let failure: { reason: unknown } | undefined;
      try { await closeDescriptor(); } catch (reason) { failure = { reason }; }
      try { if (iterator) await returnSource(); } catch (reason) { failure ??= { reason }; }
      try { await sourceBytes.return(undefined); } catch (reason) { failure ??= { reason }; }
      try { await bufferedWrite; } catch (reason) { failure ??= { reason }; }
      if (failure) throw failure.reason;
    })();
  };
  context.registerCleanup?.(close);
  try {
    if (closed) throw new FsError("EBADF");
    let first: IteratorResult<Uint8Array>;
    try { first = await sourceBytes.next(); }
    catch (error) { if (error instanceof InstallError) throw error; throw failure(`cannot open ${quote(sourceDisplay)} for reading`, error); }
    if (closed) throw new FsError("EBADF");
    const contentStream: ByteSource = (async function* () {
      if (!first.done) yield first.value;
      yield* sourceBytes;
    })();
    if (streamingOutput) {
      const targetOutput = await openFileOutput(context, destination, { flag: "wx", mode: 0o600 });
      try {
        for await (const bytes of contentStream) await targetOutput.sink.write(bytes);
        await targetOutput.finish();
      } catch (error) {
        try { await targetOutput.abort(error); } catch {}
        throw error;
      }
    } else {
      const chunks: Uint8Array[] = []; let size = 0;
      for await (const bytes of contentStream) { chunks.push(bytes); size += bytes.byteLength; }
      const content = new Uint8Array(size); let offset = 0;
      for (const bytes of chunks) { content.set(bytes, offset); offset += bytes.byteLength; }
      bufferedWrite = writeFileOutputCounted(context, content, async () => {
        if (closed) throw new FsError("EBADF");
        await context.fs.writeFile(destination, content, { ...fsOptions, flag: "wx", mode: 0o600 });
        return content.byteLength;
      });
      await bufferedWrite;
    }
    context.signal.throwIfAborted();
  } catch (error) {
    context.signal.throwIfAborted();
    if (backupDisplay !== undefined && !await maybeStat(context, destination)) {
      const backupPath = pathOf(context, backupDisplay);
      if (settings.renameExclusive) await settings.renameExclusive(backupPath, destination, context);
      else if (target?.type === "file" && context.fs.link && context.fs.capabilities.hardlinks !== false) {
        await context.fs.link(backupPath, destination, fsOptions);
        await context.fs.rm(backupPath, fsOptions);
      } else throw failure(`cannot restore backup ${quote(backupDisplay)}`, new FsError("ENOTSUP"));
      if (args.verbose) await output(context, `${quote(backupDisplay)} -> ${quote(destinationDisplay)} (unbackup)\n`);
    }
    if (error instanceof InstallError) throw error;
    throw failure(["ENOSPC", "EFBIG"].includes(codeOf(error) ?? "") ? `error writing ${quote(destinationDisplay)}` : `cannot create regular file ${quote(destinationDisplay)}`, error);
  } finally {
    try { await close(); }
    catch (reason) { cleanupFailure = { reason }; }
  }
  context.signal.throwIfAborted();
  if (cleanupFailure) throw cleanupFailure.reason;
  if (args.debug) await output(context, "copy offload: unsupported, reflink: unsupported, sparse detection: no\n");
  if (args.strip) {
    let status: number;
    try { status = await settings.strip!(destination, args.stripProgram, context); context.signal.throwIfAborted(); }
    catch (error) {
      await removeAfterStripFailure!();
      throw failure(`cannot run ${quote(args.stripProgram)}`, error);
    }
    context.signal.throwIfAborted();
    if (status !== 0) { await removeAfterStripFailure!(); throw new InstallError("strip process terminated abnormally"); }
  }
  if (args.preserve) {
    try { await context.fs.utimes!(destination, timestampStat.atimeMs, timestampStat.mtimeMs, fsOptions); }
    catch (error) { throw failure(`preserving times for ${quote(destinationDisplay)}`, error); }
  }
  await attributes(operation, destination, destinationDisplay, modes.file, source);
}

export function createInstallCommand(options: InstallCommandsOptions = {}): CommandDefinition {
  const settings = { ...options }, maxFileBytes = settings.maxFileBytes ?? 32 * 1024 * 1024;
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 0) throw new TypeError("maxFileBytes must be a nonnegative safe integer");
  return { name: "install", runtimeIdentity: commandRuntimeIdentity, filesystemRequirements: [
    { id: "file", description: "Install file contents with modes", capabilities: ["read", "stat", "write", "exclusiveCreate", "permissions"], mutates: true },
    { id: "directory", description: "Create installation directories", capabilities: ["stat", "mkdir", "permissions"], mutates: true },
    { id: "timestamps", description: "Preserve installation timestamps", capabilities: ["timestamps"], mutates: true },
  ], async execute(context) {
    context.signal.throwIfAborted();
    const report = async (error: unknown) => {
      context.signal.throwIfAborted();
      const message = error instanceof Error ? error.message : String(error);
      await writeBytes(context.stderr, new TextEncoder().encode(`install: ${message}\n${error instanceof InstallError && error.usage ? "Try 'install --help' for more information.\n" : ""}`), context.signal);
    };
    try {
      const args = await parseArguments(context, settings, report);
      if (args.display) { await output(context, args.display === "help" ? helpText : "install (safe-bash; GNU coreutils 9.7 target)\n"); return { exitCode: 0 }; }
      let targetDirectory = args.target;
      if (targetDirectory !== undefined) {
        try {
          const target = await maybeStat(context, pathOf(context, targetDirectory), true);
          if (target?.type !== "directory" && !(target === undefined && args.parents)) throw new FsError(target ? "ENOTDIR" : "ENOENT");
        } catch (error) { throw failure(`failed to access ${quote(targetDirectory)}`, error); }
      } else if (!args.directory && !args.noTarget) {
        const last = args.files.at(-1)!;
        const target = last ? await maybeStat(context, pathOf(context, last), true) : undefined;
        if (target?.type === "directory") { targetDirectory = last; args.files.pop(); }
        else if (args.files.length > 2) throw failure(`target ${quote(last)}`, new FsError(target ? "ENOTDIR" : "ENOENT"));
      }
      const modes = parseMode(args.mode, args.modeBytes);
      if (args.stripProgramSpecified && !args.strip) await report("WARNING: ignoring --strip-program option as -s option was not specified");
      if (args.compare && args.preserve) throw new InstallError("options --compare (-C) and --preserve-timestamps are mutually exclusive", true);
      if (args.compare && args.strip) throw new InstallError("options --compare (-C) and --strip are mutually exclusive", true);
      if (args.compare && (modes.file & 0o7000)) await report("the --compare (-C) option is ignored when you specify a mode with non-permission bits");
      const uid = await account(context, args.owner, "user", settings), gid = await account(context, args.group, "group", settings);
      if ((!context.fs.chmod && !settings.setMode) || context.fs.capabilities.permissions === false) throw new InstallError("cannot set installation modes: Operation not supported");
      if ((uid !== undefined || gid !== undefined) && !settings.chown) throw new InstallError("cannot set ownership: Operation not supported (chown unavailable)");
      if (args.strip && !settings.strip) throw new InstallError("cannot strip files: Operation not supported (trusted strip hook unavailable)");
      if (args.preserve && !args.directory && (!context.fs.utimes || context.fs.capabilities.timestamps === false)) throw new InstallError("cannot preserve timestamps: Operation not supported");
      if (args.contextMode && !settings.securityContext) throw new InstallError("cannot apply security context: Operation not supported (host profile unavailable)");
      if (settings.securityContext?.enabled && !settings.securityContext.apply) throw new InstallError("cannot apply security context: Operation not supported (context capability unavailable)");
      const operation: Operation = { context, args, settings, uid, gid, modes, maxFileBytes };
      let exitCode = 0;
      if (args.directory) {
        for (const directory of args.files) {
          try { await directories(operation, directory, true); }
          catch (error) { await report(error); exitCode = 1; }
        }
      } else {
        if (args.parents && targetDirectory !== undefined) await directories(operation, targetDirectory, false);
        const sources = targetDirectory === undefined ? args.files.slice(0, 1) : args.files;
        const installed = new Map<string, FileStat>();
        for (const source of sources) {
          const destination = targetDirectory === undefined ? args.files[1]! : `${targetDirectory.endsWith("/") ? targetDirectory : `${targetDirectory}/`}${basename(source)}`;
          try {
            const path = destination ? pathOf(context, destination) : "", previous = installed.get(path);
            if (previous && args.backup !== "numbered") {
              const current = await maybeStat(context, path);
              if (current && await compareObservedEntries(context.fs, path, previous, context.fs, path, current, { signal: context.signal }) !== "distinct") throw new InstallError(`will not overwrite just-created ${quote(destination)} with ${quote(source)}`);
            }
            await installFile(operation, source, destination);
            const stat = await maybeStat(context, path);
            if (stat) installed.set(path, stat);
          }
          catch (error) { await report(error); exitCode = 1; }
        }
      }
      context.signal.throwIfAborted();
      return { exitCode };
    } catch (error) { await report(error); return { exitCode: 1 }; }
  } };
}

export function createInstallCommands(options: InstallCommandsOptions = {}): readonly CommandDefinition[] { return [createInstallCommand(options)]; }

export function installCommands(options: InstallCommandsOptions = {}): VirtualShellPlugin {
  const commands = createInstallCommands(options), replace = options.replace ?? false;
  return { name: "install-commands", setup(host) {
    if (!replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    for (const command of commands) host.commands.register(command, { replace });
  } };
}
