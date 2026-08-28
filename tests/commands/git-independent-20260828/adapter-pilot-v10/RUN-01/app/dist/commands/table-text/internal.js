import { FsError, readBytes, resolvePath, writeBytes } from "../../contracts/index.js";
import { diagnostic } from "../internal.js";
export const empty = new Uint8Array();
export const encode = (value) => new TextEncoder().encode(value);
export function settings(options) {
    const limits = {
        maxInputBytes: 256 * 1024 * 1024, maxOutputBytes: 256 * 1024 * 1024,
        maxRecordBytes: 1024 * 1024, maxChunkBytes: 1024 * 1024,
        maxGroupBytes: 8 * 1024 * 1024, maxGroupRecords: 100_000,
        maxFields: 65_536, maxFiles: 64, maxSteps: 2_000_000, maxArgumentBytes: 65_536,
        ...options.limits,
    };
    for (const [name, value] of Object.entries(limits)) {
        if (!Number.isSafeInteger(value) || value < 1)
            throw new RangeError(`Invalid table-text limit: ${name}`);
    }
    return limits;
}
export function fail(message) { throw new FsError("EINVAL", { message }); }
export function command(name, handler) {
    return { name, async execute(context) {
            context.signal.throwIfAborted();
            try {
                return await handler(context);
            }
            catch (error) {
                context.signal.throwIfAborted();
                await diagnostic(context, error);
                return { exitCode: 1 };
            }
        } };
}
export function requireCLocale(context) {
    const locale = context.env.LC_ALL || context.env.LC_COLLATE || context.env.LANG || "C";
    const ctype = context.env.LC_ALL || context.env.LC_CTYPE || context.env.LANG || "C";
    if (![locale, ctype].every(value => value === "C" || value === "POSIX")) {
        throw new FsError("ENOTSUP", { message: "table ordering supports only the C/POSIX byte locale; set LC_ALL=C" });
    }
}
export function compare(left, right, fold = false) {
    for (let offset = 0; offset < Math.min(left.length, right.length); offset++) {
        let first = left[offset], second = right[offset];
        if (fold && first >= 65 && first <= 90)
            first += 32;
        if (fold && second >= 65 && second <= 90)
            second += 32;
        if (first !== second)
            return first - second;
    }
    return left.length - right.length;
}
export class Budget {
    context;
    limits;
    inputBytes = 0;
    outputBytes = 0;
    steps = 0;
    constructor(context, limits) {
        this.context = context;
        this.limits = limits;
        this.check(context.args.reduce((size, value) => size + Buffer.byteLength(value), 0), limits.maxArgumentBytes, "argument");
    }
    check(value, maximum, label) {
        if (value > maximum)
            throw new FsError("EFBIG", { message: `table-text ${label} limit exceeded` });
    }
    async step() {
        this.context.signal.throwIfAborted();
        this.check(++this.steps, this.limits.maxSteps, "step");
        if (this.steps % 128 === 0)
            await new Promise(resolve => setImmediate(resolve));
        this.context.signal.throwIfAborted();
    }
    input(size) {
        this.check(size, this.limits.maxChunkBytes, "chunk");
        this.inputBytes += size;
        this.check(this.inputBytes, this.limits.maxInputBytes, "input");
    }
    async output(parts) {
        await this.step();
        this.outputBytes += parts.reduce((size, part) => size + part.length, 0);
        this.check(this.outputBytes, this.limits.maxOutputBytes, "output");
        for (const part of parts)
            if (part.length)
                await writeBytes(this.context.stdout, part, this.context.signal);
    }
}
export class RecordReader {
    separator;
    budget;
    chunk = empty;
    offset = 0;
    done = false;
    closed = false;
    iterator;
    constructor(source, separator, budget, signal) {
        this.separator = separator;
        this.budget = budget;
        this.iterator = readBytes(source, signal);
    }
    async next() {
        const parts = [];
        let size = 0;
        while (!this.done) {
            await this.budget.step();
            if (this.offset === this.chunk.length) {
                const result = await this.iterator.next();
                if (result.done) {
                    this.done = true;
                    this.chunk = empty;
                    break;
                }
                this.budget.input(result.value.length);
                this.chunk = Uint8Array.from(result.value);
                this.offset = 0;
                if (!this.chunk.length)
                    continue;
            }
            const end = this.chunk.indexOf(this.separator, this.offset);
            const stop = end < 0 ? this.chunk.length : end;
            const fragment = this.chunk.subarray(this.offset, stop);
            size += fragment.length;
            this.budget.check(size, this.budget.limits.maxRecordBytes, "record");
            if (fragment.length)
                parts.push(fragment);
            this.offset = stop + (end < 0 ? 0 : 1);
            if (end >= 0)
                return Buffer.concat(parts, size);
        }
        return size ? Buffer.concat(parts, size) : undefined;
    }
    async closeOperand(name) {
        this.budget.context.signal.throwIfAborted();
        if (this.closed)
            throw new Error(`${name}: Bad file descriptor`);
        await this.close();
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        await this.iterator.return(undefined);
    }
}
export class Inputs {
    context;
    budget;
    separator;
    controller = new AbortController();
    readers = [];
    stdin;
    signal;
    constructor(context, budget, separator) {
        this.context = context;
        this.budget = budget;
        this.separator = separator;
        this.signal = AbortSignal.any([context.signal, this.controller.signal]);
    }
    async open(name) {
        this.signal.throwIfAborted();
        if (name === "-" && this.stdin)
            return this.stdin;
        this.budget.check(this.readers.length + 1, this.budget.limits.maxFiles, "file");
        let source;
        if (name === "-")
            source = this.context.stdin;
        else {
            const path = resolvePath(this.context.cwd, name);
            const stat = await this.context.fs.stat(path, { signal: this.signal });
            if (stat.type === "directory")
                throw new FsError("EISDIR", { path });
            if (this.context.fs.readStream)
                source = this.context.fs.readStream(path, { signal: this.signal });
            else {
                const { context, signal, budget } = this;
                source = (async function* () {
                    yield await context.fs.readFile(path, { signal, maxBytes: budget.limits.maxChunkBytes });
                })();
            }
        }
        const reader = new RecordReader(source, this.separator, this.budget, this.signal);
        this.readers.push(reader);
        if (name === "-")
            this.stdin = reader;
        return reader;
    }
    async close() {
        this.controller.abort(new FsError("EPIPE", { message: "table-text input transfer ended" }));
        await Promise.all(this.readers.map(reader => reader.close()));
    }
}
export function argument(args, index, attached, option) {
    if (attached !== undefined)
        return [attached, index];
    const value = args[index + 1];
    if (value === undefined)
        fail(`option ${option} requires an argument`);
    return [value, index + 1];
}
export class OrderCheck {
    mode;
    context;
    unpaired = false;
    failed = false;
    warned = new Set();
    constructor(mode, context) {
        this.mode = mode;
        this.context = context;
    }
    async check(previous, next, file, fold = false) {
        if (this.mode === "none" || (this.mode === "default" && !this.unpaired) || this.warned.has(file))
            return;
        if (previous && next && compare(previous, next, fold) > 0) {
            const message = `file ${file} is not in sorted order`;
            if (this.mode === "check")
                fail(message);
            this.warned.add(file);
            this.failed = true;
            await diagnostic(this.context, new Error(message));
        }
    }
}
//# sourceMappingURL=internal.js.map