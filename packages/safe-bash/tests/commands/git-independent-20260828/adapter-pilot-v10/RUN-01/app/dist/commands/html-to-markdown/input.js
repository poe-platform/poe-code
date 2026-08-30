import { readBytes } from "../../contracts/index.js";
import { pathOf } from "../internal.js";
import { Parser } from "./parser.js";
class Cursor {
    source;
    signal;
    iterator;
    done = false;
    closing;
    constructor(source, signal) {
        this.source = source;
        this.signal = signal;
    }
    [Symbol.asyncIterator]() {
        return {
            next: async () => {
                if (this.done)
                    return { done: true, value: undefined };
                this.signal.throwIfAborted();
                this.iterator ??= this.source[Symbol.asyncIterator]();
                const next = await this.iterator.next();
                this.signal.throwIfAborted();
                if (this.done || next.done) {
                    this.done = true;
                    return { done: true, value: undefined };
                }
                return next;
            },
            return: async () => { await this.close(); return { done: true, value: undefined }; },
        };
    }
    close() {
        if (!this.closing) {
            const iterator = this.done ? undefined : this.iterator;
            this.done = true;
            this.closing = Promise.resolve().then(async () => { await iterator?.return?.(); });
        }
        return this.closing;
    }
}
export class Inputs {
    context;
    budget;
    cursors = [];
    stdin;
    closed = false;
    primaryFailure = false;
    completion;
    constructor(context, budget) {
        this.context = context;
        this.budget = budget;
        context.registerCleanup?.(this.close);
    }
    preservePrimaryFailure() { this.primaryFailure = true; }
    open(name) {
        this.context.signal.throwIfAborted();
        if (this.closed)
            throw new Error("html-to-markdown input is closed");
        if (name === "-" && this.stdin)
            return this.stdin;
        let source;
        if (name === "-")
            source = this.context.stdin;
        else {
            const context = this.context, budget = this.budget, path = pathOf(context, name);
            if (context.fs.readStream)
                source = context.fs.readStream(path, { signal: context.signal, chunkSize: 16_384 });
            else {
                let consumed = false;
                source = { [Symbol.asyncIterator]() {
                        return {
                            async next() {
                                if (consumed)
                                    return { done: true, value: undefined };
                                consumed = true;
                                const value = await context.fs.readFile(path, { signal: context.signal, maxBytes: budget.limits.maxInputBytes - budget.input });
                                context.signal.throwIfAborted();
                                return { done: false, value };
                            },
                            async return() { consumed = true; return { done: true, value: undefined }; },
                        };
                    } };
            }
        }
        const cursor = new Cursor(source, this.context.signal);
        this.cursors.push(cursor);
        if (name === "-")
            this.stdin = cursor;
        return cursor;
    }
    async document(name) {
        const cursor = this.open(name), decoder = new TextDecoder("utf-8", { fatal: true });
        const parser = new Parser(this.budget);
        for await (const chunk of readBytes(cursor, this.context.signal)) {
            this.budget.add("input", chunk.byteLength);
            this.budget.work(Math.max(1, chunk.byteLength));
            const owned = new Uint8Array(chunk);
            for (let offset = 0; offset < owned.length; offset += 4096) {
                await parser.feed(decoder.decode(owned.subarray(offset, offset + 4096), { stream: true }));
                await this.budget.checkpoint();
            }
            await this.budget.checkpoint();
        }
        await parser.feed(decoder.decode());
        this.context.signal.throwIfAborted();
        return parser.finish();
    }
    close = () => {
        this.closed = true;
        this.completion ??= Promise.allSettled(this.cursors.map(cursor => cursor.close())).then(results => {
            const failure = results.find(result => result.status === "rejected");
            if (failure?.status === "rejected" && !this.primaryFailure)
                throw failure.reason;
        });
        return this.completion;
    };
}
//# sourceMappingURL=input.js.map