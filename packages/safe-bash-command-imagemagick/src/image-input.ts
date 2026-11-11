import { isMpc, mpcCachePath, mpcInput } from "./mpc-input.js";
import { withImageSource, type ImageByteSource } from "@poe-code/image-ast/portable";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { FsError, type FileSystem } from "@poe-code/safe-fs/contracts";
import { resolvePath } from "safe-bash-contracts/path";
import { readBytes } from "safe-bash-contracts/io";
export interface ImageFileInput {
    readonly filesystem: FileSystem;
    readonly cwd: string;
    readonly stdin?: AsyncIterable<Uint8Array>;
    readonly inputBudget?: {
        check(bytes: number): void;
    };
}
export interface ImageInputReader {
    <Result>(path: string, inspect: (source: ImageByteSource) => Promise<Result>): Promise<Result | undefined>;
    /** Retire input backing before publishing derived output. */
    close(): Promise<void>;
}
const missing = (error: unknown) => error instanceof FsError && ["ENOENT", "ENOTDIR", "EISDIR", "EACCES", "EPERM"].includes(error.code);
export async function withImageInputs<T>(input: ImageFileInput, stdinBytes: Uint8Array | undefined, signal: AbortSignal, run: (reader: ImageInputReader) => Promise<T>): Promise<T> {
    const { filesystem: fs, cwd, stdin, inputBudget } = input, io = { signal };
    let total = 0, failed = true, stdinSource: ImageByteSource | undefined, stdinStorage: PagedStorage | undefined;
    const charge = (size: number) => { total += size; inputBudget?.check(total); };
    const snapshot = async (stream: AsyncIterable<Uint8Array>, backing: PagedStorage): Promise<ImageByteSource> => {
        const base = backing.allocate(0);
        let size = 0;
        for await (const chunk of readBytes(stream, signal)) {
            charge(chunk.length);
            const position = backing.allocate(chunk.length);
            for (let offset = 0; offset < chunk.length; offset += 16384)
                await backing.write(position + offset, chunk.subarray(offset, offset + 16384));
            size += chunk.length;
        }
        return { size, async read(position, length) {
                if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 0 || position + length > size)
                    throw new RangeError("Invalid image input range");
                const bytes = new Uint8Array(length);
                for (let offset = 0; offset < length; offset += 16384)
                    bytes.set(await backing.read(base + position + offset, Math.min(16384, length - offset)), offset);
                return bytes;
            } };
    };
    let retired = false, closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => { retired = true; await stdinStorage?.close(); })();
    const readFile: ImageInputReader = Object.assign(async <Result>(path: string, inspect: (source: ImageByteSource) => Promise<Result>) => {
        if (retired)
            throw new FsError("ECANCELED");
        let result: Result | undefined;
        if (path === "-") {
            if (!stdinSource) {
                if (stdinBytes) {
                    charge(stdinBytes.length);
                    stdinSource = { size: stdinBytes.length, async read(position, length) { return stdinBytes!.subarray(position, position + length); } };
                }
                else if (stdin) {
                    stdinStorage = new PagedStorage({ fs, cwd: cwd, env: {}, signal });
                    stdinSource = await snapshot(stdin, stdinStorage);
                }
            }
            if (stdinSource)
                result = await inspect(stdinSource);
        }
        else {
            const absolute = resolvePath(cwd, path);
            let acquired = false;
            try {
                const capabilities = await fs.capabilitiesFor?.(absolute, io) ?? fs.capabilities;
                const fallback = async () => {
                    const buffered = async () => {
                        const bytes = await fs.readFile(absolute, io);
                        acquired = true;
                        charge(bytes.length);
                        return withImageSource(bytes, fs, signal, inspect);
                    };
                    if (!fs.readStream || capabilities.streamingRead === false || fs.capabilities.streamingRead === false)
                        return buffered();
                    const backing = new PagedStorage({ fs, cwd, env: {}, signal });
                    let failed = true;
                    try {
                        let started = false;
                        const stream = (async function* () {
                            for await (const chunk of readBytes(fs.readStream!(absolute, { ...io, chunkSize: 16384 }), signal)) {
                                started = true;
                                acquired = true;
                                yield chunk;
                            }
                        })();
                        let source: ImageByteSource;
                        try {
                            source = await snapshot(stream, backing);
                        }
                        catch (error) {
                            signal.throwIfAborted();
                            if (started || !(error instanceof FsError) || error.code !== "ENOTSUP")
                                throw error;
                            await backing.close();
                            return buffered();
                        }
                        acquired = true;
                        const result = await inspect(source);
                        failed = false;
                        return result;
                    }
                    finally {
                        try {
                            await backing.close();
                        }
                        catch (error) {
                            if (!failed)
                                await Promise.reject(error);
                        }
                    }
                };
                if (capabilities.retainedRead && fs.openReadFile) {
                    let entered = false;
                    try {
                        result = await withImageSource(absolute, fs, signal, source => { entered = true; acquired = true; charge(source.size); return inspect(source); });
                    }
                    catch (error) {
                        if (entered || !(error instanceof FsError) || error.code !== "ENOTSUP")
                            throw error;
                        result = await fallback();
                    }
                }
                else
                    result = await fallback();
            }
            catch (error) {
                if (acquired || !missing(error))
                    throw error;
            }
        }
        return result;
    }, { close });
    const read: ImageInputReader = Object.assign(async <Result>(path: string, consume: (source: ImageByteSource) => Promise<Result>) => {
        const inspect = async (source: ImageByteSource): Promise<Result> => {
            if (!isMpc(await source.read(0, Math.min(19, source.size), io))) return consume(source);
            const cachePath = mpcCachePath(path);
            let found = false;
            const result = await readFile(cachePath, async cache => {
                found = true;
                const steps = mpcInput(source.size, cache.size);
                let next = steps.next();
                while (!next.done) {
                    signal.throwIfAborted();
                    next = steps.next(await source.read(next.value.offset, next.value.length, io));
                }
                const layout = next.value;
                return consume({ size: layout.size, async read(position, length) {
                    const reads = layout.read(position, length);
                    let part = reads.next();
                    while (!part.done) {
                        signal.throwIfAborted();
                        part = reads.next(await cache.read(part.value.offset, part.value.length, io));
                    }
                    return part.value;
                } });
            });
            if (!found) throw new Error(`Missing MPC pixel cache '${cachePath}'`);
            return result!;
        };
        return readFile(path, inspect);
    }, { close });
    try {
        const result = await run(read);
        failed = false;
        return result;
    }
    finally {
        try {
            await close();
        }
        catch (error) {
            if (!failed)
                await Promise.reject(error);
        }
    }
}
