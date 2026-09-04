import { yieldTurn } from "../contracts/yield.js";
import { dirname, FsError, isPathWithin, joinPath, type CommandContext, type FileStat } from "../contracts/index.js";
import { compareCopyIdentity, compareObservedEntries } from "./copy-identity.js";
import { codeOf, diagnostic } from "./internal.js";
import { admitFilesystemModes } from "./filesystem-requirements.js";

interface MoveEntry {
  readonly source: string;
  readonly target: string;
  readonly stat: FileStat;
  readonly targetStat: FileStat | undefined;
  readonly link: string | undefined;
}

export class MoveBudget {
  private steps = 0;
  constructor(readonly signal: AbortSignal) {}
  get remaining(): number { return 100_000 - this.steps; }
  async step(): Promise<void> {
    this.signal.throwIfAborted();
    if (++this.steps > 100_000) throw new FsError("EFBIG", { message: "cross-device move entry limit exceeded" });
    if (this.steps % 128 === 0) await yieldTurn();
    this.signal.throwIfAborted();
  }
}

async function optionalStat(context: CommandContext, path: string): Promise<FileStat | undefined> {
  try { return await context.fs.lstat(path, { signal: context.signal }); }
  catch (error) { context.signal.throwIfAborted(); if (codeOf(error) === "ENOENT") return undefined; throw error; }
}

function unchanged(before: FileStat, after: FileStat, content: boolean): boolean {
  const identity = compareCopyIdentity(before, after);
  const stableIdentity = compareCopyIdentity(before, before) === "same" ? identity === "same" : identity !== "distinct";
  return stableIdentity && before.type === after.type
    && (!content || (before.size === after.size && before.mtimeMs === after.mtimeMs && before.mode === after.mode));
}

async function recheck(context: CommandContext, entry: MoveEntry, content = true): Promise<void> {
  context.signal.throwIfAborted();
  const current = await context.fs.lstat(entry.source, { signal: context.signal });
  if (!unchanged(entry.stat, current, content)) throw new FsError("EBUSY", { path: entry.source, message: "move source changed before removal" });
}

