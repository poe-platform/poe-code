import { FsError, writeBytes } from "../../contracts/index.js";
export class DuLimitError extends FsError {
    constructor(label) { super("EFBIG", { message: `du ${label} limit exceeded` }); }
}
export class Budget {
    context;
    limits;
    caller;
    steps = 0;
    entries = 0;
    metadata = 0;
    output = 0;
    operations = 0;
    closed = false;
    completion;
    cancellation = new AbortController();
    ioSignal;
    outputSignal;
    work = new Set();
    pending = new Set();
    timers = new Set();
    constructor(context, limits, caller = context) {
        this.context = context;
        this.limits = limits;
        this.caller = caller;
        this.ioSignal = AbortSignal.any([caller.signal, this.cancellation.signal]);
    }
    close = () => {
        if (this.completion)
            return this.completion;
        this.closed = true;
        this.cancellation.abort(this.context.signal.aborted ? this.context.signal.reason : new Error("du invocation closed"));
        for (const timer of this.timers)
            clearImmediate(timer);
        this.timers.clear();
        for (const cancel of this.pending) {
            this.context.signal.removeEventListener("abort", cancel);
            cancel();
        }
        this.pending.clear();
        this.completion = Promise.allSettled([...this.work]).then(() => { });
        return this.completion;
    };
    track(promise) {
        this.work.add(promise);
        void promise.then(() => this.work.delete(promise), () => this.work.delete(promise));
        return promise;
    }
    active(signal = this.context.signal) {
        signal.throwIfAborted();
        if (this.closed)
            throw new Error("du invocation closed");
    }
    check(value, maximum, label, signal = this.context.signal) {
        this.active(signal);
        if (!Number.isSafeInteger(value) || value > maximum)
            throw new DuLimitError(label);
    }
    step(count = 1) {
        this.check(count, this.limits.maxSteps - this.steps, "work");
        this.steps += count;
    }
    entry() { this.check(++this.entries, this.limits.maxEntries, "entry"); }
    text(value) {
        this.check(value.length, this.limits.maxPathBytes, "path/name");
        this.step(value.length + 1);
        const bytes = Buffer.byteLength(value);
        this.check(bytes, this.limits.maxPathBytes, "path/name");
        this.check(bytes, this.limits.maxMetadataBytes - this.metadata, "metadata");
        this.metadata += bytes;
    }
    wait(operation) {
        this.active();
        return this.track(this.waitTask(operation));
    }
    async waitTask(operation) {
        this.active();
        const { signal } = this.context;
        let cancel;
        const aborted = new Promise((_resolve, reject) => {
            cancel = () => reject(signal.aborted ? signal.reason : new Error("du invocation closed"));
            signal.addEventListener("abort", cancel, { once: true });
            this.pending.add(cancel);
        });
        try {
            const result = await Promise.race([Promise.resolve().then(() => { this.active(); return operation(); }), aborted]);
            this.active();
            return result;
        }
        finally {
            signal.removeEventListener("abort", cancel);
            this.pending.delete(cancel);
        }
    }
    async fs(operation) {
        this.step();
        if (++this.operations % 64 === 0) {
            await this.wait(() => new Promise(resolve => {
                const timer = setImmediate(() => { this.timers.delete(timer); resolve(); });
                this.timers.add(timer);
            }));
        }
        return this.wait(operation);
    }
    async emit(sink, text, signal = this.context.signal) {
        this.check(text.length, this.limits.maxOutputBytes - this.output, "output", signal);
        const size = Buffer.byteLength(text);
        this.check(size, this.limits.maxOutputBytes - this.output, "output", signal);
        this.output += size;
        const bytes = new TextEncoder().encode(text);
        const ioSignal = signal === this.caller.signal ? this.ioSignal : (this.outputSignal ??= AbortSignal.any([signal, this.cancellation.signal]));
        for (let offset = 0; offset < bytes.length; offset += 16384) {
            this.active(signal);
            await this.track(writeBytes(sink, bytes.slice(offset, offset + 16384), ioSignal));
        }
    }
    async diagnostic(error, path) {
        this.active(this.caller.signal);
        const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "filesystem operation failed";
        const maximum = 4096;
        const short = raw.length > maximum ? raw.slice(0, maximum) + " [diagnostic truncated]" : raw;
        const message = short.replace(/^[A-Z][A-Z0-9]+: /u, "");
        const location = path === undefined ? "" : `${JSON.stringify(path)}: `;
        await this.emit(this.caller.stderr, `du: ${location}${message.replace(/[\x00-\x1f\x7f]/gu, character => `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`)}\n`, this.caller.signal);
    }
}
//# sourceMappingURL=budget.js.map