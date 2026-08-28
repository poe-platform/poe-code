import { Worker } from "node:worker_threads";
import { defaults, inputBytes, policy, RegexExecutionError, validateReply, validateExprInput, validateExprReply } from "./protocol.js";
export { RegexExecutionError } from "./protocol.js";
async function awaitRetirements(retirements) {
    const results = await Promise.allSettled(retirements);
    const failures = results.filter(result => result.status === "rejected").map(result => result.reason);
    if (failures.length === 1)
        throw failures[0];
    if (failures.length > 1)
        throw new AggregateError(failures, "regex retirement failed");
}
export async function withRegexSession(context, executor, execute) {
    context.signal.throwIfAborted();
    let session;
    let closing;
    const close = () => closing ??= (async () => { await session?.close(); })();
    try {
        context.registerCleanup?.(close);
    }
    catch (error) {
        context.signal.throwIfAborted();
        throw error;
    }
    let rejected = false;
    try {
        context.signal.throwIfAborted();
        if (closing)
            throw new RegexExecutionError("CLOSED", "invocation is closed");
        session = executor.open(context.signal);
        return await execute(session);
    }
    catch (error) {
        rejected = true;
        throw error;
    }
    finally {
        try {
            await close();
        }
        catch (error) {
            context.signal.throwIfAborted();
            if (!rejected)
                throw error;
        }
        context.signal.throwIfAborted();
    }
}
class Slot {
    owner;
    worker;
    busy = true;
    ready = false;
    retired;
    idleTimer;
    receiver;
    failure;
    terminal;
    exited = false;
    message = (value) => {
        if (this.receiver)
            this.receiver(value);
        else
            this.fail(new RegexExecutionError("PROTOCOL", "unexpected idle message"));
    };
    error = (error) => this.fail(new RegexExecutionError("WORKER_ERROR", error.message));
    messageerror = () => this.fail(new RegexExecutionError("PROTOCOL", "worker message could not be deserialized"));
    exit = (code) => {
        this.exited = true;
        this.fail(new RegexExecutionError("WORKER_EXIT", `worker exited (${code})`));
    };
    constructor(owner) {
        this.owner = owner;
        this.worker = new Worker(new URL(import.meta.url.endsWith(".ts") ? "../../../dist/commands/regex-execution/worker.js" : "./worker.js", import.meta.url), {
            execArgv: [], resourceLimits: {
                maxOldGenerationSizeMb: owner.options.workerOldGenerationMb,
                stackSizeMb: owner.options.workerStackMb,
            },
        });
        this.worker.on("message", this.message);
        this.worker.on("messageerror", this.messageerror);
        this.worker.on("error", this.error);
        this.worker.on("exit", this.exit);
    }
    fail(error) {
        this.terminal ??= error;
        if (this.failure)
            this.failure(error);
        else if (!this.busy)
            void this.retire();
    }
    exchange(timeout, startup, signal, send) {
        signal.throwIfAborted();
        if (this.terminal !== undefined)
            return Promise.reject(this.terminal);
        return new Promise((resolve, reject) => {
            const finish = (rejected, value) => {
                clearTimeout(timer);
                this.receiver = undefined;
                this.failure = undefined;
                if (rejected)
                    reject(value);
                else
                    resolve(value);
            };
            const timer = setTimeout(() => finish(true, new RegexExecutionError(startup ? "STARTUP_TIMEOUT" : "REQUEST_TIMEOUT", `${startup ? "startup" : "active request"} exceeded ${timeout}ms`)), timeout);
            this.receiver = value => finish(false, value);
            this.failure = error => finish(true, error);
            try {
                signal.throwIfAborted();
                send?.();
            }
            catch (error) {
                finish(true, error);
            }
        });
    }
    retire() {
        if (this.retired)
            return this.retired;
        clearTimeout(this.idleTimer);
        this.worker.ref();
        this.retired = (async () => {
            if (!this.exited)
                await this.worker.terminate();
        })().finally(() => {
            this.worker.off("message", this.message);
            this.worker.off("messageerror", this.messageerror);
            this.worker.off("error", this.error);
            this.worker.off("exit", this.exit);
            this.receiver = undefined;
            this.failure = undefined;
            if (!this.busy)
                this.owner.retired(this);
        });
        void this.retired.catch(() => { });
        return this.retired;
    }
}
export class RegexExecutor {
    options;
    slots = new Set();
    queue = [];
    queuedBytes = 0;
    sessions = 0;
    sequence = 0;
    disposed = false;
    constructor(options = defaults) { this.options = policy(options); }
    open(signal) {
        signal.throwIfAborted();
        if (this.disposed)
            throw new RegexExecutionError("CLOSED", "executor is disposed");
        this.sessions++;
        return new RegexSession(this, signal);
    }
    async close() {
        this.sessions--;
        if (this.sessions === 0)
            await awaitRetirements([...this.slots].filter(slot => !slot.busy || slot.retired).map(slot => slot.retire()));
    }
    async dispose() {
        this.disposed = true;
        const error = new RegexExecutionError("CLOSED", "executor is disposed");
        for (const pending of this.queue.splice(0)) {
            pending.signal.removeEventListener("abort", pending.abort);
            pending.reject(error);
        }
        this.queuedBytes = 0;
        for (const slot of this.slots)
            slot.fail(error);
        await Promise.all([...this.slots].map(slot => slot.retire()));
    }
    retired(slot) {
        this.slots.delete(slot);
        this.pump();
    }
    request(descriptor, rows, signal, retirements = new Set()) {
        signal.throwIfAborted();
        if (this.disposed)
            return Promise.reject(new RegexExecutionError("CLOSED", "executor is disposed"));
        if (descriptor.kind === "expr-match")
            validateExprInput(descriptor, rows, signal);
        const bytes = descriptor.kind === "expr-match" ? 256 + descriptor.pattern.length + rows[0].bytes.length : inputBytes(descriptor, rows, signal);
        const available = this.queue.length === 0 && ([...this.slots].some(slot => !slot.busy && !slot.retired) || this.slots.size < this.options.maxWorkers);
        if (!available && (this.queue.length >= this.options.maxQueuedRequests || bytes > this.options.maxQueuedBytes - this.queuedBytes))
            return Promise.reject(new RegexExecutionError("QUEUE_EXHAUSTED", "queued request count or input byte limit exceeded"));
        const ownedDescriptor = descriptor.kind === "expr-match"
            ? { ...descriptor, pattern: Uint8Array.from(descriptor.pattern), limits: { ...descriptor.limits } }
            : { ...descriptor, patterns: descriptor.patterns.map(pattern => { signal.throwIfAborted(); return pattern; }) };
        if (ownedDescriptor.kind === "glob") {
            const globOptions = ownedDescriptor.globOptions.map(options => { signal.throwIfAborted(); return { ...options }; });
            Object.assign(ownedDescriptor, { globOptions });
        }
        const ownedRows = rows.map(row => { signal.throwIfAborted(); return { ...row, bytes: Uint8Array.from(row.bytes) }; });
        return new Promise((resolve, reject) => {
            const pending = {
                descriptor: ownedDescriptor, rows: ownedRows, signal, bytes, resolve, reject, retirements,
                abort: () => {
                    if (pending.slot)
                        pending.slot.fail(signal.reason);
                    else {
                        const index = this.queue.indexOf(pending);
                        if (index >= 0) {
                            this.queue.splice(index, 1);
                            this.queuedBytes -= bytes;
                        }
                        signal.removeEventListener("abort", pending.abort);
                        reject(signal.reason);
                        this.pump();
                    }
                },
            };
            signal.addEventListener("abort", pending.abort, { once: true });
            this.queue.push(pending);
            this.queuedBytes += bytes;
            this.pump();
        });
    }
    pump() {
        if (this.disposed)
            return;
        while (this.queue.length) {
            let slot = [...this.slots].find(candidate => !candidate.busy && !candidate.retired);
            if (!slot && this.slots.size >= this.options.maxWorkers)
                return;
            const pending = this.queue.shift();
            this.queuedBytes -= pending.bytes;
            try {
                pending.signal.throwIfAborted();
                if (!slot) {
                    slot = new Slot(this);
                    this.slots.add(slot);
                }
                slot.busy = true;
                pending.slot = slot;
                clearTimeout(slot.idleTimer);
                slot.worker.ref();
                void this.run(slot, pending);
            }
            catch (error) {
                pending.signal.removeEventListener("abort", pending.abort);
                pending.reject(error);
            }
        }
    }
    async run(slot, pending) {
        let result;
        let failure;
        let rejected = false;
        try {
            pending.signal.throwIfAborted();
            if (!slot.ready) {
                const ready = await slot.exchange(this.options.startupTimeoutMs, true, pending.signal);
                if (!ready || typeof ready !== "object" || !("ready" in ready) || ready.ready !== true)
                    throw new RegexExecutionError("PROTOCOL", "invalid startup reply");
                slot.ready = true;
            }
            pending.signal.throwIfAborted();
            const id = ++this.sequence;
            const started = performance.now();
            const reply = await slot.exchange(this.options.requestTimeoutMs, false, pending.signal, () => slot.worker.postMessage({ id, descriptor: pending.descriptor, rows: pending.rows }));
            result = pending.descriptor.kind === "expr-match"
                ? validateExprReply(reply, id, pending.descriptor, pending.rows[0].bytes, pending.signal)
                : validateReply(reply, id, pending.rows, pending.signal);
            if (performance.now() - started > this.options.requestTimeoutMs)
                throw new RegexExecutionError("REQUEST_TIMEOUT", `active request exceeded ${this.options.requestTimeoutMs}ms`);
            pending.signal.throwIfAborted();
        }
        catch (error) {
            rejected = true;
            failure = pending.signal.aborted ? pending.signal.reason : error;
            const retirement = slot.retire();
            pending.retirements.add(retirement);
            try {
                await retirement;
            }
            catch { }
        }
        finally {
            pending.signal.removeEventListener("abort", pending.abort);
            slot.busy = false;
            if (slot.retired)
                this.retired(slot);
            else {
                slot.worker.unref();
                slot.idleTimer = setTimeout(() => { if (!slot.busy)
                    void slot.retire(); }, this.options.idleTimeoutMs);
                slot.idleTimer.unref();
            }
            this.pump();
        }
        if (rejected)
            pending.reject(failure);
        else
            pending.resolve(result);
    }
}
export class RegexSession {
    executor;
    signal;
    closed;
    pending = new Set();
    retirements = new Set();
    controller = new AbortController();
    requestSignal;
    constructor(executor, signal) {
        this.executor = executor;
        this.signal = signal;
        this.requestSignal = AbortSignal.any([signal, this.controller.signal]);
    }
    run(descriptor, rows) {
        this.signal.throwIfAborted();
        if (this.closed)
            throw new RegexExecutionError("CLOSED", "invocation is closed");
        const result = this.executor.request(descriptor, rows, this.requestSignal, this.retirements);
        this.pending.add(result);
        void result.then(() => this.pending.delete(result), () => this.pending.delete(result));
        return result;
    }
    matchExpr(descriptor, subject) {
        this.signal.throwIfAborted();
        if (this.closed)
            throw new RegexExecutionError("CLOSED", "invocation is closed");
        const result = this.executor.request(descriptor, [{ bytes: subject, all: false, terminated: false }], this.requestSignal, this.retirements);
        this.pending.add(result);
        void result.then(() => this.pending.delete(result), () => this.pending.delete(result));
        return result;
    }
    close() {
        return this.closed ??= Promise.resolve().then(async () => {
            this.controller.abort(this.signal.aborted ? this.signal.reason : new RegexExecutionError("CLOSED", "invocation is closed"));
            try {
                await Promise.allSettled([...this.pending]);
            }
            finally {
                await awaitRetirements([...this.retirements, this.executor.close()]);
            }
        });
    }
}
export class AvailableRecords {
    delimiter;
    maxLineBytes;
    extraDelimiter;
    chunk = new Uint8Array(0);
    offset = 0;
    constructor(delimiter, maxLineBytes, extraDelimiter = -1) {
        this.delimiter = delimiter;
        this.maxLineBytes = maxLineBytes;
        this.extraDelimiter = extraDelimiter;
    }
    async *source(source) {
        for await (const chunk of source) {
            this.chunk = Uint8Array.from(chunk);
            this.offset = 0;
            yield this.chunk;
        }
    }
    end() {
        for (let offset = this.offset; offset < this.chunk.length; offset++) {
            if (this.chunk[offset] === this.delimiter || this.chunk[offset] === this.extraDelimiter)
                return offset;
        }
        return -1;
    }
    async *batches(source, size, maxRecords = () => 128) {
        let batch = [];
        let bytes = 0;
        for await (const line of source) {
            const end = this.end();
            this.offset = end < 0 ? this.chunk.length : end + 1;
            batch.push(line);
            bytes += size(line);
            const next = this.end();
            if (batch.length >= maxRecords() || bytes >= 64 * 1024 || next < 0 || bytes + next - this.offset > 64 * 1024 || next - this.offset > this.maxLineBytes) {
                yield batch;
                batch = [];
                bytes = 0;
            }
        }
        if (batch.length)
            yield batch;
    }
}
//# sourceMappingURL=client.js.map