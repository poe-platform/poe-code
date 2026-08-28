import { setImmediate as pause } from "node:timers/promises";
import { FsError, writeBytes } from "../../contracts/index.js";
export class Budget {
    context;
    limits;
    input = 0;
    output = 0;
    tokens = 0;
    nodes = 0;
    cells = 0;
    workUsed = 0;
    sinceYield = 0;
    constructor(context, limits) {
        this.context = context;
        this.limits = limits;
    }
    check(amount, remaining, name) {
        this.context.signal.throwIfAborted();
        if (!Number.isSafeInteger(amount) || amount < 0 || amount > remaining) {
            throw new FsError("EFBIG", { message: `html-to-markdown ${name} limit exceeded` });
        }
    }
    work(amount) {
        this.check(amount, this.limits.maxWorkUnits - this.workUsed, "work");
        this.workUsed += amount;
        this.sinceYield += amount;
    }
    async checkpoint() {
        this.context.signal.throwIfAborted();
        if (this.sinceYield >= 4096) {
            this.sinceYield = 0;
            try {
                await pause(undefined, { signal: this.context.signal });
            }
            catch (error) {
                this.context.signal.throwIfAborted();
                throw error;
            }
        }
        this.context.signal.throwIfAborted();
    }
    add(kind, amount = 1) {
        const maximum = kind === "input" ? this.limits.maxInputBytes : kind === "tokens" ? this.limits.maxTokens
            : kind === "nodes" ? this.limits.maxNodes : this.limits.maxTableCells;
        this.check(amount, maximum - this[kind], kind);
        this[kind] += amount;
    }
    async emit(text) {
        this.check(text.length, this.limits.maxOutputBytes - this.output, "output");
        const bytes = Buffer.byteLength(text);
        this.check(bytes, this.limits.maxOutputBytes - this.output, "output");
        this.output += bytes;
        for (let offset = 0; offset < text.length;) {
            let end = Math.min(text.length, offset + 4096);
            if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]))
                end--;
            this.work(end - offset);
            await writeBytes(this.context.stdout, Buffer.from(text.slice(offset, end)), this.context.signal);
            offset = end;
            await this.checkpoint();
        }
    }
}
export class Builder {
    budget;
    maximum;
    pieces = [];
    bytes = 0;
    tail = "";
    constructor(budget, maximum = budget.limits.maxOutputBytes - budget.output) {
        this.budget = budget;
        this.maximum = maximum;
    }
    append(text) {
        if (!text)
            return;
        this.budget.check(text.length, this.maximum - this.bytes, "rendered bytes");
        const size = Buffer.byteLength(text);
        this.budget.check(size, this.maximum - this.bytes, "rendered bytes");
        this.budget.work(text.length);
        this.bytes += size;
        this.pieces.push(text);
        this.tail = (this.tail + text.slice(-2)).slice(-2);
    }
    get empty() { return this.bytes === 0; }
    get trailingSpace() { return this.tail.endsWith(" "); }
    get blockBoundary() { return this.empty || this.tail.endsWith("\n"); }
    separate() {
        if (!this.empty)
            this.append(this.tail.endsWith("\n\n") ? "" : this.tail.endsWith("\n") ? "\n" : "\n\n");
    }
    finish() { this.budget.work(this.bytes); return this.pieces.join(""); }
}
//# sourceMappingURL=budget.js.map