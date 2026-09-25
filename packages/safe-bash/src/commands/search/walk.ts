import { assertCommandRequirements, dirname, FsError, isPathWithin, relativePath, resolvePath, type CommandContext, type DirectoryEntry, type FileStat } from "../../contracts/index.js";
import { getRuntimeBackingFileSystem } from "../../shell/runtime.js";
import { RegexExecutionError, type RegexSession } from "../regex-execution/portable.js";
import { Glob, ignoreRules, matchGlobs, type IgnoreRule } from "./glob.js";
import { SearchError, type Arguments } from "./options.js";
import { Limits, pathFor } from "./shared.js";
import { assertPathRequirements, searchRequirements } from "./requirements.js";
import { defaultFileTypes } from "./file-types.js";

export interface FileTarget { readonly path: string; readonly label: string; readonly explicit: boolean; readonly recursive: boolean; readonly canonicalPath?: string }

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
    if (cached) return { repository: cached.repository, rules: [...(cached.root ? inherited.filter(rule => rule.priority !== 1) : inherited), ...cached.rules] };
    const root = entries ? entries.some(entry => entry.name === ".git") : await this.exists(`${directory}/.git`);
    repository ||= root;
    if (root) inherited = inherited.filter(rule => rule.priority !== 1);
    const local: IgnoreRule[] = [];
    if (this.args.ignore) {
      const names: [string, number][] = [];
      if (this.args.ignoreVcs && (repository || !this.args.requireGit)) names.push([".gitignore", 1]);
      if (this.args.ignoreDot) names.push([".ignore", 2], [".rgignore", 3]);
      const backing = getRuntimeBackingFileSystem(this.context.fs);
      const uniformNonDev = backing !== undefined && backing.capabilitiesFor === undefined && base !== "/dev" && !base.startsWith("/dev/");
      let checkedIgnoreReq = false;
      for (const [name, priority] of names) {
        if (entries && !entries.some(entry => entry.name === name)) {
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
          local.push(...await ignoreRules(Buffer.from(data).toString("utf8"), base, priority, this.session));
        } catch (error) {
          this.context.signal.throwIfAborted();
          if (error instanceof RegexExecutionError) throw error;
          if ((error as { code?: string }).code !== "ENOENT") await this.report(error);
        }
      }
    }
    this.cache.set(key, { repository, rules: local, root });
    return { repository, rules: [...inherited, ...local] };
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
  private async walkDirectory(path: string, label: string, depth: number, ancestors: ReadonlyMap<string, string>, rules: readonly IgnoreRule[], repository: boolean, onTarget: (target: FileTarget) => Promise<boolean>): Promise<boolean> {
    if (depth >= this.args.maxDepth) return true;
    const backing = getRuntimeBackingFileSystem(this.context.fs);
    const uniformNonDevPath = backing !== undefined && backing.capabilitiesFor === undefined && path !== "/dev" && !path.startsWith("/dev/");
    if (uniformNonDevPath) assertCommandRequirements(this.context, searchRequirements, ["directory"]);
    else await assertPathRequirements(this.context, searchRequirements, ["directory"], [path]);
    const canonical = await this.context.fs.realpath(path, { signal: this.context.signal });
    const uniformCanonical = backing !== undefined && backing.capabilitiesFor === undefined && canonical !== "/dev" && !canonical.startsWith("/dev/");
    if (ancestors.has(canonical)) { await this.report(new SearchError(`File system loop found: ${label} points to an ancestor ${ancestors.get(canonical)}`)); return true; }
    const parents = new Map(ancestors); parents.set(canonical, label || ".");
    const maxEntries = this.limits.maxFiles - this.limits.files;
    let entries: DirectoryEntry[];
    try {
      entries = await (uniformCanonical ? backing : this.context.fs).readdir(uniformCanonical ? canonical : path, { signal: this.context.signal,
        ...(Number.isFinite(maxEntries) ? { maxEntries } : {}) });
    } catch (error) {
      this.context.signal.throwIfAborted();
      if (Number.isFinite(maxEntries) && error instanceof FsError && error.code === "EFBIG" && error.syscall === "readdir")
        throw new SearchError("filesystem entry limit exceeded");
      throw error;
    }
    this.context.signal.throwIfAborted();
    if (entries.length > maxEntries) throw new SearchError("filesystem entry limit exceeded");
    const local = await this.load(path, rules, repository, entries);
    entries.sort((left, right) => compareEntryNames(left.name, right.name));
    for (const entry of entries) {
      const tickPending = this.limits.tick();
      if (tickPending) await tickPending;
      if (++this.limits.files > this.limits.maxFiles) throw new SearchError("filesystem entry limit exceeded");
      const child = `${path.endsWith("/") ? path.slice(0, -1) : path}/${entry.name}`;
      const display = label ? `${label.endsWith("/") ? label.slice(0, -1) : label}/${entry.name}` : entry.name;
      try {
        if (entry.type === "symlink" && !this.args.follow) continue;
        if (entry.type === "symlink") await assertPathRequirements(this.context, searchRequirements, ["metadata"], [child]);
        const type = entry.type === "symlink" ? (await this.context.fs.stat(child, { signal: this.context.signal })).type : entry.type;
        if (entry.type === "symlink" && type === "directory") {
          await assertPathRequirements(this.context, searchRequirements, ["canonical"], [child]);
          const destination = await this.context.fs.realpath(child, { signal: this.context.signal });
          if (parents.has(destination)) {
            await this.report(new SearchError(`File system loop found: ${display} points to an ancestor ${parents.get(destination)}`));
            continue;
          }
        }
        const isDir = type === "directory";
        const accepted = (this.globs.length === 0 && local.rules.length === 0 && (isDir || this.typeGlobs.length === 0))
          ? (this.args.hidden || !entry.name.startsWith("."))
          : await this.accepted(child, entry.name, isDir, local.rules);
        if (!accepted) continue;
        if (isDir) {
          if (!await this.walkDirectory(child, display, depth + 1, parents, local.rules, local.repository, onTarget)) return false;
        } else if (type === "file") {
          if (Number.isFinite(this.args.maxFileSize)) {
            await assertPathRequirements(this.context, searchRequirements, ["metadata"], [child]);
            if ((await this.context.fs.stat(child, { signal: this.context.signal })).size > this.args.maxFileSize) continue;
          }
          if (!await onTarget({ path: child, label: display, explicit: false, recursive: true, ...(uniformCanonical && entry.type === "file" ? { canonicalPath: `${canonical === "/" ? "" : canonical}/${entry.name}` } : {}) })) return false;
        }
      } catch (error) { this.context.signal.throwIfAborted(); if (error instanceof SearchError || error instanceof RegexExecutionError) throw error; await this.report(error); }
    }
    return true;
  }
  async walkTargets(paths: readonly string[], implicit: boolean, onTarget: (target: FileTarget) => Promise<boolean>): Promise<void> {
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
