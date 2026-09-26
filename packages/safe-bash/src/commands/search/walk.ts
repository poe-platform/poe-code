import { tryGetMemoryDirectoryEntryNamesSync } from "@poe-code/safe-fs/core";
import { assertCommandRequirements, dirname, FsError, isPathWithin, relativePath, resolvePath, type CommandContext, type DirectoryEntry, type FileStat } from "../../contracts/index.js";
import { chargeRuntimeFileSystemOperation, getRuntimeBackingFileSystem } from "../../fs/creation-mask.js";
import { RegexExecutionError, type RegexSession } from "../regex-execution/portable.js";
import { Glob, ignoreRules, matchGlobs, type IgnoreRule } from "./glob.js";
import { SearchError, type Arguments } from "./options.js";
import { Limits, pathFor } from "./shared.js";
import { assertPathRequirements, searchRequirements } from "./requirements.js";
import { defaultFileTypes } from "./file-types.js";

export interface FileTarget {
  path: string;
  label: string;
  explicit: boolean;
  recursive: boolean;
  canonicalPath?: string | undefined;
  memoryView?: Uint8Array | undefined;
  dirLabel?: string | undefined;
  entryName?: string | undefined;
  _label?: string | undefined;
  _hasCanonical?: boolean | undefined;
}

class ReusableFileTarget implements FileTarget {
  _path: string | undefined = "";
  _label: string | undefined = "";
  _canonicalPath: string | undefined;
  _hasCanonical = false;
  dirPath = "";
  dirLabel = "";
  entryName: string | undefined;
  explicit = false;
  recursive = true;
  memoryView: Uint8Array | undefined;

  get path(): string {
    return this._path ??= `${this.dirPath}/${this.entryName!}`;
  }
  set path(v: string) {
    this._path = v;
    this.entryName = undefined;
  }
  get label(): string {
    return this._label ??= (this.dirLabel === this.dirPath ? this.path : (this.dirLabel ? `${this.dirLabel}/${this.entryName!}` : this.entryName!));
  }
  set label(v: string) {
    this._label = v;
  }
  get canonicalPath(): string | undefined {
    if (this._canonicalPath !== undefined) return this._canonicalPath;
    return this._hasCanonical ? this.path : undefined;
  }
  set canonicalPath(v: string | undefined) {
    this._canonicalPath = v;
    this._hasCanonical = v !== undefined;
  }
}
const EMPTY_IGNORE_RULES: IgnoreRule[] = [];
const EMPTY_GLOBS: { glob: Glob; include: boolean }[] = [];

let sortCheckPrevKey = "";
let sortCheckSorted = true;
let sortCheckHasSymlink = false;
function sortCheckVisitor(v: { readonly type: string }, k: string): void {
  if (v.type === "symlink") sortCheckHasSymlink = true;
  if (sortCheckPrevKey > k) sortCheckSorted = false;
  sortCheckPrevKey = k;
}
function checkMemDirEntries(map: ReadonlyMap<string, { readonly type: string }>, checkSymlink: boolean): boolean {
  sortCheckPrevKey = "";
  sortCheckSorted = true;
  sortCheckHasSymlink = false;
  map.forEach(sortCheckVisitor);
  return sortCheckSorted && (!checkSymlink || !sortCheckHasSymlink);
}
const syncWalkBuffer: unknown[] = new Array(256);
let syncWalkBufferTop = 0;
const defaultDateNow = Date.now;

