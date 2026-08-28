import { setImmediate as yieldTurn } from "node:timers/promises";
import { FsError, readBytes } from "../../contracts/index.js";
import { pathOf } from "../internal.js";
export async function interruptible(operation, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(resolve, reject)
            .finally(() => signal.removeEventListener("abort", abort));
    });
}
export class Budget {
    limits;
    signal;
    inputBytes = 0;
    outputBytes = 0;
    steps = 0;
    untilYield = 65536;
    constructor(limits, signal) {
        this.limits = limits;
        this.signal = signal;
    }
    check(value, maximum, label) {
        if (value > maximum)
            throw new FsError("EFBIG", { message: `split ${label} limit exceeded` });
    }
    input(size) {
        this.check(size, this.limits.maxInputBytes - this.inputBytes, "input");
        this.inputBytes += size;
    }
    output(size) {
        this.signal.throwIfAborted();
        this.check(size, this.limits.maxOutputBytes - this.outputBytes, "output");
        this.outputBytes += size;
    }
    async step(count = 1) {
        this.signal.throwIfAborted();
        this.check(count, this.limits.maxSteps - this.steps, "work");
        this.steps += count;
        this.untilYield -= count;
        if (this.untilYield <= 0) {
            this.untilYield = 65536;
            await yieldTurn(undefined, { signal: this.signal }).catch(error => { this.signal.throwIfAborted(); throw error; });
        }
        this.signal.throwIfAborted();
    }
}
export class Cursor {
    budget;
    iterator;
    bytes = new Uint8Array();
    offset = 0;
    ended = false;
    constructor(context, input, budget) {
        this.budget = budget;
        const { signal, limits } = budget;
        const source = (async function* () {
            if (input === "-")
                yield* readBytes(context.stdin, signal);
            else {
                const path = pathOf(context, input);
                if (context.fs.readStream && context.fs.capabilities.streamingRead !== false) {
                    yield* readBytes(context.fs.readStream(path, { signal, chunkSize: limits.maxChunkBytes }), signal);
                }
                else {
                    const maxBytes = Math.min(limits.maxInputBytes, limits.maxBufferBytes);
                    const bytes = await interruptible(() => context.fs.readFile(path, { signal, maxBytes }), signal);
                    budget.check(bytes.byteLength, maxBytes, "read buffer");
                    yield bytes;
                }
            }
        })();
        this.iterator = readBytes(source, signal);
    }
    async peek() {
        while (!this.ended && this.offset === this.bytes.length) {
            await this.budget.step();
            const result = await this.iterator.next();
            if (result.done) {
                this.ended = true;
                this.bytes = new Uint8Array();
                this.offset = 0;
                break;
            }
            this.budget.input(result.value.byteLength);
            this.bytes = result.value;
            this.offset = 0;
        }
        return this.bytes.subarray(this.offset, Math.min(this.bytes.length, this.offset + this.budget.limits.maxChunkBytes));
    }
    take(size) {
        const result = new Uint8Array(this.bytes.subarray(this.offset, this.offset + size));
        this.offset += size;
        return result;
    }
    close() {
        void this.iterator.return(undefined).catch(() => { });
    }
}
//# sourceMappingURL=io.js.map