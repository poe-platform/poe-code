import { FsError, writeBytes } from "../../contracts/index.js";
import { Budget, Inputs } from "../table-text/internal.js";
import { readerSettings } from "./options.js";
export function diagnostics(context, maximum) {
    let remaining = maximum;
    return async (error) => {
        context.signal.throwIfAborted();
        if (!remaining)
            return;
        const message = error instanceof Error ? error.message : String(error);
        const prefix = "column: ", marker = "...[diagnostic truncated]\n";
        const candidate = prefix + message.slice(0, remaining) + "\n";
        let bytes = Buffer.from(candidate);
        if (message.length > remaining || bytes.length > remaining) {
            const suffix = Buffer.from(marker.slice(0, remaining));
            let end = Math.min(bytes.length, remaining - suffix.length);
            while (end > 0 && (bytes[end] & 0xc0) === 0x80)
                end--;
            bytes = Buffer.concat([bytes.subarray(0, end), suffix]);
        }
        remaining -= bytes.length;
        await writeBytes(context.stderr, bytes, context.signal);
    };
}
export class ColumnBudget extends Budget {
    columnLimits;
    static outputChunkBytes = 8192;
    workUsed = 0;
    untilYield = 128;
    emittedBytes = 0;
    constructor(context, columnLimits) {
        super(context, readerSettings(columnLimits));
        this.columnLimits = columnLimits;
    }
    check(value, maximum, label) {
        if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
            throw new FsError("EFBIG", { message: `column ${label} limit exceeded` });
        }
    }
    async step() { await this.work(1); }
    async work(amount) {
        this.context.signal.throwIfAborted();
        this.check(amount, this.columnLimits.maxSteps - this.workUsed, "work");
        this.workUsed += amount;
        this.untilYield -= amount;
        if (this.untilYield <= 0) {
            this.untilYield = 128;
            await new Promise(resolve => setImmediate(resolve));
        }
        this.context.signal.throwIfAborted();
    }
    async text(value) {
        this.check(value.length, this.columnLimits.maxOutputBytes - this.emittedBytes, "output");
        const size = Buffer.byteLength(value);
        this.check(size, this.columnLimits.maxOutputBytes - this.emittedBytes, "output");
        const bytes = Buffer.from(value);
        if (!size)
            await this.output([]);
        for (let offset = 0; offset < size; offset += ColumnBudget.outputChunkBytes) {
            await this.chunk(bytes.subarray(offset, offset + ColumnBudget.outputChunkBytes));
        }
    }
    checkOutput(size, label = "output padding") {
        this.check(size, this.columnLimits.maxOutputBytes - this.emittedBytes, label);
    }
    async chunk(bytes) {
        this.checkOutput(bytes.length, "output");
        this.emittedBytes += bytes.length;
        await this.output([bytes]);
    }
    async padding(size, character = " ") {
        this.checkOutput(size);
        await this.work(size);
        for (let remaining = size; remaining > 0; remaining -= ColumnBudget.outputChunkBytes) {
            await this.text(character.repeat(Math.min(remaining, ColumnBudget.outputChunkBytes)));
        }
    }
}
function cancellable(operation, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const onAbort = () => { signal.removeEventListener("abort", onAbort); reject(signal.reason); };
        signal.addEventListener("abort", onAbort, { once: true });
        try {
            Promise.resolve(operation()).then(value => {
                signal.removeEventListener("abort", onAbort);
                if (signal.aborted)
                    reject(signal.reason);
                else
                    resolve(value);
            }, error => { signal.removeEventListener("abort", onAbort); reject(error); });
        }
        catch (error) {
            signal.removeEventListener("abort", onAbort);
            reject(error);
        }
    });
}
export class ColumnInputs {
    controller = new AbortController();
    inputs;
    acquired = [];
    opening = new Set();
    closed = false;
    completion;
    signal;
    budget;
    constructor(context, limits) {
        this.signal = AbortSignal.any([context.signal, this.controller.signal]);
        const fs = new Proxy(context.fs, { get: (target, key) => {
                if (key === "stat")
                    return (path) => cancellable(() => target.stat(path, { signal: this.signal }), this.signal);
                if (key === "readStream")
                    return target.readStream ? (path, options) => {
                        this.admit();
                        return this.manage(target.readStream(path, { ...options, signal: this.signal }));
                    } : undefined;
                const value = Reflect.get(target, key, target);
                return typeof value === "function" ? value.bind(target) : value;
            } });
        const stdin = { [Symbol.asyncIterator]: () => this.manage(context.stdin)[Symbol.asyncIterator]() };
        const scoped = new Proxy({ fs, stdin, signal: this.signal }, {
            get(target, key) {
                if (Object.hasOwn(target, key))
                    return Reflect.get(target, key, target);
                const value = Reflect.get(context, key, context);
                return typeof value === "function" ? value.bind(context) : value;
            },
        });
        this.budget = new ColumnBudget(scoped, limits);
        this.inputs = new Inputs(scoped, this.budget, 10);
        context.registerCleanup?.(this.close);
    }
    admit() {
        this.signal.throwIfAborted();
        if (this.closed)
            throw new FsError("EPIPE", { message: "column input admission closed" });
    }
    manage(source) {
        this.admit();
        const iterator = source[Symbol.asyncIterator]();
        let done = false, completion;
        const close = () => {
            completion ??= Promise.resolve().then(async () => {
                if (!done) {
                    done = true;
                    await iterator.return?.();
                }
            });
            return completion;
        };
        this.acquired.push(close);
        return { [Symbol.asyncIterator]() {
                return {
                    async next() {
                        if (done)
                            return { done: true, value: undefined };
                        const result = await iterator.next();
                        if (result.done)
                            done = true;
                        return result;
                    },
                    async return() { await close(); return { done: true, value: undefined }; },
                };
            } };
    }
    async open(name) {
        this.admit();
        const pending = this.inputs.open(name);
        this.opening.add(pending);
        try {
            return await pending;
        }
        finally {
            this.opening.delete(pending);
        }
    }
    close = () => {
        if (this.completion)
            return this.completion;
        this.closed = true;
        this.completion = Promise.resolve().then(async () => {
            this.controller.abort(new FsError("EPIPE", { message: "column input transfer ended" }));
            await Promise.allSettled(this.opening);
            const results = await Promise.allSettled([this.inputs.close(), ...this.acquired.map(close => close())]);
            const failure = results.find(result => result.status === "rejected");
            if (failure?.status === "rejected")
                throw failure.reason;
        });
        return this.completion;
    };
}
//# sourceMappingURL=internal.js.map