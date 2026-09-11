import {
  dirname, FsError, joinPath,
  type CommandContext, type FileStat,
} from "../../../contracts/index.js";
import { codeOf, pathOf } from "../../internal.js";
import { PublicDiagnostic } from "../../../diagnostics.js";
import { retainFileSystemCleanup } from "poe-code/safe-fs/core";
import { profiles, type CompressionOptions } from "./options.js";
import { chunkBytes, stagingLimit, transform } from "./stream.js";
import { FileOperation } from "./file-operation.js";

export interface Operand {
  readonly source: string;
  readonly realSource?: string;
  readonly sourceStat?: FileStat;
  readonly destination?: string;
  readonly destinationStat?: FileStat;
}

function identified(stat: FileStat): boolean {
  return stat.identityScope !== undefined && Number.isSafeInteger(stat.ino) && Number.isSafeInteger(stat.dev);
}

function sameIdentity(first: FileStat, second: FileStat): boolean {
  return identified(first) && identified(second) && first.identityScope === second.identityScope
    && first.ino === second.ino && first.dev === second.dev;
}

function sameSnapshot(first: FileStat, second: FileStat): boolean {
  return first.type === second.type && first.size === second.size && first.mode === second.mode
    && first.mtimeMs === second.mtimeMs && first.ctimeMs === second.ctimeMs
    && first.ino === second.ino && first.dev === second.dev && first.nlink === second.nlink
    && first.birthtimeMs === second.birthtimeMs && first.uid === second.uid && first.gid === second.gid
    && first.identityScope === second.identityScope;
}

function sameEntry(first: FileStat, second: FileStat): boolean {
  return sameIdentity(first, second) && first.type === second.type
    && first.birthtimeMs === second.birthtimeMs;
}

async function existing(context: CommandContext, path: string): Promise<FileStat | undefined> {
  try { return await context.fs.lstat(path, { signal: context.signal }); }
  catch (error) { if (codeOf(error) === "ENOENT") return undefined; throw error; }
}

function outputPath(source: string, options: CompressionOptions): string {
  if (options.format !== "gzip") {
    const suffix = profiles.find(profile => profile.format === options.format)!.suffix;
    if (options.decompress) {
      if (!source.endsWith(suffix)) throw new FsError("EINVAL", { path: source, message: `unknown ${options.format} suffix (use -c for stdout)` });
      const destination = source.slice(0, -suffix.length);
      if (destination.endsWith("/")) throw new FsError("EINVAL", { path: source, message: "empty output filename" });
      return destination;
    }
    if (!options.force && source.endsWith(suffix)) throw new FsError("EINVAL", { path: source, message: `already has a ${options.format} suffix (use -f to compress again)` });
    return source + suffix;
  }
  if (options.decompress) {
    if (/\.(?:tgz|taz)$/iu.test(source)) return source.slice(0, -4) + ".tar";
    const suffix = /(?:\.gz|\.z|-gz|-z|_z)$/iu.exec(source);
    if (!suffix) throw new FsError("EINVAL", { path: source, message: "unknown gzip suffix (use -c for stdout)" });
    const destination = source.slice(0, -suffix[0].length);
    if (destination === dirname(source) || destination.endsWith("/")) throw new FsError("EINVAL", { path: source, message: "empty output filename" });
    return destination;
  }
  if (!options.force && /(?:\.gz|\.z|-gz|-z|_z|\.tgz|\.taz)$/iu.test(source)) {
    throw new FsError("EINVAL", { path: source, message: "already has a gzip suffix (use -f to compress again)" });
  }
  return source + ".gz";
}

export async function planOperands(context: CommandContext, options: CompressionOptions): Promise<Operand[]> {
  const operation = new FileOperation(context);
  try {
    return await operation.run(() => collectOperands({ ...context, fs: operation.fs, signal: operation.signal }, options));
  } finally { await operation.close(); context.signal.throwIfAborted(); }
}

