import { createOutputOperation, resolvePath } from "../../contracts/index.js";
import { parse, helpText } from "./arguments.js";
import { Budget, DuLimitError } from "./budget.js";
import { formatSize } from "./format.js";
import { settings } from "./options.js";
class Walker {
    budget;
    args;
    seen = new Map();
    failed = false;
    constructor(budget, args) {
        this.budget = budget;
        this.args = args;
    }
    duplicate(stat) {
        if (this.args.countLinks || stat.type === "directory")
            return false;
        const { identityScope: scope, dev, ino } = stat;
        if ((typeof scope !== "object" || scope === null) && typeof scope !== "symbol")
            return false;
        if (dev === undefined || ino === undefined || !Number.isSafeInteger(dev) || dev < 0 || !Number.isSafeInteger(ino) || ino < 0)
            return false;
        let devices = this.seen.get(scope);
        if (!devices) {
            devices = new Map();
            this.seen.set(scope, devices);
        }
        let inodes = devices.get(dev);
        if (!inodes) {
            inodes = new Set();
            devices.set(dev, inodes);
        }
        if (inodes.has(ino))
            return true;
        inodes.add(ino);
        return false;
    }
    async failure(error, display) {
        this.budget.active(this.budget.caller.signal);
        if (this.budget.context.signal.aborted || error instanceof DuLimitError)
            throw error;
        this.failed = true;
        await this.budget.diagnostic(error, display);
    }
    async add(left, right, display) {
        this.budget.step();
        if (right.bytes > Number.MAX_SAFE_INTEGER - left.bytes) {
            await this.failure(new Error("aggregate exceeds safe integer range; total suppressed"), display);
            return { bytes: left.bytes, complete: false };
        }
        return { bytes: left.bytes + right.bytes, complete: left.complete && right.complete };
    }
    async report(amount, display) {
        if (!amount.complete)
            return;
        this.budget.step(display.length + 1);
        await this.budget.emit(this.budget.context.stdout, `${formatSize(amount.bytes, this.args.format)}\t${display}${this.args.nullOutput ? "\0" : "\n"}`);
    }
    async children(path, display) {
        const { context, limits } = this.budget;
        let entries;
        try {
            entries = await this.budget.fs(() => context.fs.readdir(path, { signal: context.signal }));
        }
        catch (error) {
            await this.failure(error, display);
            return undefined;
        }
        if (!Array.isArray(entries)) {
            await this.failure(new Error("invalid directory listing"), display);
            return undefined;
        }
        this.budget.check(entries.length, limits.maxDirectoryEntries, "directory entry");
        const names = new Set();
        for (const entry of entries) {
            this.budget.step();
            if (!entry || typeof entry.name !== "string") {
                await this.failure(new Error("invalid directory entry"), display);
                return undefined;
            }
            this.budget.text(entry.name);
            if (!entry.name || entry.name === "." || entry.name === ".." || /[\/\0]/u.test(entry.name) || names.has(entry.name)) {
                await this.failure(new Error("invalid or duplicate directory entry name"), display);
                return undefined;
            }
            names.add(entry.name);
        }
        return entries.slice().sort((left, right) => {
            this.budget.step(1 + Math.min(left.name.length, right.name.length));
            return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
        });
    }
    async walk(path, display, depth) {
        const { context, limits } = this.budget;
        this.budget.check(depth, limits.maxDepth, "depth");
        this.budget.entry();
        this.budget.text(path);
        this.budget.text(display);
        if (display === "") {
            await this.failure(new Error("invalid zero-length file name"));
            return { bytes: 0, complete: false };
        }
        let stat;
        try {
            stat = await this.budget.fs(() => context.fs.lstat(path, { signal: context.signal }));
            if (!stat || !["file", "directory", "symlink"].includes(stat.type))
                throw new Error("invalid entry type");
        }
        catch (error) {
            await this.failure(error, display);
            return { bytes: 0, complete: false };
        }
        const bytes = this.args.apparent ? stat.type === "directory" ? 0 : stat.size : stat.allocatedBytes;
        let amount;
        if (bytes === undefined || !Number.isSafeInteger(bytes) || bytes < 0) {
            await this.failure(new Error(`${this.args.apparent ? "apparent size" : "allocated bytes"} ${bytes === undefined ? "unknown" : "invalid"}; total suppressed`), display);
            amount = { bytes: 0, complete: false };
        }
        else
            amount = { bytes, complete: true };
        if (this.duplicate(stat))
            return { bytes: 0, complete: amount.complete };
        if (stat.type === "directory") {
            const entries = await this.children(path, display);
            if (entries === undefined)
                amount = { ...amount, complete: false };
            else
                for (const entry of entries) {
                    this.budget.step();
                    const suffix = display.endsWith("/") ? "" : "/";
                    this.budget.check(path.length + entry.name.length + 1, limits.maxPathBytes, "path/name");
                    this.budget.check(display.length + suffix.length + entry.name.length, limits.maxPathBytes, "path/name");
                    const childPath = `${path.endsWith("/") ? path : path + "/"}${entry.name}`;
                    amount = await this.add(amount, await this.walk(childPath, display + suffix + entry.name, depth + 1), display);
                }
        }
        if (depth === 0 || (depth <= this.args.depth && (stat.type === "directory" || this.args.all)))
            await this.report(amount, display);
        return amount;
    }
    async run() {
        let total = { bytes: 0, complete: true };
        const { context } = this.budget;
        this.budget.text(context.cwd);
        const paths = this.args.operands.map(operand => {
            const path = resolvePath(context.cwd, operand);
            const resolved = operand.endsWith("/") && path !== "/" ? path + "/" : path;
            this.budget.text(resolved);
            return resolved;
        });
        for (let index = 0; index < paths.length; index++) {
            const amount = await this.walk(paths[index], this.args.operands[index], 0);
            if (this.args.total)
                total = await this.add(total, amount, "total");
        }
        if (this.args.total)
            await this.report(total, "total");
    }
}
export function createDuCommand(options = {}) {
    const limits = settings(options);
    return { name: "du", description: "Bounded provider allocation or explicit apparent-size usage", async execute(context) {
            let operation;
            const work = { ...context, get signal() { return operation?.signal ?? context.signal; }, get stdout() { return operation?.output ?? context.stdout; } };
            const budget = new Budget(work, limits, context);
            context.registerCleanup?.(budget.close);
            try {
                const args = parse(budget);
                if (context.stdout.ownedOutput)
                    operation = createOutputOperation(context, context.stdout);
                if (args.help) {
                    await budget.emit(work.stdout, helpText);
                    return { exitCode: 0 };
                }
                const walker = new Walker(budget, args);
                await walker.run();
                return { exitCode: walker.failed ? 1 : 0 };
            }
            catch (error) {
                context.signal.throwIfAborted();
                if (operation?.signal.aborted && error === operation.signal.reason)
                    throw error;
                budget.active(context.signal);
                try {
                    await budget.diagnostic(error);
                }
                catch (diagnosticError) {
                    budget.active(context.signal);
                    if (!(diagnosticError instanceof DuLimitError))
                        throw diagnosticError;
                }
                return { exitCode: 1 };
            }
            finally {
                try {
                    await budget.close();
                }
                finally {
                    await operation?.close();
                }
                context.signal.throwIfAborted();
            }
        } };
}
//# sourceMappingURL=du.js.map