export async function moveAcrossDevices(context: CommandContext, source: string, target: string, noClobber: boolean, budget: MoveBudget): Promise<boolean> {
  const plan: MoveEntry[] = [];
  const sourceStat = await context.fs.lstat(source, { signal: context.signal });
  const targetStat = await optionalStat(context, target);
  if (noClobber && targetStat) return false;
  if (source === target || compareCopyIdentity(sourceStat, targetStat) === "same") return false;
  const compare = (origin: string, destination: string, stat: FileStat, existing: FileStat) =>
    stat.type === "symlink" || existing.type === "symlink" ? Promise.resolve(compareCopyIdentity(stat, existing))
      : compareObservedEntries(context.fs, origin, stat, context.fs, destination, existing, { signal: context.signal });
  const rootIdentity = targetStat ? await compare(source, target, sourceStat, targetStat) : "unknown";
  if (rootIdentity === "same") return false;
  if (source === "/") throw new FsError("EBUSY", { path: source });
  if (sourceStat.type === "directory") {
    if (!context.fs.rmdir) throw new FsError("ENOTSUP", { syscall: "rmdir", path: source });
    if (isPathWithin(source, target)) throw new FsError("EINVAL", { path: target, message: "cannot move a directory into itself" });
    let parent = dirname(target);
    while (true) {
      await budget.step();
      const parentStat = await optionalStat(context, parent);
      if (compareCopyIdentity(sourceStat, parentStat) === "same") throw new FsError("EINVAL", { path: target, message: "cannot move a directory into itself" });
      if (parent === "/") break;
      parent = dirname(parent);
    }
  }
  const visit = async (origin: string, destination: string, stat: FileStat, existing: FileStat | undefined, depth: number): Promise<void> => {
    await budget.step();
    if (depth > 128) throw new FsError("EFBIG", { message: "cross-device move depth limit exceeded" });
    if (existing) {
      const identity = depth === 0 ? rootIdentity : await compare(origin, destination, stat, existing);
      if (identity === "same") throw new FsError("EINVAL", { path: origin, dest: destination, message: "move source and destination are aliases" });
      if (identity === "unknown") throw new FsError("ENOTSUP", { path: origin, dest: destination, message: "existing move destination lacks authoritative distinctness" });
      if ((stat.type === "directory") !== (existing.type === "directory")) throw new FsError(existing.type === "directory" ? "EISDIR" : "ENOTDIR", { path: destination });
      if (stat.type === "directory" && (await context.fs.readdir(destination, { signal: context.signal })).length) throw new FsError("ENOTEMPTY", { path: destination });
    }
    let link: string | undefined;
    if (stat.type === "symlink") {
      if (!context.fs.readlink || !context.fs.symlink) throw new FsError("ENOTSUP", { syscall: "symlink", path: origin });
      link = await context.fs.readlink(origin, { signal: context.signal });
    }
    plan.push({ source: origin, target: destination, stat, targetStat: existing, link });
    if (stat.type === "directory") {
      const entries = await context.fs.readdir(origin, { signal: context.signal });
      if (entries.length > budget.remaining) throw new FsError("EFBIG", { message: "cross-device move entry limit exceeded" });
      for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
        const child = joinPath(origin, entry.name), childTarget = joinPath(destination, entry.name);
        await visit(child, childTarget, await context.fs.lstat(child, { signal: context.signal }), await optionalStat(context, childTarget), depth + 1);
      }
    }
  };
  await visit(source, target, sourceStat, targetStat, 0);
  for (const entry of plan) {
    const sourceMode = entry.stat.type === "directory" ? "cross-directory-source"
      : entry.stat.type === "symlink" ? "cross-link-source" : "cross-source";
    await admitFilesystemModes(context, "mv", [sourceMode], [entry.source]);
    if (entry.stat.type === "directory") {
      if (!entry.targetStat) await admitFilesystemModes(context, "mv", ["cross-directory"], [entry.target]);
    } else if (entry.stat.type === "symlink") {
      await admitFilesystemModes(context, "mv", ["cross-link"], [entry.target]);
      if (entry.targetStat) await admitFilesystemModes(context, "mv", ["cross-replace"], [entry.target]);
    } else {
      await admitFilesystemModes(context, "mv", ["cross-file",
        ...!entry.targetStat || entry.targetStat.type === "symlink" ? ["cross-exclusive"] : [],
        ...entry.targetStat?.type === "symlink" ? ["cross-replace"] : [],
      ], [entry.target]);
    }
  }
  for (const entry of plan) {
    await recheck(context, entry);
    try {
      if (entry.stat.type === "directory") {
        if (!entry.targetStat) await context.fs.mkdir(entry.target, { mode: 0o700, signal: context.signal });
      } else if (entry.stat.type === "symlink") {
        if (entry.targetStat) await context.fs.rm(entry.target, { recursive: false, signal: context.signal });
        await context.fs.symlink!(entry.link!, entry.target, { signal: context.signal });
      } else {
        if (entry.targetStat?.type === "symlink") await context.fs.rm(entry.target, { recursive: false, signal: context.signal });
        await context.fs.copyFile(entry.source, entry.target, { exclusive: !entry.targetStat || entry.targetStat.type === "symlink", signal: context.signal });
      }
    } catch (error) {
      context.signal.throwIfAborted();
      if (noClobber && entry === plan[0] && !entry.targetStat && codeOf(error) === "EEXIST") return false;
      throw error;
    }
  }
  for (const entry of [...plan].reverse()) {
    context.signal.throwIfAborted();
    if (entry.stat.type !== "symlink") {
      if (context.fs.capabilities.permissions === true && context.fs.chmod) await context.fs.chmod(entry.target, entry.stat.mode & 0o7777, { signal: context.signal });
      if (context.fs.capabilities.timestamps === true && context.fs.utimes) {
        try { await context.fs.utimes(entry.target, entry.stat.atimeMs, entry.stat.mtimeMs, { signal: context.signal }); }
        catch (error) {
          context.signal.throwIfAborted();
          if (codeOf(error) !== "ENOTSUP" && codeOf(error) !== "EOPNOTSUPP") throw error;
          await diagnostic(context, new Error(`cannot preserve timestamps for '${entry.target}': operation not supported; retaining copied data`));
        }
      }
    }
  }
  for (const entry of plan) await recheck(context, entry);
  for (const entry of [...plan].reverse()) {
    await recheck(context, entry, entry.stat.type !== "directory");
    if (entry.stat.type === "directory") await context.fs.rmdir!(entry.source, { signal: context.signal });
    else await context.fs.rm(entry.source, { recursive: false, signal: context.signal });
  }
  return true;
}
