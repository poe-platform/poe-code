import { setImmediate } from "node:timers/promises";
import { createInflateRaw } from "node:zlib";
import { readBytes } from "../../../contracts/index.js";
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++)
        value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    return value >>> 0;
});
function updateCrc(value, bytes) {
    for (const byte of bytes)
        value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
    return value >>> 0;
}
class Input {
    signal;
    iterator;
    pending = new Uint8Array();
    pulls = 0;
    constructor(source, signal) {
        this.signal = signal;
        this.iterator = readBytes(source, signal);
    }
    async chunk() {
        this.signal.throwIfAborted();
        if (this.pending.length) {
            const result = this.pending;
            this.pending = new Uint8Array();
            return result;
        }
        if (++this.pulls % 64 === 0)
            await setImmediate(undefined, { signal: this.signal });
        const next = await this.iterator.next();
        return next.done ? undefined : next.value;
    }
    restore(bytes) { this.pending = bytes; }
    async byte() {
        const chunk = await this.chunk();
        if (!chunk)
            return undefined;
        this.restore(chunk.subarray(1));
        return chunk[0];
    }
    async required() {
        const value = await this.byte();
        if (value === undefined)
            throw new Error("unexpected end of file");
        return value;
    }
    async exact(length) {
        const result = new Uint8Array(length);
        for (let offset = 0; offset < length; offset++)
            result[offset] = await this.required();
        return result;
    }
    async close() { await this.iterator.return(undefined); }
}
async function header(input, magic) {
    const fixed = await input.exact(8);
    if (fixed[0] !== 8)
        throw new Error("unknown compression method");
    const flags = fixed[1];
    if (flags & 0xe0)
        throw new Error("invalid gzip header flags");
    let crc = updateCrc(updateCrc(0xffffffff, magic), fixed);
    const next = async () => {
        const value = await input.required();
        crc = ((crc >>> 8) ^ crcTable[(crc ^ value) & 255]) >>> 0;
        return value;
    };
    if (flags & 4) {
        const length = (await next()) | ((await next()) << 8);
        for (let offset = 0; offset < length; offset++)
            await next();
    }
    for (const flag of [8, 16])
        if (flags & flag)
            while (await next()) { }
    if (flags & 2) {
        const expected = (await input.required()) | ((await input.required()) << 8);
        if (((crc ^ 0xffffffff) & 0xffff) !== expected)
            throw new Error("header crc mismatch");
    }
}
async function* inflate(input, signal) {
    const options = { chunkSize: 64 * 1024, highWaterMark: 64 * 1024 };
    const codec = createInflateRaw(options);
    const abort = () => { codec.destroy(signal.reason instanceof Error ? signal.reason : new Error("aborted")); };
    signal.addEventListener("abort", abort, { once: true });
    const writing = (async () => {
        try {
            for (;;) {
                const chunk = await input.chunk();
                if (!chunk) {
                    codec.end();
                    return;
                }
                const before = codec.bytesWritten;
                await new Promise((resolve, reject) => codec.write(chunk, error => error ? reject(error) : resolve()));
                const consumed = codec.bytesWritten - before;
                if (consumed < chunk.length) {
                    input.restore(chunk.subarray(consumed));
                    codec.end();
                    return;
                }
            }
        }
        catch (error) {
            codec.destroy(error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    })();
    void writing.catch(() => { });
    try {
        for await (const chunk of readBytes(codec, signal))
            yield chunk;
        await writing;
    }
    finally {
        codec.destroy();
        signal.removeEventListener("abort", abort);
        await writing.catch(() => { });
    }
}
export async function* gunzipMembers(source, signal, force, warn) {
    const input = new Input(source, signal);
    let members = 0;
    try {
        for (;;) {
            const first = await input.byte();
            if (first === undefined) {
                if (!members && !force)
                    throw new Error("unexpected end of file");
                return;
            }
            const second = await input.byte();
            if (first !== 31 || second !== 139) {
                if (force) {
                    yield Uint8Array.from(second === undefined ? [first] : [first, second]);
                    for (;;) {
                        const chunk = await input.chunk();
                        if (!chunk)
                            return;
                        yield chunk;
                    }
                }
                if (members && first === 0) {
                    let garbage = second !== undefined && second !== 0;
                    for (;;) {
                        const chunk = await input.chunk();
                        if (!chunk)
                            break;
                        if (chunk.some(value => value !== 0))
                            garbage = true;
                    }
                    if (garbage)
                        warn();
                    return;
                }
                if (second === undefined)
                    throw new Error("unexpected end of file");
                if (!members)
                    throw new Error("not in gzip format");
                warn();
                return;
            }
            await header(input, Uint8Array.of(first, second));
            let crc = 0xffffffff;
            let size = 0;
            for await (const chunk of inflate(input, signal)) {
                crc = updateCrc(crc, chunk);
                size = (size + chunk.length) >>> 0;
                yield chunk;
            }
            const footer = await input.exact(8);
            const view = new DataView(footer.buffer, footer.byteOffset, footer.byteLength);
            if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(0, true))
                throw new Error("incorrect data check (CRC)");
            if (size !== view.getUint32(4, true))
                throw new Error("incorrect length check");
            members++;
        }
    }
    finally {
        await input.close();
    }
}
//# sourceMappingURL=gunzip.js.map