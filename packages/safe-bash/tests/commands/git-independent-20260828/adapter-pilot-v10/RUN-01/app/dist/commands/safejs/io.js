import { setImmediate } from "node:timers/promises";
import { readBytes, writeBytes } from "../../contracts/index.js";
import { SafeJsCommandLimitError } from "./types.js";
import { renderOutput } from "./render.js";
const chunkSize = 64 * 1024;
export class GuestInput {
    limit;
    signal;
    fail;
    resource;
    iterator;
    pending = new Uint8Array();
    consumed = 0;
    pulls = 0;
    queue = Promise.resolve();
    constructor(source, limit, signal, fail, resource = "maxInputBytes") {
        this.limit = limit;
        this.signal = signal;
        this.fail = fail;
        this.resource = resource;
        this.iterator = readBytes(source, signal);
    }
    async take(size) {
        this.signal.throwIfAborted();
        while (!this.pending.length) {
            if (++this.pulls % 64 === 0)
                await setImmediate(undefined, { signal: this.signal });
            const next = await this.iterator.next();
            if (next.done)
                return undefined;
            this.pending = next.value;
        }
        const length = Math.min(size, this.pending.length);
        if (length > this.limit - this.consumed) {
            const error = new SafeJsCommandLimitError(this.resource);
            this.fail(error);
            throw error;
        }
        const bytes = this.pending.slice(0, length);
        this.pending = this.pending.subarray(length);
        this.consumed += length;
        return bytes;
    }
    serialize(operation) {
        const result = this.queue.then(operation);
        this.queue = result.then(() => { }, () => { });
        return result;
    }
    readBytes(size = chunkSize) {
        if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > chunkSize)
            throw new TypeError("readBytes size must be an integer from 1 through 65536");
        return this.serialize(async () => { const bytes = await this.take(size); return bytes === undefined ? null : Array.from(bytes); });
    }
    readText() {
        return this.serialize(async () => {
            const pieces = [];
            for (;;) {
                const chunk = await this.take(chunkSize);
                if (!chunk)
                    break;
                pieces.push(chunk);
            }
            return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(pieces));
        });
    }
    async close() { await this.iterator.return(undefined); }
}
export class GuestOutput {
    stdout;
    stderr;
    limit;
    signal;
    fail;
    queue = Promise.resolve();
    produced = 0;
    stderrFailed = false;
    constructor(stdout, stderr, limit, signal, fail) {
        this.stdout = stdout;
        this.stderr = stderr;
        this.limit = limit;
        this.signal = signal;
        this.fail = fail;
    }
    enqueue(bytes, target) {
        this.signal.throwIfAborted();
        if (bytes.length > this.limit - this.produced) {
            const error = new SafeJsCommandLimitError("maxOutputBytes");
            this.fail(error);
            throw error;
        }
        this.produced += bytes.length;
        const queued = this.queue.then(async () => {
            for (let offset = 0; offset < bytes.length; offset += chunkSize)
                await writeBytes(target, bytes.subarray(offset, offset + chunkSize), this.signal);
        }).catch(error => { if (target === this.stderr)
            this.stderrFailed = true; this.fail(error); throw error; });
        this.queue = queued;
        void queued.catch(() => { });
        return queued;
    }
    text(value, stderr = false) {
        if (typeof value !== "string")
            throw new TypeError("stdio text output requires a string");
        if (Buffer.byteLength(value) > this.limit - this.produced) {
            const error = new SafeJsCommandLimitError("maxOutputBytes");
            this.fail(error);
            throw error;
        }
        return this.enqueue(Buffer.from(value), stderr ? this.stderr : this.stdout);
    }
    bytes(value, stderr = false) {
        if (!Array.isArray(value) || value.length > chunkSize)
            throw new TypeError("stdio byte output requires an array of at most 65536 bytes");
        for (const byte of value)
            if (!Number.isInteger(byte) || byte < 0 || byte > 255)
                throw new TypeError("stdio byte values must be integers from 0 through 255");
        return this.enqueue(Uint8Array.from(value), stderr ? this.stderr : this.stdout);
    }
    console(args, stderr) {
        void this.text(renderOutput(args, this.limit - this.produced, this.fail), stderr);
    }
    result(value) {
        return this.text(renderOutput([value], this.limit - this.produced, this.fail));
    }
    async drain() { await this.queue; }
}
//# sourceMappingURL=io.js.map