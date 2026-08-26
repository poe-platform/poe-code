import { dirname, isPathWithin, relativePath, resolvePath, type CommandContext, type FileStat } from "../../contracts/index.js";
import { Glob, ignoreRules, type IgnoreRule } from "./glob.js";
import { SearchError, type Arguments } from "./options.js";
import { Limits, pathFor } from "./shared.js";

export interface FileTarget { readonly path: string; readonly label: string; readonly explicit: boolean; readonly recursive: boolean }

export class Walker {
  private readonly globs: { glob: Glob; include: boolean }[];
  private readonly hasPositive: boolean;
  private readonly cache = new Map<string, { rules: IgnoreRule[]; repository: boolean; root: boolean }>();
  constructor(private readonly context: CommandContext, private readonly args: Arguments, private readonly limits: Limits, private readonly report: (error: unknown) => Promise<void>) {
    if (args.globs.length > 1024) throw new SearchError("glob count limit exceeded");
    this.globs = args.globs.map(({ source, insensitive }) => ({ glob: new Glob(source.startsWith("!") ? source.slice(1) : source, insensitive), include: !source.startsWith("!") }));
    this.hasPositive = this.globs.some(rule => rule.include);
  }
  private async exists(path: string): Promise<boolean> {
    try { await this.context.fs.lstat(path, { signal: this.context.signal }); return true; }
    catch (error) { if ((error as { code?: string }).code === "ENOENT") return false; throw error; }
  }
  private async load(directory: string, inherited: readonly IgnoreRule[], repository: boolean): Promise<{ rules: IgnoreRule[]; repository: boolean }> {
    const base = resolvePath("/", directory);
    const key = `${base}:${repository}`;
    const cached = this.cache.get(key);
    if (cached) return { repository: cached.repository, rules: [...(cached.root ? inherited.filter(rule => rule.priority !== 1) : inherited), ...cached.rules] };
    const root = await this.exists(`${directory}/.git`);
    repository ||= root;
    if (root) inherited = inherited.filter(rule => rule.priority !== 1);
    const local: IgnoreRule[] = [];
    if (this.args.ignore) {
      const names: [string, number][] = [];
      if (this.args.ignoreVcs && (repository || !this.args.requireGit)) names.push([".gitignore", 1]);
      if (this.args.ignoreDot) names.push([".ignore", 2], [".rgignore", 3]);
      for (const [name, priority] of names) {
        try {
          const data = await this.context.fs.readFile(`${directory}/${name}`, { signal: this.context.signal, maxBytes: 1024 * 1024 });
          local.push(...ignoreRules(Buffer.from(data).toString("utf8"), base, priority));
        } catch (error) {
          if ((error as { code?: string }).code !== "ENOENT") await this.report(error);
        }
      }
    }
    this.cache.set(key, { repository, rules: local, root });
    if (inherited.length + local.length > 10000) throw new SearchError("ignore rule count limit exceeded");
    return { repository, rules: [...inherited, ...local] };
  }
  private accepted(path: string, name: string, directory: boolean, rules: readonly IgnoreRule[]): boolean {
    let override: boolean | undefined;
    const relative = relativePath(this.context.cwd, path);
    for (const rule of this.globs) if (rule.glob.matches(relative, directory, false)) override = rule.include;
    if (override !== undefined) return override;
    if (this.hasPositive && !directory) return false;
    let include: boolean | undefined;
    let priority = -1;
    for (const rule of rules) {
      if (rule.priority < priority || !isPathWithin(rule.base, path)) continue;
      const candidate = relativePath(rule.base, path);
      if (rule.glob.matches(candidate, directory, false)) {
        priority = rule.priority; include = rule.include;
      }
    }
    if (include !== undefined) return include;
    return this.args.hidden || !name.startsWith(".");
  }
  private async* directory(path: string, label: string, depth: number, ancestors: ReadonlyMap<string, string>, rules: readonly IgnoreRule[], repository: boolean): AsyncGenerator<FileTarget> {
    if (depth >= this.args.maxDepth) return;
    const canonical = await this.context.fs.realpath(path, { signal: this.context.signal });
    if (ancestors.has(canonical)) { await this.report(new SearchError(`File system loop found: ${label} points to an ancestor ${ancestors.get(canonical)}`)); return; }
    const parents = new Map(ancestors); parents.set(canonical, label || ".");
    const local = await this.load(path, rules, repository);
    const entries = (await this.context.fs.readdir(path, { signal: this.context.signal })).sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    for (const entry of entries) {
      await this.limits.tick();
      if (++this.limits.files > this.limits.maxFiles) throw new SearchError("filesystem entry limit exceeded");
      const child = `${path.replace(/\/$/u, "")}/${entry.name}`;
      const display = label ? `${label.replace(/\/$/u, "")}/${entry.name}` : entry.name;
      try {
        if (entry.type === "symlink" && !this.args.follow) continue;
        const type = entry.type === "symlink" ? (await this.context.fs.stat(child, { signal: this.context.signal })).type : entry.type;
        if (entry.type === "symlink" && type === "directory") {
          const destination = await this.context.fs.realpath(child, { signal: this.context.signal });
          if (parents.has(destination)) {
            await this.report(new SearchError(`File system loop found: ${display} points to an ancestor ${parents.get(destination)}`));
            continue;
          }
        }
        if (!this.accepted(child, entry.name, type === "directory", local.rules)) continue;
        if (type === "directory") yield* this.directory(child, display, depth + 1, parents, local.rules, local.repository);
        else if (type === "file") yield { path: child, label: display, explicit: false, recursive: true };
      } catch (error) { if (error instanceof SearchError) throw error; await this.report(error); }
    }
  }
  async* targets(paths: readonly string[], implicit = false): AsyncGenerator<FileTarget> {
    for (const operand of paths) {
      await this.limits.tick();
      if (++this.limits.files > this.limits.maxFiles) throw new SearchError("filesystem entry limit exceeded");
      if (operand === "-") { yield { path: "-", label: "<stdin>", explicit: true, recursive: false }; continue; }
      const path = pathFor(this.context, operand);
      try {
        const stat: FileStat = await this.context.fs.stat(path, { signal: this.context.signal });
        if (stat.type !== "directory") { yield { path, label: operand, explicit: true, recursive: false }; continue; }
        let inherited: { rules: IgnoreRule[]; repository: boolean } = { rules: [], repository: false };
        const parents: string[] = [];
        let parent = dirname(resolvePath("/", path));
        if (this.args.ignoreParent) {
          while (true) { parents.unshift(parent); if (parent === "/") break; parent = dirname(parent); }
          for (const directory of parents) inherited = await this.load(directory, inherited.rules, inherited.repository);
        } else {
          while (true) {
            inherited.repository ||= await this.exists(`${parent}/.git`);
            if (parent === "/") break;
            parent = dirname(parent);
          }
        }
        yield* this.directory(path, implicit ? "" : operand, 0, new Map(), inherited.rules, inherited.repository);
      } catch (error) { if (error instanceof SearchError) throw error; await this.report(error); }
    }
  }
}
