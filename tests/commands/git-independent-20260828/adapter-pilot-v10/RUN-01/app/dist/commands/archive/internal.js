import { collectBytes, readBytes, writeBytes } from "../../contracts/index.js";
export const DEFAULT_ARCHIVE_LIMITS = Object.freeze({
    maxArchiveBytes: 256 * 1024 * 1024,
    maxEntryBytes: 64 * 1024 * 1024,
    maxTotalBytes: 256 * 1024 * 1024,
    maxMembers: 10_000,
    maxPathBytes: 4096,
    maxDepth: 128,
    maxPaxBytes: 1024 * 1024,
    maxFilesFromBytes: 1024 * 1024,
    maxArgumentBytes: 64 * 1024,
    maxTextBytes: 1024 * 1024,
    maxDiagnosticBytes: 4096,
    maxPatternSteps: 10_000_000,
    maxBufferedFileBytes: 1024 * 1024,
    chunkSize: 64 * 1024,
});
export function settings(options) {
    const limits = { ...DEFAULT_ARCHIVE_LIMITS, ...options.limits };
    for (const [key, value] of Object.entries(limits)) {
        if (!Object.hasOwn(DEFAULT_ARCHIVE_LIMITS, key) || !Number.isSafeInteger(value) || value < 1)
            throw new RangeError(`Invalid archive limit: ${key}`);
    }
    if (limits.chunkSize < 512 || limits.chunkSize > 1024 * 1024)
        throw new RangeError("Archive chunkSize must be between 512 and 1048576");
    return Object.freeze(limits);
}
export function fail(message) { throw new Error(message); }
export function vfsPath(cwd, path) {
    return path.startsWith("/") ? path : `${cwd === "/" ? "" : cwd}/${path}`;
}
export function wait(signal, action) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
        signal.addEventListener("abort", abort, { once: true });
        try {
            Promise.resolve(action()).then(value => {
                signal.removeEventListener("abort", abort);
                resolve(value);
            }, error => { signal.removeEventListener("abort", abort); reject(error); });
        }
        catch (error) {
            signal.removeEventListener("abort", abort);
            reject(error);
        }
    });
}
export function operation(context, action) {
    return wait(context.signal, action);
}
export async function maybeStat(context, path) {
    try {
        return await operation(context, () => context.fs.lstat(path, { signal: context.signal }));
    }
    catch (error) {
        context.signal.throwIfAborted();
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
            return undefined;
        throw error;
    }
}
export function hasIdentity(stat) {
    return ((typeof stat.identityScope === "object" && stat.identityScope !== null) || typeof stat.identityScope === "symbol")
        && Number.isSafeInteger(stat.dev) && stat.dev >= 0 && Number.isSafeInteger(stat.ino) && stat.ino >= 0;
}
export function sameIdentity(first, second) {
    return hasIdentity(first) && hasIdentity(second) && first.identityScope === second.identityScope && first.dev === second.dev && first.ino === second.ino;
}
export function text(bytes) {
    try {
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    }
    catch {
        return fail("invalid UTF-8 archive name or metadata");
    }
}
export function checkPath(path, limits) {
    if (!path || path.includes("\0") || Buffer.from(path).toString("utf8") !== path)
        fail("invalid empty, NUL, or non-Unicode path");
    if (Buffer.byteLength(path) > limits.maxPathBytes)
        fail("path byte limit exceeded");
    if (path.split("/").length > limits.maxDepth + 1)
        fail("path depth limit exceeded");
}
export function display(path) {
    return path.replace(/[\\\x00-\x1f\x7f]/gu, character => {
        if (character === "\\")
            return "\\\\";
        if (character === "\n")
            return "\\n";
        if (character === "\r")
            return "\\r";
        if (character === "\t")
            return "\\t";
        return `\\${character.charCodeAt(0).toString(8).padStart(3, "0")}`;
    });
}
export class Budget {
    context;
    limits;
    members = 0;
    totalBytes = 0;
    textBytes = 0;
    constructor(context, limits) {
        this.context = context;
        this.limits = limits;
    }
    async member(size = 0) {
        this.context.signal.throwIfAborted();
        if (++this.members > this.limits.maxMembers)
            fail("member/header limit exceeded");
        if (!Number.isSafeInteger(size) || size < 0 || size > this.limits.maxEntryBytes)
            fail("entry byte limit exceeded");
        if (size > this.limits.maxTotalBytes - this.totalBytes)
            fail("total payload byte limit exceeded");
        this.totalBytes += size;
        if (this.members % 128 === 0)
            await wait(this.context.signal, () => new Promise(resolve => setImmediate(resolve)));
    }
    async output(value, stderr = false) {
        const bytes = Buffer.from(value);
        if (bytes.length > this.limits.maxTextBytes - this.textBytes)
            fail("text output limit exceeded");
        this.textBytes += bytes.length;
        await writeBytes(stderr ? this.context.stderr : this.context.stdout, bytes, this.context.signal);
    }
}
export async function* bounded(source, maximum, signal, chunkSize) {
    let size = 0;
    let turns = 0;
    for await (const chunk of readBytes(source, signal)) {
        if (chunk.length > maximum - size)
            fail("archive byte limit exceeded");
        size += chunk.length;
        for (let offset = 0; offset < chunk.length; offset += chunkSize) {
            signal.throwIfAborted();
            yield chunk.subarray(offset, Math.min(chunk.length, offset + chunkSize));
        }
        if (++turns % 128 === 0)
            await wait(signal, () => new Promise(resolve => setImmediate(resolve)));
    }
}
export async function* fileSource(context, path, limits) {
    context.signal.throwIfAborted();
    if (context.fs.readStream) {
        yield* readBytes(context.fs.readStream(path, { signal: context.signal, chunkSize: limits.chunkSize }), context.signal);
    }
    else {
        const stat = await operation(context, () => context.fs.stat(path, { signal: context.signal }));
        if (stat.size > limits.maxBufferedFileBytes)
            fail("filesystem lacks streaming reads: buffered file limit exceeded");
        const bytes = await operation(context, () => context.fs.readFile(path, { signal: context.signal, maxBytes: limits.maxBufferedFileBytes }));
        if (bytes.length > limits.maxBufferedFileBytes)
            fail("buffered file limit exceeded");
        yield bytes;
    }
}
export async function publish(context, path, source, mode = 0o600) {
    const options = { signal: context.signal, flag: "wx", mode };
    if (context.fs.writeStream) {
        let finished = false;
        const observed = (async function* () { yield* readBytes(source, context.signal); finished = true; })();
        try {
            await operation(context, () => context.fs.writeStream(path, observed, options));
            if (!finished)
                fail("filesystem writeStream returned before consuming its source");
        }
        finally {
            void observed.return(undefined).catch(() => { });
        }
    }
    else {
        await operation(context, () => context.fs.writeFile(path, new Uint8Array(), options));
        for await (const chunk of readBytes(source, context.signal)) {
            await operation(context, () => context.fs.appendFile(path, chunk, { signal: context.signal }));
        }
    }
}
export async function smallFile(context, path, limits) {
    return collectBytes(fileSource(context, path, limits), { signal: context.signal, maxBytes: limits.maxFilesFromBytes });
}
//# sourceMappingURL=internal.js.map