function isFastEntriesMapSorted(map: { readonly size?: number; readonly _next?: number; readonly _keys?: (string | undefined)[] }): boolean {
  const len = map._next;
  const keys = map._keys;
  if (len === undefined || keys === undefined || map.size !== len) return false;
  for (let i = 1; i < len; i++) {
    if (keys[i - 1]! > keys[i]!) return false;
  }
  return true;
}
function stageMemDirVisitor(v: { readonly type: string }, k: string): void {
  if (sortCheckPrevKey > k) sortCheckSorted = false;
  sortCheckPrevKey = k;
  syncWalkBuffer[syncWalkBufferTop++] = k;
  syncWalkBuffer[syncWalkBufferTop++] = v;
}
function checkAndStageMemDirEntries(map: ReadonlyMap<string, { readonly type: string }>, baseOffset: number): number {
  sortCheckPrevKey = "";
  sortCheckSorted = true;
  syncWalkBufferTop = baseOffset;
  map.forEach(stageMemDirVisitor);
  if (!sortCheckSorted) {
    syncWalkBuffer.fill(undefined, baseOffset, syncWalkBufferTop);
    syncWalkBufferTop = baseOffset;
    return -1;
  }
  return syncWalkBufferTop;
}
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
  private globs!: { glob: Glob; include: boolean }[];
  private hasPositive!: boolean;
  private typeGlobs: { glob: Glob; include: boolean }[] = EMPTY_GLOBS;
  private hasPositiveType!: boolean;
  private cache: Map<string, { rules: IgnoreRule[]; repository: boolean; root: boolean }> | undefined;
  private explicitRules: IgnoreRule[] = EMPTY_IGNORE_RULES;
  private uniformDirAdmitted = false;
  private uniformCanonicalAdmitted: boolean | undefined;
  private uniformReaddirAdmitted: boolean | undefined;
  private uniformIgnoreAdmitted = false;
  private syncWalkNow = 0;
  constructor(private context: CommandContext, private args: Arguments, private limits: Limits, private report: (error: unknown) => Promise<void>, private session: RegexSession) {
    this.resetForRun(context, args, limits, report, session);
  }
  resetForRun(context: CommandContext, args: Arguments, limits: Limits, report: (error: unknown) => Promise<void>, session: RegexSession): void {
    this.context = context;
    this.args = args;
    this.limits = limits;
    this.report = report;
    this.session = session;
    this.globs = args.globs.length
      ? args.globs.map(({ source, insensitive }) => ({ glob: new Glob(source.startsWith("!") ? source.slice(1) : source, insensitive), include: !source.startsWith("!") }))
      : EMPTY_GLOBS;
    this.hasPositive = this.globs.length > 0 && this.globs.some(rule => rule.include);
    this.hasPositiveType = args.types.length > 0 && args.types.some(rule => rule.include);
    this.typeGlobs = EMPTY_GLOBS;
    this.cache = undefined;
    this.explicitRules = EMPTY_IGNORE_RULES;
    this.uniformDirAdmitted = false;
    this.uniformCanonicalAdmitted = undefined;
    this.uniformReaddirAdmitted = undefined;
    this.uniformIgnoreAdmitted = false;
    this.syncWalkNow = 0;
  }
  needsValidation(): boolean {
    return this.globs.length > 0 || this.args.types.length > 0 || (this.args.ignoreFiles && this.args.ignorePaths.length > 0);
  }
  async validate(): Promise<void> {
    if (this.globs.length) await matchGlobs(this.globs.map(rule => rule.glob), [], this.session);
    if (this.args.types.length) {
      this.typeGlobs = [];
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
    if (this.args.ignoreFiles && this.args.ignorePaths.length) {
      this.explicitRules = [];
      for (const operand of this.args.ignorePaths) {
        const path = pathFor(this.context, operand);
        await assertPathRequirements(this.context, searchRequirements, ["ignore-file"], [path]);
        const bytes = await this.context.fs.readFile(path, { signal: this.context.signal });
        this.explicitRules.push(...await ignoreRules(Buffer.from(bytes).toString("utf8"), this.context.cwd, 0, this.session));
      }
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
    const cached = this.cache?.get(key);
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
    if (this.cache || local !== EMPTY_IGNORE_RULES || root || directory !== "/") {
      (this.cache ??= new Map()).set(key, { repository, rules: local, root });
    }
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
  private readonly reusableTarget = new ReusableFileTarget();
  private walkDirectory(path: string, label: string, depth: number, ancestors: Map<string, string>, rules: readonly IgnoreRule[], repository: boolean, onTarget: (target: FileTarget) => boolean | Promise<boolean>): boolean | Promise<boolean> {
    if (depth >= this.args.maxDepth) return true;
    const backing = getRuntimeBackingFileSystem(this.context.fs);
    const uniformNonDevPath = backing !== undefined && backing.capabilitiesFor === undefined && path !== "/dev" && !path.startsWith("/dev/");
    if (uniformNonDevPath && this.globs.length === 0 && rules.length === 0 && this.typeGlobs.length === 0 && !Number.isFinite(this.args.maxFileSize)) {
      if (!this.uniformDirAdmitted) {
        assertCommandRequirements(this.context, searchRequirements, ["directory"]);
        this.uniformDirAdmitted = true;
      } else {
        this.context.signal.throwIfAborted();
      }
      const canTryMemDir = this.uniformCanonicalAdmitted ??= (this.context.fs.capabilities.realpath !== false && backing.capabilities.realpath !== false && (assertCommandRequirements(this.context, searchRequirements, ["canonical"]), true));
      const memDirEntries = canTryMemDir ? tryGetMemoryDirectoryEntryNamesSync(backing, path) : undefined;
      if (
        memDirEntries !== undefined &&
        !ancestors.has(path) &&
        (this.uniformReaddirAdmitted ??= (this.context.fs.capabilities.readdir !== false && backing.capabilities.readdir !== false)) &&
        memDirEntries.size <= this.limits.maxFiles - this.limits.files &&
        (!this.args.ignore || (!memDirEntries.has(".git") && !memDirEntries.has(".gitignore") && !memDirEntries.has(".ignore") && !memDirEntries.has(".rgignore")))
      ) {
        if (this.args.ignore && !this.uniformIgnoreAdmitted) {
          assertCommandRequirements(this.context, searchRequirements, ["metadata", "ignore-file"]);
          this.uniformIgnoreAdmitted = true;
        }
        if (checkMemDirEntries(memDirEntries, this.args.follow)) {
          chargeRuntimeFileSystemOperation(this.context.fs);
          ancestors.set(path, label || ".");
          const pathPrefix = path.endsWith("/") ? path : `${path}/`;
          const labelPrefix = label === path ? pathPrefix : (label ? (label.endsWith("/") ? label : `${label}/`) : "");
          const samePrefix = pathPrefix === labelPrefix;
          const allowHidden = this.args.hidden;
          let handedOff = false;
          let entryIdx = 0;
          const now = Date.now();
          try {
            for (const [entryName, entryMeta] of memDirEntries) {
              const entryType = entryMeta.type;
              const tickPending = this.limits.tick();
              if (tickPending) {
                handedOff = true;
                return this.finishFastMemDirectoryAsync(path, pathPrefix, labelPrefix, depth, ancestors, rules, repository, allowHidden, memDirEntries, entryIdx, tickPending, true, onTarget);
              }
              if (++this.limits.files > this.limits.maxFiles) throw new SearchError("filesystem entry limit exceeded");
              if (entryType !== "symlink" && (allowHidden || !entryName.startsWith("."))) {
                const child = `${pathPrefix}${entryName}`;
                const display = samePrefix ? child : (labelPrefix ? `${labelPrefix}${entryName}` : entryName);
                try {
                  if (entryType === "directory") {
                    const sub = this.walkDirectory(child, display, depth + 1, ancestors, rules, repository, onTarget);
                    if (sub instanceof Promise) {
                      handedOff = true;
                      return this.finishFastMemDirectoryAsync(path, pathPrefix, labelPrefix, depth, ancestors, rules, repository, allowHidden, memDirEntries, entryIdx + 1, sub, false, onTarget);
                    }
                    if (!sub) {
                      return false;
                    }
                  } else if (entryType === "file") {
                    const fileNode = entryMeta as { readonly type: "file"; readonly mode?: number; readonly data?: Uint8Array; atimeMs?: number };
                    const t = this.reusableTarget;
                    t.path = child;
                    t.label = display;
                    t.explicit = false;
                    t.recursive = true;
                    t.canonicalPath = child;
                    if (
                      fileNode.data !== undefined &&
                      fileNode.mode !== undefined &&
                      ((fileNode.mode >> 6) & 4) === 4 &&
                      fileNode.data.byteLength <= this.limits.maxFileBytes
                    ) {
                      fileNode.atimeMs = now;
                      t.memoryView = fileNode.data;
                    } else {
                      t.memoryView = undefined;
                    }
                    const res = onTarget(t);
                    t.memoryView = undefined;
                    if (res instanceof Promise) {
                      handedOff = true;
                      return this.finishFastMemDirectoryAsync(path, pathPrefix, labelPrefix, depth, ancestors, rules, repository, allowHidden, memDirEntries, entryIdx + 1, res, false, onTarget);
                    }
                    if (!res) {
                      return false;
                    }
                  }
                } catch (error) {
                  this.context.signal.throwIfAborted();
                  if (error instanceof SearchError || error instanceof RegexExecutionError) throw error;
                  handedOff = true;
                  return this.finishFastMemDirectoryAsync(path, pathPrefix, labelPrefix, depth, ancestors, rules, repository, allowHidden, memDirEntries, entryIdx + 1, this.report(error).then(() => true), false, onTarget);
                }
              }
              entryIdx++;
            }
            return true;
          } finally {
            if (!handedOff) ancestors.delete(path);
          }
        }
      }
    }
    return this.walkDirectoryAsync(path, label, depth, ancestors, rules, repository, onTarget);
  }
  private async finishFastMemDirectoryAsync(
    path: string,
    pathPrefix: string,
    labelPrefix: string,
    depth: number,
    ancestors: Map<string, string>,
    rules: readonly IgnoreRule[],
    repository: boolean,
    allowHidden: boolean,
    memDirEntries: ReadonlyMap<string, { readonly type: FileStat["type"] }>,
    startIdx: number,
    pending: Promise<void | boolean>,
    pendingIsTick: boolean,
    onTarget: (target: FileTarget) => boolean | Promise<boolean>,
  ): Promise<boolean> {
    try {
      if (!pendingIsTick) {
        try {
          if (!(await pending)) return false;
        } catch (error) {
          this.context.signal.throwIfAborted();
          if (error instanceof SearchError || error instanceof RegexExecutionError) throw error;
          await this.report(error);
        }
      }
      let idx = 0;
      for (const [entryName, entryMeta] of memDirEntries) {
        if (idx < startIdx) { idx++; continue; }
        if (idx === startIdx && pendingIsTick) {
          await pending;
        } else {
          const tickPending = this.limits.tick();
          if (tickPending) await tickPending;
        }
        idx++;
        if (++this.limits.files > this.limits.maxFiles) throw new SearchError("filesystem entry limit exceeded");
        const entryType = entryMeta.type;
        if (entryType === "symlink" || (!allowHidden && entryName.startsWith("."))) continue;
        const child = `${pathPrefix}${entryName}`;
        const display = labelPrefix ? `${labelPrefix}${entryName}` : entryName;
        try {
          if (entryType === "directory") {
            if (!(await this.walkDirectory(child, display, depth + 1, ancestors, rules, repository, onTarget))) return false;
          } else if (entryType === "file") {
            const t = this.reusableTarget;
            t.path = child;
            t.label = display;
            t.explicit = false;
            t.recursive = true;
            t.canonicalPath = child;
            const res = onTarget(t);
            if (res instanceof Promise ? !(await res) : !res) return false;
          }
        } catch (error) {
          this.context.signal.throwIfAborted();
          if (error instanceof SearchError || error instanceof RegexExecutionError) throw error;
          await this.report(error);
        }
      }
      return true;
    } finally {
      ancestors.delete(path);
    }
  }
  private async walkDirectoryAsync(path: string, label: string, depth: number, ancestors: Map<string, string>, rules: readonly IgnoreRule[], repository: boolean, onTarget: (target: FileTarget) => boolean | Promise<boolean>): Promise<boolean> {
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
    let localRules: IgnoreRule[] | undefined;
    let localRepository = repository;
    if (canFastMemReaddir && (!this.args.ignore || (!memDirEntries.has(".git") && !memDirEntries.has(".gitignore") && !memDirEntries.has(".ignore") && !memDirEntries.has(".rgignore")))) {
      if (this.args.ignore && !this.uniformIgnoreAdmitted) {
        assertCommandRequirements(this.context, searchRequirements, ["metadata", "ignore-file"]);
        this.uniformIgnoreAdmitted = true;
      }
      localRules = rules as IgnoreRule[];
    } else if (this.args.ignore) {
      const loaded = await this.load(path, rules, repository);
      localRules = loaded.rules;
      localRepository = loaded.repository;
    }
    const maxEntries = this.limits.maxFiles - this.limits.files;
    let entries: DirectoryEntry[] | undefined;
    let fastNames: string[] | undefined;
    let fastSortedKeys = false;
    if (canFastMemReaddir && memDirEntries.size <= maxEntries) {
      this.context.signal.throwIfAborted();
      let isSorted = true;
      let prevKey = "";
      for (const k of memDirEntries.keys()) {
        if (prevKey > k) { isSorted = false; break; }
        prevKey = k;
      }
      if (isSorted) {
        fastSortedKeys = true;
      } else {
        fastNames = Array.from(memDirEntries.keys());
        fastNames.sort(compareEntryNames);
      }
    } else {
      try {
        entries = await (uniformCanonical ? backing : this.context.fs).readdir(uniformCanonical ? canonical : path, { signal: this.context.signal,
          ...(Number.isFinite(maxEntries) ? { maxEntries } : {}) });
      } catch (error) {
        this.context.signal.throwIfAborted();
        if (Number.isFinite(maxEntries) && error instanceof FsError && error.code === "EFBIG" && error.syscall === "readdir") {
          if (!localRules) await this.load(path, rules, repository);
          throw new SearchError("filesystem entry limit exceeded");
        }
        throw error;
      }
      this.context.signal.throwIfAborted();
      if (entries.length > maxEntries) {
        if (!localRules) await this.load(path, rules, repository, entries);
        throw new SearchError("filesystem entry limit exceeded");
      }
      entries.sort((left, right) => compareEntryNames(left.name, right.name));
    }
    if (!localRules) {
      const loaded = await this.load(path, rules, repository, entries);
      localRules = loaded.rules;
      localRepository = loaded.repository;
    }
    const totalEntries = fastSortedKeys ? memDirEntries!.size : fastNames ? fastNames.length : entries!.length;
    const entryIter = fastSortedKeys ? memDirEntries!.entries() : undefined;
    for (let entryIdx = 0; entryIdx < totalEntries; entryIdx++) {
      let entryName: string;
      let entryType: DirectoryEntry["type"];
      if (entryIter) {
        const pair = entryIter.next().value!;
        entryName = pair[0];
        entryType = pair[1].type;
      } else if (fastNames) {
        entryName = fastNames[entryIdx]!;
        entryType = memDirEntries!.get(entryName)!.type;
      } else {
        const entry = entries![entryIdx]!;
        entryName = entry.name;
        entryType = entry.type;
      }
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
        const accepted = (this.globs.length === 0 && localRules.length === 0 && (isDir || this.typeGlobs.length === 0))
          ? (this.args.hidden || !entryName.startsWith("."))
          : await this.accepted(child, entryName, isDir, localRules);
        if (!accepted) continue;
        if (isDir) {
          if (!await this.walkDirectory(child, display, depth + 1, ancestors, localRules, localRepository, onTarget)) return false;
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

  private async finishWalkEntriesAsync(
    backing: NonNullable<ReturnType<typeof getRuntimeBackingFileSystem>>,
    cleanPath: string,
    cleanLabel: string,
    depth: number,
    rules: readonly IgnoreRule[],
    repository: boolean,
    onTarget: (target: FileTarget) => boolean | Promise<boolean>,
    memDirEntries: ReadonlyMap<string, { readonly type: string }>,
    startEntryIdx: number,
    pendingStep: Promise<boolean>,
  ): Promise<boolean> {
    if (!(await pendingStep)) return false;
    const samePrefix = cleanLabel === cleanPath;
    const iter = memDirEntries.entries();
    for (let i = 0; i < startEntryIdx; i++) iter.next();
    for (const [entryName, entryObj] of iter) {
      const tickPending = this.limits.tick();
      if (tickPending) await tickPending;
      if (++this.limits.files > this.limits.maxFiles) throw new SearchError("filesystem entry limit exceeded");
      if (!this.args.hidden && entryName.startsWith(".")) continue;
      const entryType = entryObj.type;
      const child = `${cleanPath}/${entryName}`;
      const display = samePrefix ? child : (cleanLabel ? `${cleanLabel}/${entryName}` : entryName);
      if (entryType === "directory") {
        const sub = this.tryWalkDirectorySync(backing, child, display, depth + 1, rules, repository, onTarget);
        if (!(sub instanceof Promise ? await sub : sub)) return false;
      } else if (entryType === "file") {
        const t = this.reusableTarget;
        t.path = child;
        t.label = display;
        t.explicit = false;
        t.recursive = true;
        t.canonicalPath = child;
        const res = onTarget(t);
        if (!(res instanceof Promise ? await res : res)) return false;
      }
    }
    return true;
  }

  private tryWalkDirectorySync(
    backing: NonNullable<ReturnType<typeof getRuntimeBackingFileSystem>>,
    path: string,
    label: string,
    depth: number,
    rules: readonly IgnoreRule[],
    repository: boolean,
    onTarget: (target: FileTarget) => boolean | Promise<boolean>,
    syncOnly = false,
    knownEntries?: ReadonlyMap<string, { readonly type: string }>,
  ): boolean | Promise<boolean> | null {
    if (depth > this.args.maxDepth) return true;
    if (
      path === "/dev" ||
      path.startsWith("/dev/") ||
      this.globs.length !== 0 ||
      rules.length !== 0 ||
      this.typeGlobs.length !== 0 ||
      Number.isFinite(this.args.maxFileSize)
    ) {
      if (syncOnly) return null;
      return this.walkDirectory(path, label, depth, new Map(), rules, repository, onTarget);
    }
    if (!this.uniformDirAdmitted) {
      assertCommandRequirements(this.context, searchRequirements, ["directory"]);
      this.uniformDirAdmitted = true;
    } else {
      this.context.signal.throwIfAborted();
    }
    if (!(this.uniformCanonicalAdmitted ??= (this.context.fs.capabilities.realpath !== false && backing.capabilities.realpath !== false && (assertCommandRequirements(this.context, searchRequirements, ["canonical"]), true)))) {
      if (syncOnly) return null;
      return this.walkDirectory(path, label, depth, new Map(), rules, repository, onTarget);
    }
    if (!(this.uniformReaddirAdmitted ??= (this.context.fs.capabilities.readdir !== false && backing.capabilities.readdir !== false))) {
      if (syncOnly) return null;
      return this.walkDirectory(path, label, depth, new Map(), rules, repository, onTarget);
    }
    const memDirEntries = knownEntries ?? tryGetMemoryDirectoryEntryNamesSync(backing, path);
    if (
      !memDirEntries ||
      (this.args.ignore && (memDirEntries.has(".git") || memDirEntries.has(".gitignore") || memDirEntries.has(".ignore") || memDirEntries.has(".rgignore"))) ||
      memDirEntries.size > this.limits.maxFiles - this.limits.files
    ) {
      if (syncOnly) return null;
      return this.walkDirectory(path, label, depth, new Map(), rules, repository, onTarget);
    }
    const fastMap = memDirEntries as unknown as { readonly size?: number; readonly _next?: number; readonly _keys?: string[]; readonly _vals?: unknown[] };
    if (syncOnly && isFastEntriesMapSorted(fastMap)) {
      if (this.args.ignore && !this.uniformIgnoreAdmitted) {
        assertCommandRequirements(this.context, searchRequirements, ["metadata", "ignore-file"]);
        this.uniformIgnoreAdmitted = true;
      }
      const cleanPath = path.endsWith("/") ? path.slice(0, -1) : path;
      const cleanLabel = label === path ? cleanPath : (label && label.endsWith("/") ? label.slice(0, -1) : label);
      const samePrefix = cleanLabel === cleanPath;
      const keys = fastMap._keys!;
      const vals = fastMap._vals!;
      const len = fastMap._next!;
      const customClock = Date.now !== defaultDateNow;
      for (let entryIdx = 0; entryIdx < len; entryIdx++) {
        const entryName = keys[entryIdx]!;
        const entryObj = vals[entryIdx] as { readonly type: DirectoryEntry["type"]; readonly mode?: number; readonly data?: Uint8Array; readonly entries?: ReadonlyMap<string, { readonly type: string }>; atimeMs?: number; ctimeMs?: number };
        if (this.limits.tick()) return null;
        if (++this.limits.files > this.limits.maxFiles) throw new SearchError("filesystem entry limit exceeded");
        if (!this.args.hidden && entryName.startsWith(".")) continue;
        const entryType = entryObj.type;
        if (entryType === "directory") {
          const child = `${cleanPath}/${entryName}`;
          const display = samePrefix ? child : (cleanLabel ? `${cleanLabel}/${entryName}` : entryName);
          const childEntries = entryObj.entries !== undefined && entryObj.mode !== undefined && ((entryObj.mode >> 6) & 4) === 4 ? entryObj.entries : undefined;
          const sub = this.tryWalkDirectorySync(backing, child, display, depth + 1, rules, repository, onTarget, true, childEntries);
          if (sub === null) return null;
          if (!sub) return false;
        } else if (entryType === "file") {
          const t = this.reusableTarget;
          t.dirPath = cleanPath;
          t.dirLabel = cleanLabel;
          t.entryName = entryName;
          t._path = undefined;
          t._label = undefined;
          t._canonicalPath = undefined;
          t._hasCanonical = true;
          t.explicit = false;
          t.recursive = true;
          if (
            entryObj.data !== undefined &&
            entryObj.mode !== undefined &&
            ((entryObj.mode >> 6) & 4) === 4 &&
            entryObj.data.byteLength <= this.limits.maxFileBytes
          ) {
            if (customClock || entryObj.atimeMs !== entryObj.ctimeMs) entryObj.atimeMs = this.syncWalkNow;
            t.memoryView = entryObj.data;
          } else {
            t.memoryView = undefined;
          }
          const res = onTarget(t);
          t.memoryView = undefined;
          if (res instanceof Promise) return null;
          if (!res) return false;
        }
      }
      return true;
    }
    const baseOffset = syncWalkBufferTop;
    const endOffset = checkAndStageMemDirEntries(memDirEntries, baseOffset);
    if (endOffset < 0) {
      if (syncOnly) return null;
      return this.walkDirectory(path, label, depth, new Map(), rules, repository, onTarget);
    }
    if (this.args.ignore && !this.uniformIgnoreAdmitted) {
      assertCommandRequirements(this.context, searchRequirements, ["metadata", "ignore-file"]);
      this.uniformIgnoreAdmitted = true;
    }
    const cleanPath = path.endsWith("/") ? path.slice(0, -1) : path;
    const cleanLabel = label === path ? cleanPath : (label && label.endsWith("/") ? label.slice(0, -1) : label);
    const samePrefix = cleanLabel === cleanPath;
    try {
      for (let bufIdx = baseOffset, entryIdx = 0; bufIdx < endOffset; bufIdx += 2, entryIdx++) {
        const entryName = syncWalkBuffer[bufIdx] as string;
        const entryObj = syncWalkBuffer[bufIdx + 1] as { readonly type: DirectoryEntry["type"]; readonly mode?: number; readonly data?: Uint8Array; atimeMs?: number };
        const tickPending = this.limits.tick();
        if (++this.limits.files > this.limits.maxFiles) throw new SearchError("filesystem entry limit exceeded");
        if (!this.args.hidden && entryName.startsWith(".")) {
          if (tickPending) {
            if (syncOnly) return null;
            return this.finishWalkEntriesAsync(backing, cleanPath, cleanLabel, depth, rules, repository, onTarget, memDirEntries, entryIdx + 1, tickPending.then(() => true));
          }
          continue;
        }
        const entryType = entryObj.type;
        if (tickPending) {
          if (syncOnly) return null;
          const child = `${cleanPath}/${entryName}`;
          const display = samePrefix ? child : (cleanLabel ? `${cleanLabel}/${entryName}` : entryName);
          const stepPromise = tickPending.then(() => {
            if (entryType === "directory") {
              return this.tryWalkDirectorySync(backing, child, display, depth + 1, rules, repository, onTarget) as boolean | Promise<boolean>;
            }
            if (entryType === "file") {
              const t = this.reusableTarget;
              t.path = child;
              t.label = display;
              t.explicit = false;
              t.recursive = true;
              t.canonicalPath = child;
              return onTarget(t);
            }
            return true;
          });
          return this.finishWalkEntriesAsync(backing, cleanPath, cleanLabel, depth, rules, repository, onTarget, memDirEntries, entryIdx + 1, stepPromise);
        }
        if (entryType === "directory") {
          const child = `${cleanPath}/${entryName}`;
          const display = samePrefix ? child : (cleanLabel ? `${cleanLabel}/${entryName}` : entryName);
          const sub = this.tryWalkDirectorySync(backing, child, display, depth + 1, rules, repository, onTarget, syncOnly);
          if (sub === null) return null;
          if (sub instanceof Promise) {
            return this.finishWalkEntriesAsync(backing, cleanPath, cleanLabel, depth, rules, repository, onTarget, memDirEntries, entryIdx + 1, sub);
          }
          if (!sub) return false;
        } else if (entryType === "file") {
          const t = this.reusableTarget;
          t.dirPath = cleanPath;
          t.dirLabel = cleanLabel;
          t.entryName = entryName;
          t._path = undefined;
          // Keep the explicit root separator when the path prefix would otherwise be empty.
          t._label = label === "/" ? `/${entryName}` : undefined;
          t._canonicalPath = undefined;
          t._hasCanonical = true;
          t.explicit = false;
          t.recursive = true;
          if (
            entryObj.data !== undefined &&
            entryObj.mode !== undefined &&
            ((entryObj.mode >> 6) & 4) === 4 &&
            entryObj.data.byteLength <= this.limits.maxFileBytes
          ) {
            entryObj.atimeMs = this.syncWalkNow;
            t.memoryView = entryObj.data;
          } else {
            t.memoryView = undefined;
          }
          const res = onTarget(t);
          t.memoryView = undefined;
          if (res instanceof Promise) {
            return this.finishWalkEntriesAsync(backing, cleanPath, cleanLabel, depth, rules, repository, onTarget, memDirEntries, entryIdx + 1, res);
          }
          if (!res) return false;
        }
      }
      return true;
    } finally {
      syncWalkBuffer.fill(undefined, baseOffset, endOffset);
      syncWalkBufferTop = baseOffset;
    }
  }
  walkTargetsSyncOrAsync(
    paths: readonly string[],
    implicit: boolean,
    onTarget: (target: FileTarget) => boolean | Promise<boolean>,
    syncOnly = false,
  ): Promise<void> | null | undefined {
    if (paths.length === 1 && paths[0] !== "-") {
      const fastMem = (this.context as {
        _fastMemoryBackingFs?: NonNullable<ReturnType<typeof getRuntimeBackingFileSystem>> & { symlinkCount?: number };
      })._fastMemoryBackingFs;
      if (
        fastMem !== undefined &&
        fastMem.capabilitiesFor === undefined &&
        fastMem.symlinkCount === 0 &&
        this.explicitRules === EMPTY_IGNORE_RULES &&
        fastMem.capabilities.stat !== false &&
        fastMem.capabilities.read !== false &&
        fastMem.capabilities.readdir !== false &&
        fastMem.capabilities.realpath !== false
      ) {
        const operand = paths[0]!;
        const path = pathFor(this.context, operand);
        const targetEntries = path !== "/dev" && !path.startsWith("/dev/") ? tryGetMemoryDirectoryEntryNamesSync(fastMem, path) : undefined;
        if (targetEntries !== undefined) {
          const parent = dirname(resolvePath("/", path));
          const rootEntries = parent === "/" ? tryGetMemoryDirectoryEntryNamesSync(fastMem, "/") : undefined;
          if (
            rootEntries !== undefined &&
            !rootEntries.has(".git") &&
            (!this.args.ignore || (!rootEntries.has(".gitignore") && !rootEntries.has(".ignore") && !rootEntries.has(".rgignore")))
          ) {
            this.context.signal.throwIfAborted();
            const tickPending = this.limits.tick();
            if (!tickPending) {
              if (++this.limits.files > this.limits.maxFiles) throw new SearchError("filesystem entry limit exceeded");
              this.uniformDirAdmitted = true;
              this.uniformCanonicalAdmitted = true;
              this.uniformReaddirAdmitted = true;
              this.uniformIgnoreAdmitted = true;
              if (Date.now !== defaultDateNow) this.syncWalkNow = Date.now();
              const syncWalk = this.tryWalkDirectorySync(fastMem, path, implicit ? "" : operand, 0, EMPTY_IGNORE_RULES, false, onTarget, syncOnly, targetEntries);
              if (syncWalk === null) return null;
              return syncWalk instanceof Promise ? syncWalk.then(() => undefined) : undefined;
            }
          }
        }
      }
    }
    if (syncOnly) return null;
    return this.walkTargets(paths, implicit, onTarget);
  }
  async walkTargets(paths: readonly string[], implicit: boolean, onTarget: (target: FileTarget) => boolean | Promise<boolean>): Promise<void> {
    const backing = getRuntimeBackingFileSystem(this.context.fs) as (NonNullable<ReturnType<typeof getRuntimeBackingFileSystem>> & { symlinkCount?: number }) | undefined;
    const uniformBacking = backing !== undefined && backing.capabilitiesFor === undefined ? backing : undefined;
    for (const operand of paths) {
      const path = operand === "-" ? "-" : pathFor(this.context, operand);
      const uniformNonDev = uniformBacking !== undefined && operand !== "-" && path !== "/dev" && !path.startsWith("/dev/");
      if (operand !== "-") {
        if (uniformNonDev) {
          assertCommandRequirements(this.context, searchRequirements, ["metadata"]);
        } else {
          await assertPathRequirements(this.context, searchRequirements, ["metadata"], [operand]);
        }
      }
      const tickPending = this.limits.tick();
      if (tickPending) await tickPending;
      if (++this.limits.files > this.limits.maxFiles) throw new SearchError("filesystem entry limit exceeded");
      if (operand === "-") {
        if (!await onTarget({ path: "-", label: "<stdin>", explicit: true, recursive: false })) return;
        continue;
      }
      try {
        if (
          uniformNonDev &&
          uniformBacking.symlinkCount === 0 &&
          this.explicitRules === EMPTY_IGNORE_RULES &&
          this.context.fs.capabilities.stat !== false &&
          uniformBacking.capabilities.stat !== false &&
          this.context.fs.capabilities.read !== false &&
          uniformBacking.capabilities.read !== false &&
          tryGetMemoryDirectoryEntryNamesSync(uniformBacking, path) !== undefined
        ) {
          const parent = dirname(resolvePath("/", path));
          const rootEntries = parent === "/" ? tryGetMemoryDirectoryEntryNamesSync(uniformBacking, "/") : undefined;
          if (
            rootEntries !== undefined &&
            !rootEntries.has(".git") &&
            (!this.args.ignore || (!rootEntries.has(".gitignore") && !rootEntries.has(".ignore") && !rootEntries.has(".rgignore")))
          ) {
            if (this.args.ignoreParent && this.args.ignore && !this.uniformIgnoreAdmitted) {
              assertCommandRequirements(this.context, searchRequirements, ["metadata", "ignore-file"]);
              this.uniformIgnoreAdmitted = true;
            }
            this.syncWalkNow = Date.now();
            const syncWalk = this.tryWalkDirectorySync(uniformBacking, path, implicit ? "" : operand, 0, EMPTY_IGNORE_RULES, false, onTarget);
            if (!(syncWalk instanceof Promise ? await syncWalk : syncWalk)) return;
            continue;
          }
        }
        const stat: FileStat = await this.context.fs.stat(path, { signal: this.context.signal });
        if (stat.type !== "directory") {
          if (!await onTarget({ path, label: operand, explicit: true, recursive: false })) return;
          continue;
        }
        let inherited: { rules: IgnoreRule[]; repository: boolean } = { rules: this.explicitRules, repository: false };
        let parent = dirname(resolvePath("/", path));
        if (this.args.ignoreParent) {
          if (parent === "/") {
            inherited = await this.load("/", inherited.rules, inherited.repository);
          } else {
            const parents: string[] = [];
            while (true) { parents.unshift(parent); if (parent === "/") break; parent = dirname(parent); }
            for (const directory of parents) inherited = await this.load(directory, inherited.rules, inherited.repository);
          }
        } else if (this.args.ignore && this.args.ignoreVcs && this.args.requireGit) {
          while (true) {
            inherited.repository ||= await this.exists(`${parent}/.git`);
            if (parent === "/") break;
            parent = dirname(parent);
          }
        }
        if (uniformBacking && uniformBacking.symlinkCount === 0) {
          this.syncWalkNow = Date.now();
          const syncWalk = this.tryWalkDirectorySync(uniformBacking, path, implicit ? "" : operand, 0, inherited.rules, inherited.repository, onTarget);
          if (!(syncWalk instanceof Promise ? await syncWalk : syncWalk)) return;
        } else if (!await this.walkDirectory(path, implicit ? "" : operand, 0, new Map(), inherited.rules, inherited.repository, onTarget)) return;
      } catch (error) { this.context.signal.throwIfAborted(); if (error instanceof SearchError || error instanceof RegexExecutionError) throw error; await this.report(error); }
    }
  }
}