async function collectOperands(context: CommandContext, options: CompressionOptions): Promise<Operand[]> {
  const plans: Operand[] = [];
  for (const name of options.operands) {
    context.signal.throwIfAborted();
    if (name === "-") { plans.push({ source: "-" }); continue; }
    if (!name) throw new FsError("ENOENT", { path: name });
    const source = pathOf(context, name);
    const sourceCapabilities = await context.fs.capabilitiesFor?.(source, { signal: context.signal }) ?? context.fs.capabilities;
    if (!context.fs.readStream || sourceCapabilities.streamingRead === false) {
      throw new FsError("ENOTSUP", { message: "named input requires VFS streaming reads; no readFile fallback" });
    }
    const sourceStat = await context.fs.lstat(source, { signal: context.signal });
    if (sourceStat.type !== "file") throw new FsError("EINVAL", { path: source, message: "input must be a regular, non-symlink file" });
    const realSource = await context.fs.realpath(source, { signal: context.signal });
    if (options.stdout || options.test) { plans.push({ source, sourceStat, realSource }); continue; }
    if (context.fs.capabilities.readOnly === true) {
      throw new FsError("EROFS", { syscall: context.command, path: realSource });
    }
    if (!options.keep && !options.force && (sourceStat.nlink ?? 1) > 1) {
      throw new FsError("EINVAL", { path: source, message: "input has multiple links (use -k or -f)" });
    }
    const destination = outputPath(realSource, options);
    const capabilities = await context.fs.capabilitiesFor?.(destination, { signal: context.signal }) ?? context.fs.capabilities;
    if (capabilities.readOnly === true) throw new FsError("EROFS", { syscall: context.command, path: destination });
    if (!context.fs.writeStream || capabilities.streamingWrite === false) {
      throw new FsError("ENOTSUP", { message: "file output requires VFS streaming writes (use -c for stdout)" });
    }
    const destinationStat = await existing(context, destination);
    if (!identified(sourceStat) || destinationStat && !identified(destinationStat)) {
      throw new FsError("ENOTSUP", { path: source, message: "file output requires stable scoped entry identities" });
    }
    if (!context.fs.rmdir || capabilities.exclusiveCreate !== true
      || (destinationStat ? capabilities.atomicRename : capabilities.atomicRenameNoReplace) !== true) {
      throw new FsError("ENOTSUP", { path: destination, message: "file output requires exclusive staging, safe rmdir and atomic publication (use -c for stdout)" });
    }
    context.signal.throwIfAborted();
    if (destinationStat) {
      if (destinationStat.type !== "file" || sameIdentity(sourceStat, destinationStat)
        || realSource === await context.fs.realpath(destination, { signal: context.signal })) {
        throw new FsError("EINVAL", { path: destination, message: "destination is not a distinct regular file" });
      }
      if (!options.force) throw new FsError("EEXIST", { path: destination });
      if (capabilities.atomicRename !== true) {
        throw new FsError("ENOTSUP", { path: destination, message: "forced replacement requires VFS atomicRename" });
      }
    }
    plans.push({ source, sourceStat, realSource, destination, ...(destinationStat ? { destinationStat } : {}) });
  }
  const destinations = new Set<string>();
  for (const plan of plans) {
    if (!plan.destination) continue;
    const parent = await context.fs.realpath(dirname(plan.destination), { signal: context.signal });
    const realDestination = joinPath(parent, plan.destination.slice(plan.destination.lastIndexOf("/") + 1));
    if (destinations.has(realDestination) || plans.some((other) => other.realSource === realDestination
      || (plan.destinationStat && other.sourceStat && sameIdentity(plan.destinationStat, other.sourceStat)))) {
      throw new FsError("EINVAL", { path: plan.destination, message: "overlapping input/output operands" });
    }
    destinations.add(realDestination);
  }
  return plans;
}

export async function unchangedSource(context: CommandContext, plan: Operand): Promise<void> {
  if (!plan.sourceStat) return;
  const current = await context.fs.lstat(plan.source, { signal: context.signal });
  if (!sameSnapshot(plan.sourceStat, current)
    || await context.fs.realpath(plan.source, { signal: context.signal }) !== plan.realSource) {
    throw new FsError("EBUSY", { path: plan.source, message: "input identity or metadata changed; input retained" });
  }
}

