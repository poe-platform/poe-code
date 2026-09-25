import { tryGetMemoryDirectoryEntryNamesSync } from "@poe-code/safe-fs/core";
import { assertCommandRequirements, dirname, FsError, isPathWithin, relativePath, resolvePath, type CommandContext, type DirectoryEntry, type FileStat } from "../../contracts/index.js";
import { getRuntimeBackingFileSystem } from "../../shell/runtime.js";
import { RegexExecutionError, type RegexSession } from "../regex-execution/portable.js";
import { Glob, ignoreRules, matchGlobs, type IgnoreRule } from "./glob.js";
import { SearchError, type Arguments } from "./options.js";
import { Limits, pathFor } from "./shared.js";
import { assertPathRequirements, searchRequirements } from "./requirements.js";
import { defaultFileTypes } from "./file-types.js";

export interface FileTarget { path: string; label: string; explicit: boolean; recursive: boolean; canonicalPath?: string | undefined }
const EMPTY_IGNORE_RULES: IgnoreRule[] = [];
const IGNORE_CANDIDATES_VCS_DOT: readonly [string, number][] = [[".gitignore", 1], [".ignore", 2], [".rgignore", 3]];
const IGNORE_CANDIDATES_DOT_ONLY: readonly [string, number][] = [[".ignore", 2], [".rgignore", 3]];
const IGNORE_CANDIDATES_VCS_ONLY: readonly [string, number][] = [[".gitignore", 1]];
const IGNORE_CANDIDATES_NONE: readonly [string, number][] = [];

function compareEntryNames(left: string, right: string): number {
  const min = Math.min(left.length, right.length);
  for (let i = 0; i < min; i++) {
    const a = left.charCodeAt(i);
    const b = right.charCodeAt(i);
    if (a >= 0xd800 || b >= 0xd800) return Buffer.compare(Buffer.from(left), Buffer.from(right));
    if (a !== b) return a - b;
  }
  return left.length - right.length;
}

