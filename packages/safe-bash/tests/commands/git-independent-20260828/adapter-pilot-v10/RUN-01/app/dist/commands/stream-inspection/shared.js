import { FsError, readBytes, resolvePath, writeBytes } from "../../contracts/index.js";
import { diagnostic } from "../internal.js";
export function settings(options) {
    const limits = {
        maxInputBytes: 32 * 1024 * 1024, maxOutputBytes: 64 * 1024 * 1024,
        maxRecordBytes: 8 * 1024 * 1024, maxChunkBytes: 1024 * 1024,
        maxFiles: 64, maxSteps: 256 * 1024 * 1024, maxArgumentBytes: 65536,
        ...options.limits,
    };
    for (const [name, value] of Object.entries(limits)) {
        if (!Number.isSafeInteger(value) || value < 1)
            throw new RangeError(`Invalid stream-inspection limit: ${name}`);
    }
    return limits;
}
class InputFailure extends Error {
    original;
    constructor(original) {
        super("input failed");
        this.original = original;
    }
}
export class Session {
    context;
    limits;
    inputBytes = 0;
    outputBytes = 0;
    steps = 0;
    untilYield = 4096;
    stdin;
    controller = new AbortController();
    signal;
    failed = false;
    constructor(context, limits) {
        this.context = context;
        this.limits = limits;
        this.signal = AbortSignal.any([context.signal, this.controller.signal]);
        this.check(context.args.reduce((size, value) => size + Buffer.byteLength(value), 0), limits.maxArgumentBytes, "argument");
    }
    check(size, maximum, label) {
        if (size > maximum)
            throw new FsError("EFBIG", { message: `stream-inspection ${label} limit exceeded` });
    }
    async step(count = 1) {
        this.signal.throwIfAborted();
        this.steps += count;
        this.check(this.steps, this.limits.maxSteps, "step");
        this.untilYield -= count;
        if (this.untilYield <= 0) {
            this.untilYield = 4096;
            await new Promise(resolve => setImmediate(resolve));
            this.signal.throwIfAborted();
        }
    }
    async output(bytes) {
        this.check(this.outputBytes + bytes.length, this.limits.maxOutputBytes, "output");
        this.outputBytes += bytes.length;
        const width = Math.min(16384, this.limits.maxChunkBytes);
        for (let offset = 0; offset < bytes.length; offset += width) {
            await this.step();
            await writeBytes(this.context.stdout, new Uint8Array(bytes.subarray(offset, offset + width)), this.signal);
        }
    }
    names(operands) {
        const names = operands.length ? operands : ["-"];
        this.check(names.length, this.limits.maxFiles, "file");
        return names;
    }
    async *read(name) {
        const controller = new AbortController();
        const signal = AbortSignal.any([this.signal, controller.signal]);
        let reader;
        try {
            const session = this;
            const source = (async function* () {
                if (name === "-") {
                    session.stdin ??= session.context.stdin[Symbol.asyncIterator]();
                    const cursor = session.stdin;
                    yield* { [Symbol.asyncIterator]() { return { next: () => cursor.next() }; } };
                }
                else {
                    if (!name)
                        throw new FsError("ENOENT", { path: name });
                    const path = resolvePath(session.context.cwd, name);
                    const stat = await session.context.fs.stat(path, { signal });
                    signal.throwIfAborted();
                    if (stat.type === "directory")
                        throw new FsError("EISDIR", { path });
                    if (session.context.fs.readStream)
                        yield* session.context.fs.readStream(path, { signal });
                    else
                        yield await session.context.fs.readFile(path, { signal, maxBytes: Math.min(session.limits.maxChunkBytes, session.limits.maxInputBytes - session.inputBytes) });
                }
            })();
            reader = readBytes(source, signal);
            while (true) {
                await this.step();
                let item;
                try {
                    item = await reader.next();
                }
                catch (error) {
                    this.signal.throwIfAborted();
                    throw new InputFailure(error);
                }
                if (item.done)
                    break;
                this.check(item.value.length, this.limits.maxChunkBytes, "chunk");
                this.inputBytes += item.value.length;
                this.check(this.inputBytes, this.limits.maxInputBytes, "input");
                yield item.value;
            }
        }
        finally {
            controller.abort(new FsError("EPIPE", { message: "stream-inspection input transfer ended" }));
            if (reader)
                await reader.return(undefined).catch(() => { });
        }
    }
    async files(names, process) {
        for (const name of names) {
            try {
                await process(this.read(name), name);
            }
            catch (error) {
                this.signal.throwIfAborted();
                if (!(error instanceof InputFailure))
                    throw error;
                await diagnostic(this.context, error.original);
                this.failed = true;
            }
        }
    }
    async close() {
        this.controller.abort(new FsError("EPIPE", { message: "stream-inspection command ended" }));
        if (this.stdin?.return) {
            const cleanup = Promise.resolve().then(() => this.stdin.return());
            void cleanup.catch(() => { });
        }
    }
}
export function command(name, limits, run) {
    return { name, async execute(context) {
            context.signal.throwIfAborted();
            let session;
            try {
                session = new Session(context, limits);
                await run(session);
                context.signal.throwIfAborted();
                return { exitCode: session.failed ? 1 : 0 };
            }
            catch (error) {
                context.signal.throwIfAborted();
                await diagnostic(context, error);
                return { exitCode: 1 };
            }
            finally {
                await session?.close();
            }
        } };
}
export class ByteOutput {
    session;
    bytes;
    size = 0;
    constructor(session) {
        this.session = session;
        this.bytes = new Uint8Array(Math.min(16384, session.limits.maxChunkBytes));
    }
    async byte(value) {
        this.bytes[this.size++] = value;
        if (this.size === this.bytes.length)
            await this.flush();
    }
    async flush() {
        if (this.size)
            await this.session.output(this.bytes.subarray(0, this.size));
        this.size = 0;
    }
}
export class RecordBuffer {
    session;
    bytes;
    size = 0;
    constructor(session) {
        this.session = session;
        this.bytes = new Uint8Array(Math.min(1024, session.limits.maxRecordBytes));
    }
    push(byte) {
        this.session.check(this.size + 1, this.session.limits.maxRecordBytes, "record");
        if (this.size === this.bytes.length) {
            const grown = new Uint8Array(Math.min(this.bytes.length * 2, this.session.limits.maxRecordBytes));
            grown.set(this.bytes);
            this.bytes = grown;
        }
        this.bytes[this.size++] = byte;
    }
    view() { return this.bytes.subarray(0, this.size); }
    drop(count) { this.bytes.copyWithin(0, count, this.size); this.size -= count; }
    clear() { this.size = 0; }
}
//# sourceMappingURL=shared.js.map