export async function writeFileOperand(context: CommandContext, plan: Operand, options: CompressionOptions): Promise<boolean> {
  const destination = plan.destination!;
  let directory: string | undefined;
  let staged: string | undefined;
  let directoryStat: FileStat | undefined;
  let stageStat: FileStat | undefined;
  let stageOwned = false;
  let moved = false;
  let failure: unknown;
  let failed = false;
  let warned = false;
  let cleanupFailed = false;
  let retainedCleanup: (() => Promise<void>) | undefined;
  const operation = new FileOperation(context, async () => { await retainedCleanup?.(); });
  const active = { ...context, fs: operation.fs, signal: operation.signal };
  const { fs, signal } = active;
  const snapshot = (stat: FileStat): FileStat => {
    const result: Record<string, unknown> = {};
    for (const key of ["type", "size", "mode", "mtimeMs", "atimeMs", "ctimeMs", "birthtimeMs", "identityScope", "ino", "dev", "nlink", "uid", "gid"] as const) {
      result[key] = stat[key]; operation.check();
    }
    return Object.freeze(result) as unknown as FileStat;
  };
  try {
    retainedCleanup = retainFileSystemCleanup(context.fs, async cleanup => {
      if (directory === undefined) return;
      const cleanupSignal = AbortSignal.timeout(5_000);
      const currentDirectory = await cleanup.lstat(directory, { signal: cleanupSignal });
      if (!directoryStat || !sameEntry(directoryStat, currentDirectory)) {
        throw new FsError("EBUSY", { path: directory, message: "staging directory identity is unknown or changed; refusing cleanup" });
      }
      if (stageOwned && !moved && staged !== undefined) {
        let currentStage: FileStat | undefined;
        try { currentStage = await cleanup.lstat(staged, { signal: cleanupSignal }); }
        catch (error) { if (codeOf(error) !== "ENOENT") throw error; }
        if (currentStage) {
          if (!stageStat || !sameEntry(stageStat, currentStage)) throw new FsError("EBUSY", { path: staged, message: "staging file identity changed; refusing cleanup" });
          await cleanup.rm(staged, { signal: cleanupSignal });
        }
      }
      if (!cleanup.rmdir) throw new FsError("ENOTSUP", { path: directory, message: "safe directory removal unavailable" });
      try { await cleanup.rmdir(directory, { signal: cleanupSignal }); }
      catch (error) {
        if (codeOf(error) === "ENOTEMPTY") throw new FsError("ENOTEMPTY", { path: directory, message: "unexpected staging entries; refusing cleanup" });
        throw error;
      }
    }, { maxOperations: 8 });
    operation.check();
    await operation.run(() => unchangedSource(active, plan));
    for (let attempt = 0; directory === undefined && attempt < 16; attempt++) {
      const path = joinPath(dirname(destination), `.virtual-bash-gzip-${globalThis.crypto.randomUUID()}`);
      const capabilities = await operation.run(async () => await fs.capabilitiesFor?.(path, { signal, create: true, allowDirectory: true }) ?? fs.capabilities);
      operation.check();
      const snapshotRmdir = capabilities.snapshotRmdir;
      operation.check();
      if (snapshotRmdir === true) throw new FsError("ENOTSUP", { path, message: "strong staging directory cleanup unavailable; snapshot-only rmdir is unsupported" });
      try {
        await operation.run(async () => { await fs.mkdir(path, { mode: 0o700, signal }); directory = path; });
      } catch (error) { operation.check(); if (codeOf(error) !== "EEXIST") throw error; }
    }
    if (directory === undefined) throw new FsError("EEXIST", { message: "unable to allocate a private gzip staging directory" });
    staged = joinPath(directory, "data");
    directoryStat = snapshot(await operation.run(() => fs.lstat(directory!, { signal })));
    if (directoryStat.type !== "directory" || !identified(directoryStat)) throw new FsError("EBUSY", { path: directory });
    await operation.run(async () => { await fs.writeFile(staged!, new Uint8Array(), { flag: "wx", mode: 0o600, signal }); stageOwned = true; });
    stageStat = snapshot(await operation.run(() => fs.lstat(staged!, { signal })));
    if (stageStat.type !== "file" || stageStat.size !== 0 || !identified(stageStat)) throw new FsError("EBUSY", { path: staged });
    warned = await operation.run(() => transform((signal) => fs.readStream!(plan.source, { signal, chunkSize: chunkBytes }), async (output, signal) => {
      await fs.writeStream!(staged!, output, { flag: "w", mode: 0o600, signal });
    }, { ...options, force: false }, signal, stagingLimit));
    await operation.run(() => unchangedSource(active, plan));
    const target = await operation.run(() => existing(active, destination));
    if (plan.destinationStat ? !target || !sameSnapshot(plan.destinationStat, target) : target !== undefined) {
      throw new FsError("EBUSY", { path: destination, message: "destination changed during compression" });
    }
    if (!sameEntry(stageStat, snapshot(await operation.run(() => fs.lstat(staged!, { signal }))))) {
      throw new FsError("EBUSY", { path: staged, message: "staging identity changed" });
    }
    await operation.run(async () => { await fs.rename(staged!, destination, { signal, noReplace: !plan.destinationStat }); moved = true; });
    operation.check();
    try { await retainedCleanup(); }
    catch (error) { cleanupFailed = true; throw error; }
    operation.check();
    if (!options.keep) {
      await operation.run(() => unchangedSource(active, plan));
      await operation.run(() => fs.rm(plan.source, { signal }));
    }
  } catch (error) { failed = true; failure = error; }
  try {
    await operation.close();
  } catch (error) {
    if (cleanupFailed && error === failure) throw error;
    if (failed) {
      const aggregate = new AggregateError([failure, error], "compression failed and staging cleanup failed; input retained");
      throw new PublicDiagnostic(aggregate.message, { cause: aggregate });
    }
    throw error;
  }
  context.signal.throwIfAborted();
  if (failed) throw failure;
  return warned;
}