export class Walker {
  private readonly globs: { glob: Glob; include: boolean }[];
  private readonly hasPositive: boolean;
  private readonly typeGlobs: { glob: Glob; include: boolean }[] = [];
  private readonly hasPositiveType: boolean;
  private readonly cache = new Map<string, { rules: IgnoreRule[]; repository: boolean; root: boolean }>();
  private readonly explicitRules: IgnoreRule[] = [];
  private uniformDirAdmitted = false;
  private uniformCanonicalAdmitted: boolean | undefined;
  private uniformReaddirAdmitted: boolean | undefined;
  private uniformIgnoreAdmitted = false;
  constructor(private readonly context: CommandContext, private readonly args: Arguments, private readonly limits: Limits, private readonly report: (error: unknown) => Promise<void>, private readonly session: RegexSession) {
    this.globs = args.globs.map(({ source, insensitive }) => ({ glob: new Glob(source.startsWith("!") ? source.slice(1) : source, insensitive), include: !source.startsWith("!") }));
    this.hasPositive = this.globs.some(rule => rule.include);
    this.hasPositiveType = args.types.some(rule => rule.include);
  }
  async validate(): Promise<void> {
    if (this.globs.length) await matchGlobs(this.globs.map(rule => rule.glob), [], this.session);
    if (this.args.types.length) {
      const selected = new Map<string, boolean>();
      for (const selection of this.args.types) {
        const names = selection.name === "all" ? Object.keys(defaultFileTypes) : [selection.name];
        for (const name of names) {
          await this.limits.tick();
          for (const pattern of defaultFileTypes[name]!) {
            await this.limits.tick();
            selected.delete(pattern);
            selected.set(pattern, selection.include);
          }
        }
      }
      for (const [source, include] of selected) this.typeGlobs.push({ glob: new Glob(source), include });
      if (this.typeGlobs.length) await matchGlobs(this.typeGlobs.map(rule => rule.glob), [], this.session);
    }
    if (this.args.ignoreFiles) for (const operand of this.args.ignorePaths) {
      const path = pathFor(this.context, operand);
      await assertPathRequirements(this.context, searchRequirements, ["ignore-file"], [path]);
      const bytes = await this.context.fs.readFile(path, { signal: this.context.signal });
      this.explicitRules.push(...await ignoreRules(Buffer.from(bytes).toString("utf8"), this.context.cwd, 0, this.session));
    }
  }
  private async exists(path: string): Promise<boolean> {
    try {
      await assertPathRequirements(this.context, searchRequirements, ["metadata"], [path]);
      await this.context.fs.lstat(path, { signal: this.context.signal }); return true;
    }
    catch (error) { this.context.signal.throwIfAborted(); if ((error as { code?: string }).code === "ENOENT") return false; throw error; }
  }
  private async load(directory: string, inherited: readonly IgnoreRule[], repository: boolean, entries?: readonly DirectoryEntry[]): Promise<{ rules: IgnoreRule[]; repository: boolean }> {
    const base = resolvePath("/", directory);
    const key = `${base}:${repository}`;
    const cached = this.cache.get(key);
    if (cached) {
      if (cached.rules.length === 0 && (!cached.root || inherited.length === 0)) {
        return { repository: cached.repository, rules: inherited as IgnoreRule[] };
      }
      return { repository: cached.repository, rules: [...(cached.root ? inherited.filter(rule => rule.priority !== 1) : inherited), ...cached.rules] };
    }
    const backing = getRuntimeBackingFileSystem(this.context.fs);
    const uniformNonDev = backing !== undefined && backing.capabilitiesFor === undefined && base !== "/dev" && !base.startsWith("/dev/");
    const memEntries = !entries && uniformNonDev && this.context.fs.capabilities.read !== false && backing.capabilities.read !== false && this.context.fs.capabilities.stat !== false && backing.capabilities.stat !== false
      ? tryGetMemoryDirectoryEntryNamesSync(backing, base)
      : undefined;
    const root = entries
      ? entries.some(entry => entry.name === ".git")
      : memEntries !== undefined
        ? (assertCommandRequirements(this.context, searchRequirements, ["metadata"]), memEntries.has(".git"))
        : await this.exists(`${directory}/.git`);
    repository ||= root;
    if (root && inherited.length > 0) inherited = inherited.filter(rule => rule.priority !== 1);
    let local: IgnoreRule[] = EMPTY_IGNORE_RULES;
    if (this.args.ignore) {
      const wantVcs = this.args.ignoreVcs && (repository || !this.args.requireGit);
      const wantDot = this.args.ignoreDot;
      const names = wantVcs && wantDot ? IGNORE_CANDIDATES_VCS_DOT : wantDot ? IGNORE_CANDIDATES_DOT_ONLY : wantVcs ? IGNORE_CANDIDATES_VCS_ONLY : IGNORE_CANDIDATES_NONE;
      let checkedIgnoreReq = false;
      for (let i = 0; i < names.length; i++) {
        const [name, priority] = names[i]!;
        if ((entries && !entries.some(entry => entry.name === name)) || (memEntries !== undefined && !memEntries.has(name))) {
          if (!checkedIgnoreReq) {
            checkedIgnoreReq = true;
            if (uniformNonDev) assertCommandRequirements(this.context, searchRequirements, ["ignore-file"]);
            else await assertPathRequirements(this.context, searchRequirements, ["ignore-file"], [`${directory}/${name}`]);
          }
          continue;
        }
        checkedIgnoreReq = true;
        if (uniformNonDev) assertCommandRequirements(this.context, searchRequirements, ["ignore-file"]);
        else await assertPathRequirements(this.context, searchRequirements, ["ignore-file"], [`${directory}/${name}`]);
        try {
          const data = await this.context.fs.readFile(`${directory}/${name}`, { signal: this.context.signal });
          if (local === EMPTY_IGNORE_RULES) local = [];
          local.push(...await ignoreRules(Buffer.from(data).toString("utf8"), base, priority, this.session));
        } catch (error) {
          this.context.signal.throwIfAborted();
          if (error instanceof RegexExecutionError) throw error;
          if ((error as { code?: string }).code !== "ENOENT") await this.report(error);
        }
      }
    }
    this.cache.set(key, { repository, rules: local, root });
    return { repository, rules: local.length === 0 ? (inherited as IgnoreRule[]) : inherited.length === 0 ? local : [...inherited, ...local] };
  }
  private async accepted(path: string, name: string, directory: boolean, rules: readonly IgnoreRule[]): Promise<boolean> {
    if (this.globs.length) {
      let override: boolean | undefined;
      const relative = relativePath(this.context.cwd, path);
      const overrides = await matchGlobs(this.globs.map(rule => rule.glob), this.globs.map(() => ({ path: relative, directory, ancestors: false })), this.session);
      for (let index = 0; index < overrides.length; index++) if (overrides[index]) override = this.globs[index]!.include;
      if (override !== undefined) return override;
      if (this.hasPositive && !directory) return false;
    }
    let include: boolean | undefined;
    if (rules.length) {
      let priority = -1;
      for (let offset = 0; offset < rules.length;) {
        const group: IgnoreRule[] = [];
        const groupPriority = rules[offset]!.priority;
        while (offset < rules.length && rules[offset]!.priority === groupPriority) {
          const rule = rules[offset++]!;
          if (rule.priority >= priority && isPathWithin(rule.base, path)) group.push(rule);
        }
        const matches = await matchGlobs(group.map(rule => rule.glob), group.map(rule => ({ path: relativePath(rule.base, path), directory, ancestors: false })), this.session);
        for (let index = 0; index < matches.length; index++) if (matches[index]) {
          priority = groupPriority; include = group[index]!.include;
        }
      }
    }
    if (include === false) return false;
    if (!directory && this.typeGlobs.length) {
      const matches = await matchGlobs(this.typeGlobs.map(rule => rule.glob), this.typeGlobs.map(() => ({ path: name, directory: false, ancestors: false })), this.session);
      let selected: boolean | undefined;
      for (let index = 0; index < matches.length; index++) if (matches[index]) selected = this.typeGlobs[index]!.include;
      if (selected !== undefined) return selected;
      if (this.hasPositiveType) return false;
    }
    if (include !== undefined) return include;
    return this.args.hidden || !name.startsWith(".");
  }
  private readonly reusableTarget: FileTarget = { path: "", label: "", explicit: false, recursive: true, canonicalPath: undefined };
  private async walkDirectory(path: string, label: string, depth: number, ancestors: Map<string, string>, rules: readonly IgnoreRule[], repository: boolean, onTarget: (target: FileTarget) => boolean | Promise<boolean>): Promise<boolean> {
    if (depth >= this.args.maxDepth) return true;
    const backing = getRuntimeBackingFileSystem(this.context.fs);
    const uniformNonDevPath = backing !== undefined && backing.capabilitiesFor === undefined && path !== "/dev" && !path.startsWith("/dev/");
    if (uniformNonDevPath) {
      if (!this.uniformDirAdmitted) {
        assertCommandRequirements(this.context, searchRequirements, ["directory"]);
        this.uniformDirAdmitted = true;
      } else {
        this.context.signal.throwIfAborted();
      }
    } else await assertPathRequirements(this.context, searchRequirements, ["directory"], [path]);
    const canTryMemDir = uniformNonDevPath && (this.uniformCanonicalAdmitted ??= (this.context.fs.capabilities.realpath !== false && backing.capabilities.realpath !== false && (assertCommandRequirements(this.context, searchRequirements, ["canonical"]), true)));
    const memDirEntries = canTryMemDir ? tryGetMemoryDirectoryEntryNamesSync(backing, path) : undefined;
    const canonical = memDirEntries !== undefined
      ? path
      : await this.context.fs.realpath(path, { signal: this.context.signal });
    const uniformCanonical = backing !== undefined && backing.capabilitiesFor === undefined && canonical !== "/dev" && !canonical.startsWith("/dev/");
    if (ancestors.has(canonical)) { await this.report(new SearchError(`File system loop found: ${label} points to an ancestor ${ancestors.get(canonical)}`)); return true; }
    ancestors.set(canonical, label || ".");
    try {
    const canFastMemReaddir = memDirEntries !== undefined && uniformCanonical && (this.uniformReaddirAdmitted ??= (this.context.fs.capabilities.readdir !== false && backing.capabilities.readdir !== false));
    const admittedSync = canFastMemReaddir && (!this.args.ignore || (!memDirEntries.has(".git") && !memDirEntries.has(".gitignore") && !memDirEntries.has(".ignore") && !memDirEntries.has(".rgignore")))
      ? (() => {
          if (this.args.ignore && !this.uniformIgnoreAdmitted) {
            assertCommandRequirements(this.context, searchRequirements, ["metadata", "ignore-file"]);
            this.uniformIgnoreAdmitted = true;
          }
          return { repository, rules: rules as IgnoreRule[] };
        })()
      : undefined;
    const admitted = admittedSync ?? (this.args.ignore ? await this.load(path, rules, repository) : undefined);
    const maxEntries = this.limits.maxFiles - this.limits.files;
    let entries: DirectoryEntry[] | undefined;
    let fastNames: string[] | undefined;
    if (canFastMemReaddir && memDirEntries.size <= maxEntries) {
      this.context.signal.throwIfAborted();
      fastNames = Array.from(memDirEntries.keys());
      fastNames.sort(compareEntryNames);
    } else {
      try {
        entries = await (uniformCanonical ? backing : this.context.fs).readdir(uniformCanonical ? canonical : path, { signal: this.context.signal,
          ...(Number.isFinite(maxEntries) ? { maxEntries } : {}) });
      } catch (error) {
        this.context.signal.throwIfAborted();
        if (Number.isFinite(maxEntries) && error instanceof FsError && error.code === "EFBIG" && error.syscall === "readdir") {
          if (!admitted) await this.load(path, rules, repository);
          throw new SearchError("filesystem entry limit exceeded");
        }
        throw error;
      }
      this.context.signal.throwIfAborted();
      if (entries.length > maxEntries) {
        if (!admitted) await this.load(path, rules, repository, entries);
        throw new SearchError("filesystem entry limit exceeded");
      }
      entries.sort((left, right) => compareEntryNames(left.name, right.name));
    }
    const local = admitted ?? await this.load(path, rules, repository, entries);
    const totalEntries = fastNames ? fastNames.length : entries!.length;
    for (let entryIdx = 0; entryIdx < totalEntries; entryIdx++) {
      const entryName = fastNames ? fastNames[entryIdx]! : entries![entryIdx]!.name;
      const entryType = fastNames ? memDirEntries!.get(entryName)!.type : entries![entryIdx]!.type;
      const tickPending = this.limits.tick();
      if (tickPending) await tickPending;
      if (++this.limits.files > this.limits.maxFiles) throw new SearchError("filesystem entry limit exceeded");
      const child = `${path.endsWith("/") ? path.slice(0, -1) : path}/${entryName}`;
      const display = label ? `${label.endsWith("/") ? label.slice(0, -1) : label}/${entryName}` : entryName;
      try {
        if (entryType === "symlink" && !this.args.follow) continue;
        if (entryType === "symlink") await assertPathRequirements(this.context, searchRequirements, ["metadata"], [child]);
        const type = entryType === "symlink" ? (await this.context.fs.stat(child, { signal: this.context.signal })).type : entryType;
        if (entryType === "symlink" && type === "directory") {
          await assertPathRequirements(this.context, searchRequirements, ["canonical"], [child]);
          const destination = await this.context.fs.realpath(child, { signal: this.context.signal });
          if (ancestors.has(destination)) {
            await this.report(new SearchError(`File system loop found: ${display} points to an ancestor ${ancestors.get(destination)}`));
            continue;
          }
        }
        const isDir = type === "directory";
        const accepted = (this.globs.length === 0 && local.rules.length === 0 && (isDir || this.typeGlobs.length === 0))
          ? (this.args.hidden || !entryName.startsWith("."))
          : await this.accepted(child, entryName, isDir, local.rules);
        if (!accepted) continue;
        if (isDir) {
          if (!await this.walkDirectory(child, display, depth + 1, ancestors, local.rules, local.repository, onTarget)) return false;
        } else if (type === "file") {
          if (Number.isFinite(this.args.maxFileSize)) {
            await assertPathRequirements(this.context, searchRequirements, ["metadata"], [child]);
            if ((await this.context.fs.stat(child, { signal: this.context.signal })).size > this.args.maxFileSize) continue;
          }
          const t = this.reusableTarget;
          t.path = child;
          t.label = display;
          t.explicit = false;
          t.recursive = true;
          t.canonicalPath = uniformCanonical && entryType === "file" ? (canonical === path ? child : `${canonical === "/" ? "" : canonical}/${entryName}`) : undefined;
          const res = onTarget(t);
          if (res instanceof Promise ? !(await res) : !res) return false;
        }
      } catch (error) { this.context.signal.throwIfAborted(); if (error instanceof SearchError || error instanceof RegexExecutionError) throw error; await this.report(error); }
    }
    return true;
    } finally {
      ancestors.delete(canonical);
    }
  }
  async walkTargets(paths: readonly string[], implicit: boolean, onTarget: (target: FileTarget) => boolean | Promise<boolean>): Promise<void> {
    for (const operand of paths) {
      if (operand !== "-") await assertPathRequirements(this.context, searchRequirements, ["metadata"], [operand]);
      const tickPending = this.limits.tick();
      if (tickPending) await tickPending;
      if (++this.limits.files > this.limits.maxFiles) throw new SearchError("filesystem entry limit exceeded");
      if (operand === "-") {
        if (!await onTarget({ path: "-", label: "<stdin>", explicit: true, recursive: false })) return;
        continue;
      }
      const path = pathFor(this.context, operand);
      try {
        const stat: FileStat = await this.context.fs.stat(path, { signal: this.context.signal });
        if (stat.type !== "directory") {
          if (!await onTarget({ path, label: operand, explicit: true, recursive: false })) return;
          continue;
        }
        let inherited: { rules: IgnoreRule[]; repository: boolean } = { rules: this.explicitRules, repository: false };
        const parents: string[] = [];
        let parent = dirname(resolvePath("/", path));
        if (this.args.ignoreParent) {
          while (true) { parents.unshift(parent); if (parent === "/") break; parent = dirname(parent); }
          for (const directory of parents) inherited = await this.load(directory, inherited.rules, inherited.repository);
        } else if (this.args.ignore && this.args.ignoreVcs && this.args.requireGit) {
          while (true) {
            inherited.repository ||= await this.exists(`${parent}/.git`);
            if (parent === "/") break;
            parent = dirname(parent);
          }
        }
        if (!await this.walkDirectory(path, implicit ? "" : operand, 0, new Map(), inherited.rules, inherited.repository, onTarget)) return;
      } catch (error) { this.context.signal.throwIfAborted(); if (error instanceof SearchError || error instanceof RegexExecutionError) throw error; await this.report(error); }
    }
  }
}
