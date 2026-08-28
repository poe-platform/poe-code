import { FsError, resolvePath } from "../../contracts/index.js";
import { compareObservedEntries } from "../copy-identity.js";
import { parse, help } from "./arguments.js";
import { escaped, message, TreeLimitError, UsageError, WalkBudget } from "./io.js";
import { settings } from "./options.js";
import { matches } from "./pattern.js";
function directory(entry) { return (entry.followed ?? entry.stat)?.type === "directory"; }
function serialized(value, budget) {
    let size = 2;
    const add = (count) => { budget.checkOutput(size += count); };
    const string = (text) => {
        budget.outputText(text);
        add(2);
        for (const character of text) {
            const point = character.codePointAt(0);
            if (point === 34 || point === 92 || point === 8 || point === 9 || point === 10 || point === 12 || point === 13)
                add(2);
            else if (point < 32 || (point >= 0xd800 && point <= 0xdfff) || /[\u007f-\u009f\u2028\u2029\p{Cf}]/u.test(character))
                add(6 * character.length);
            else
                add(point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4);
        }
    };
    let first = true;
    for (const [key, field] of Object.entries(value)) {
        if (!first)
            add(1);
        first = false;
        string(key);
        add(1);
        if (typeof field === "string")
            string(field);
        else if (typeof field === "number")
            add(String(field).length);
        else
            throw new TypeError("tree JSON fields must be strings or numbers");
    }
    return JSON.stringify(value).replace(/[\u007f-\u009f\u2028\u2029\p{Cf}]/gu, character => character.split("").map(unit => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`).join(""));
}
class Walker {
    budget;
    args;
    directories = 0;
    files = 0;
    failed = false;
    constructor(budget, args) {
        this.budget = budget;
        this.args = args;
    }
    async inspect(path, display, name) {
        const { context } = this.budget;
        const options = { signal: context.signal };
        const entry = { path, display, name };
        this.budget.text(path);
        this.budget.text(display);
        try {
            entry.stat = await this.budget.fs(() => context.fs.lstat(path, options));
            if (entry.stat.type === "symlink") {
                if (!context.fs.readlink)
                    throw new FsError("ENOTSUP", { path, syscall: "readlink" });
                entry.target = await this.budget.fs(() => context.fs.readlink(path, options));
                try {
                    entry.followed = await this.budget.fs(() => context.fs.stat(path, options));
                }
                catch (error) {
                    context.signal.throwIfAborted();
                    if (!(error instanceof FsError) || (error.code !== "ENOENT" && error.code !== "ENOTDIR"))
                        throw error;
                }
            }
        }
        catch (error) {
            context.signal.throwIfAborted();
            if (error instanceof TreeLimitError)
                throw error;
            entry.error = message(error, this.budget);
        }
        if (entry.target !== undefined)
            this.budget.text(entry.target);
        return entry;
    }
    async children(entry, ancestors, depth) {
        const { context, limits } = this.budget;
        if (entry.error || !directory(entry) || (entry.stat?.type === "symlink" && !this.args.follow))
            return [];
        if (depth === this.args.level)
            return [];
        this.budget.check(depth + 1, limits.maxDepth, "depth");
        let listing;
        try {
            for (const ancestor of ancestors) {
                const same = await this.budget.fs(() => compareObservedEntries(context.fs, entry.path, (entry.followed ?? entry.stat), context.fs, ancestor.path, (ancestor.followed ?? ancestor.stat), { signal: context.signal }));
                if (same === "same") {
                    entry.cycle = true;
                    return [];
                }
            }
            listing = await this.budget.fs(() => context.fs.readdir(entry.path, { signal: context.signal }));
        }
        catch (error) {
            context.signal.throwIfAborted();
            if (error instanceof TreeLimitError)
                throw error;
            entry.error = message(error, this.budget);
            return [];
        }
        this.budget.check(listing.length, limits.maxDirectoryEntries, "directory entry");
        this.budget.entry(listing.length);
        const names = new Set();
        const candidates = [];
        for (const item of listing) {
            this.budget.step();
            this.budget.text(item.name);
            if (item.name === "." || item.name === "..")
                continue;
            if (!item.name || item.name.includes("/") || item.name.includes("\0") || /[\ud800-\udfff]/u.test(item.name) || names.has(item.name)) {
                entry.error = "invalid or duplicate directory entry";
                return [];
            }
            names.add(item.name);
            if (!this.args.all && item.name.startsWith("."))
                continue;
            const bytes = new TextEncoder().encode(item.name);
            if (this.args.exclude.some(pattern => matches(pattern, bytes, this.budget)))
                continue;
            candidates.push({ name: item.name, bytes });
        }
        candidates.sort((left, right) => {
            this.budget.step(1 + left.bytes.length + right.bytes.length);
            return Buffer.compare(left.bytes, right.bytes) * (this.args.reverse ? -1 : 1);
        });
        const children = [];
        for (const item of candidates) {
            const child = await this.inspect(resolvePath(entry.path, item.name), `${entry.display.replace(/\/$/u, "")}/${item.name}`, item.name);
            if (!child.error) {
                if (this.args.directories && !directory(child))
                    continue;
                const includeDirectory = child.stat?.type === "directory" || (this.args.follow && directory(child));
                if (!includeDirectory && this.args.include.length && !this.args.include.some(pattern => matches(pattern, item.bytes, this.budget)))
                    continue;
            }
            children.push(child);
        }
        if (this.args.dirsFirst)
            children.sort((left, right) => {
                this.budget.step();
                return Number(directory(right)) - Number(directory(left));
            });
        return children;
    }
    async visit(entry, ancestors, prefix, last, depth) {
        const children = await this.children(entry, ancestors, depth);
        if (directory(entry)) {
            if (depth > 0 || children.length)
                this.directories++;
        }
        else if (entry.stat)
            this.files++;
        if (entry.error) {
            this.budget.text(entry.error);
            this.failed = true;
            await this.budget.emit(this.budget.context.stderr, `tree: ${escaped(entry.display, this.budget)}: ${escaped(entry.error, this.budget)}\n`);
        }
        const name = depth === 0 || this.args.full ? entry.display : entry.name;
        const annotation = entry.error ?? (entry.cycle ? "recursive, not followed" : undefined);
        if (this.args.json) {
            const fields = { type: entry.stat?.type === "symlink" ? "link" : entry.stat?.type ?? "unknown", name,
                ...(entry.target === undefined ? {} : { target: entry.target }), ...(annotation === undefined ? {} : { error: annotation }) };
            await this.write(`${this.padding(depth + 1)}${serialized(fields, this.budget).slice(0, -1)}`);
            if (children.length) {
                await this.write(`,"contents":[${this.newline()}`);
                for (let index = 0; index < children.length; index++) {
                    if (index)
                        await this.write(`,${this.newline()}`);
                    await this.visit(children[index], [...ancestors, entry], "", index === children.length - 1, depth + 1);
                }
                await this.write(`${this.newline()}${this.padding(depth + 1)}]`);
            }
            await this.write("}");
        }
        else {
            const utf8 = this.args.charset === "UTF-8";
            const branch = this.args.indent && depth > 0 ? prefix + (last ? (utf8 ? "└── " : "`-- ") : (utf8 ? "├── " : "|-- ")) : "";
            await this.write(`${branch}${escaped(name, this.budget)}${entry.target === undefined ? "" : ` -> ${escaped(entry.target, this.budget)}`}${annotation === undefined ? "" : `  [${escaped(annotation, this.budget)}]`}\n`);
            const childPrefix = depth === 0 ? "" : prefix + (last ? "    " : utf8 ? "│   " : "|   ");
            for (let index = 0; index < children.length; index++) {
                await this.visit(children[index], [...ancestors, entry], childPrefix, index === children.length - 1, depth + 1);
            }
        }
    }
    newline() { return this.args.indent ? "\n" : ""; }
    padding(depth) { return this.args.indent ? "  ".repeat(depth) : ""; }
    write(value) { return this.budget.emit(this.budget.context.stdout, value); }
    async run() {
        this.budget.text(this.budget.context.cwd);
        if (this.args.json)
            await this.write(`[${this.newline()}`);
        for (let index = 0; index < this.args.operands.length; index++) {
            const operand = this.args.operands[index];
            this.budget.text(operand);
            this.budget.entry();
            if (this.args.json && index)
                await this.write(`,${this.newline()}`);
            const entry = await this.inspect(resolvePath(this.budget.context.cwd, operand), operand, operand);
            await this.visit(entry, [], "", true, 0);
        }
        if (this.args.report) {
            if (this.args.json) {
                await this.write(`,${this.newline()}${this.padding(1)}${serialized({ type: "report", directories: this.directories,
                    ...(this.args.directories ? {} : { files: this.files }) }, this.budget)}`);
            }
            else
                await this.write(`\n${this.directories} ${this.directories === 1 ? "directory" : "directories"}${this.args.directories ? "" : `, ${this.files} ${this.files === 1 ? "file" : "files"}`}\n`);
        }
        if (this.args.json)
            await this.write(`${this.newline()}]\n`);
        return this.failed ? 1 : 0;
    }
}
export function createTreeCommand(options = {}) {
    const limits = settings(options);
    return { name: "tree", description: "List a bounded virtual directory tree", async execute(context) {
            const budget = new WalkBudget(context, limits);
            let args;
            try {
                args = parse(context.args, budget);
            }
            catch (error) {
                context.signal.throwIfAborted();
                if (!(error instanceof UsageError))
                    throw error;
                await budget.emit(context.stderr, `tree: ${escaped(error.message, budget)}\n`);
                return { exitCode: 2 };
            }
            if (args.help || args.version) {
                await budget.emit(context.stdout, args.help ? help : "tree (virtual-bash bounded profile) 1\n");
                return { exitCode: 0 };
            }
            return { exitCode: await new Walker(budget, args).run() };
        } };
}
//# sourceMappingURL=tree.js.map