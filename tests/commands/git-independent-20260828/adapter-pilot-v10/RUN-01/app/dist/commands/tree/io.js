import { setImmediate as yieldTurn } from "node:timers/promises";
import { FsError, writeBytes } from "../../contracts/index.js";
export class UsageError extends Error {
}
export class TreeLimitError extends FsError {
    constructor(label, maximum) {
        super("EFBIG", { message: `tree ${label} limit exceeded (${maximum})` });
    }
}
export function message(error, budget) {
    const value = error instanceof Error ? error.message : error;
    const text = typeof value === "string" ? value
        : value === null || value === undefined || typeof value === "number" || typeof value === "boolean" ? String(value)
            : "non-string filesystem error";
    budget.text(text);
    return error instanceof Error ? text.replace(/^[A-Z][A-Z0-9]+: /u, "") : text;
}
export function escaped(value, budget) {
    budget.outputText(value);
    const controls = { 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r", 92: "\\\\" };
    let result = "";
    for (const byte of new TextEncoder().encode(value)) {
        const part = controls[byte] ?? (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : `\\${byte.toString(8).padStart(3, "0")}`);
        budget.checkOutput(result.length + part.length);
        result += part;
    }
    return result;
}
export class WalkBudget {
    context;
    limits;
    entries = 0;
    metadata = 0;
    output = 0;
    steps = 0;
    operations = 0;
    constructor(context, limits) {
        this.context = context;
        this.limits = limits;
    }
    check(value, maximum, label) {
        this.context.signal.throwIfAborted();
        if (value > maximum)
            throw new TreeLimitError(label, maximum);
    }
    step(count = 1) { this.check(this.steps += count, this.limits.maxSteps, "work"); }
    entry(count = 1) { this.check(this.entries += count, this.limits.maxEntries, "entry"); }
    text(value) {
        this.check(value.length, this.limits.maxPathBytes, "path/name");
        this.check(this.metadata + value.length, this.limits.maxMetadataBytes, "metadata");
        const size = Buffer.byteLength(value);
        this.check(size, this.limits.maxPathBytes, "path/name");
        this.check(this.metadata += size, this.limits.maxMetadataBytes, "metadata");
    }
    checkOutput(size) { this.check(this.output + size, this.limits.maxOutputBytes, "output"); }
    outputText(value) {
        this.checkOutput(value.length);
        const size = Buffer.byteLength(value);
        this.checkOutput(size);
        return size;
    }
    async fs(operation) {
        this.step();
        const { signal } = this.context;
        if (++this.operations % 64 === 0)
            await yieldTurn(undefined, { signal });
        signal.throwIfAborted();
        let abort;
        const aborted = new Promise((_resolve, reject) => {
            abort = () => reject(signal.reason);
            signal.addEventListener("abort", abort, { once: true });
        });
        try {
            const result = await Promise.race([Promise.resolve().then(() => {
                    signal.throwIfAborted();
                    return operation();
                }), aborted]);
            signal.throwIfAborted();
            return result;
        }
        finally {
            signal.removeEventListener("abort", abort);
        }
    }
    async emit(sink, value) {
        const size = this.outputText(value);
        this.output += size;
        const bytes = new TextEncoder().encode(value);
        for (let offset = 0; offset < bytes.length; offset += 16384) {
            await writeBytes(sink, bytes.slice(offset, offset + 16384), this.context.signal);
            this.context.signal.throwIfAborted();
        }
    }
}
//# sourceMappingURL=io.js.map