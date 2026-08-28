import { dirname, isPathWithin, relativePath, resolvePath } from "../../contracts/index.js";
import { RegexExecutionError } from "../regex-execution/client.js";
import { Glob, ignoreRules, matchGlobs } from "./glob.js";
import { SearchError } from "./options.js";
import { Limits, pathFor } from "./shared.js";
export class Walker {
    context;
    args;
    limits;
    report;
    session;
    globs;
    hasPositive;
    cache = new Map();
    constructor(context, args, limits, report, session) {
        this.context = context;
        this.args = args;
        this.limits = limits;
        this.report = report;
        this.session = session;
        if (args.globs.length > 1024)
            throw new SearchError("glob count limit exceeded");
        this.globs = args.globs.map(({ source, insensitive }) => ({ glob: new Glob(source.startsWith("!") ? source.slice(1) : source, insensitive), include: !source.startsWith("!") }));
        this.hasPositive = this.globs.some(rule => rule.include);
    }
    async validate() {
        await matchGlobs(this.globs.map(rule => rule.glob), [], this.session);
    }
    async exists(path) {
        try {
            await this.context.fs.lstat(path, { signal: this.context.signal });
            return true;
        }
        catch (error) {
            this.context.signal.throwIfAborted();
            if (error.code === "ENOENT")
                return false;
            throw error;
        }
    }
    async load(directory, inherited, repository) {
        const base = resolvePath("/", directory);
        const key = `${base}:${repository}`;
        const cached = this.cache.get(key);
        if (cached)
            return { repository: cached.repository, rules: [...(cached.root ? inherited.filter(rule => rule.priority !== 1) : inherited), ...cached.rules] };
        const root = await this.exists(`${directory}/.git`);
        repository ||= root;
        if (root)
            inherited = inherited.filter(rule => rule.priority !== 1);
        const local = [];
        if (this.args.ignore) {
            const names = [];
            if (this.args.ignoreVcs && (repository || !this.args.requireGit))
                names.push([".gitignore", 1]);
            if (this.args.ignoreDot)
                names.push([".ignore", 2], [".rgignore", 3]);
            for (const [name, priority] of names) {
                try {
                    const data = await this.context.fs.readFile(`${directory}/${name}`, { signal: this.context.signal, maxBytes: 1024 * 1024 });
                    local.push(...await ignoreRules(Buffer.from(data).toString("utf8"), base, priority, this.session));
                }
                catch (error) {
                    this.context.signal.throwIfAborted();
                    if (error instanceof RegexExecutionError)
                        throw error;
                    if (error.code !== "ENOENT")
                        await this.report(error);
                }
            }
        }
        this.cache.set(key, { repository, rules: local, root });
        if (inherited.length + local.length > 10000)
            throw new SearchError("ignore rule count limit exceeded");
        return { repository, rules: [...inherited, ...local] };
    }
    async accepted(path, name, directory, rules) {
        let override;
        const relative = relativePath(this.context.cwd, path);
        const overrides = await matchGlobs(this.globs.map(rule => rule.glob), this.globs.map(() => ({ path: relative, directory, ancestors: false })), this.session);
        for (let index = 0; index < overrides.length; index++)
            if (overrides[index])
                override = this.globs[index].include;
        if (override !== undefined)
            return override;
        if (this.hasPositive && !directory)
            return false;
        let include;
        let priority = -1;
        for (let offset = 0; offset < rules.length;) {
            const group = [];
            const groupPriority = rules[offset].priority;
            while (offset < rules.length && rules[offset].priority === groupPriority) {
                const rule = rules[offset++];
                if (rule.priority >= priority && isPathWithin(rule.base, path))
                    group.push(rule);
            }
            const matches = await matchGlobs(group.map(rule => rule.glob), group.map(rule => ({ path: relativePath(rule.base, path), directory, ancestors: false })), this.session);
            for (let index = 0; index < matches.length; index++)
                if (matches[index]) {
                    priority = groupPriority;
                    include = group[index].include;
                }
        }
        if (include !== undefined)
            return include;
        return this.args.hidden || !name.startsWith(".");
    }
    async *directory(path, label, depth, ancestors, rules, repository) {
        if (depth >= this.args.maxDepth)
            return;
        const canonical = await this.context.fs.realpath(path, { signal: this.context.signal });
        if (ancestors.has(canonical)) {
            await this.report(new SearchError(`File system loop found: ${label} points to an ancestor ${ancestors.get(canonical)}`));
            return;
        }
        const parents = new Map(ancestors);
        parents.set(canonical, label || ".");
        const local = await this.load(path, rules, repository);
        const entries = (await this.context.fs.readdir(path, { signal: this.context.signal })).sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
        for (const entry of entries) {
            await this.limits.tick();
            if (++this.limits.files > this.limits.maxFiles)
                throw new SearchError("filesystem entry limit exceeded");
            const child = `${path.replace(/\/$/u, "")}/${entry.name}`;
            const display = label ? `${label.replace(/\/$/u, "")}/${entry.name}` : entry.name;
            try {
                if (entry.type === "symlink" && !this.args.follow)
                    continue;
                const type = entry.type === "symlink" ? (await this.context.fs.stat(child, { signal: this.context.signal })).type : entry.type;
                if (entry.type === "symlink" && type === "directory") {
                    const destination = await this.context.fs.realpath(child, { signal: this.context.signal });
                    if (parents.has(destination)) {
                        await this.report(new SearchError(`File system loop found: ${display} points to an ancestor ${parents.get(destination)}`));
                        continue;
                    }
                }
                if (!await this.accepted(child, entry.name, type === "directory", local.rules))
                    continue;
                if (type === "directory")
                    yield* this.directory(child, display, depth + 1, parents, local.rules, local.repository);
                else if (type === "file")
                    yield { path: child, label: display, explicit: false, recursive: true };
            }
            catch (error) {
                this.context.signal.throwIfAborted();
                if (error instanceof SearchError || error instanceof RegexExecutionError)
                    throw error;
                await this.report(error);
            }
        }
    }
    async *targets(paths, implicit = false) {
        for (const operand of paths) {
            await this.limits.tick();
            if (++this.limits.files > this.limits.maxFiles)
                throw new SearchError("filesystem entry limit exceeded");
            if (operand === "-") {
                yield { path: "-", label: "<stdin>", explicit: true, recursive: false };
                continue;
            }
            const path = pathFor(this.context, operand);
            try {
                const stat = await this.context.fs.stat(path, { signal: this.context.signal });
                if (stat.type !== "directory") {
                    yield { path, label: operand, explicit: true, recursive: false };
                    continue;
                }
                let inherited = { rules: [], repository: false };
                const parents = [];
                let parent = dirname(resolvePath("/", path));
                if (this.args.ignoreParent) {
                    while (true) {
                        parents.unshift(parent);
                        if (parent === "/")
                            break;
                        parent = dirname(parent);
                    }
                    for (const directory of parents)
                        inherited = await this.load(directory, inherited.rules, inherited.repository);
                }
                else {
                    while (true) {
                        inherited.repository ||= await this.exists(`${parent}/.git`);
                        if (parent === "/")
                            break;
                        parent = dirname(parent);
                    }
                }
                yield* this.directory(path, implicit ? "" : operand, 0, new Map(), inherited.rules, inherited.repository);
            }
            catch (error) {
                this.context.signal.throwIfAborted();
                if (error instanceof SearchError || error instanceof RegexExecutionError)
                    throw error;
                await this.report(error);
            }
        }
    }
}
//# sourceMappingURL=walk.js.map