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
    let retired = false, closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => { retired = true; await stdinStorage?.close(); })();
    const read: ImageInputReader = Object.assign(async <Result>(path: string, inspect: (source: ImageByteSource) => Promise<Result>) => {
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
                    const backing = stdinStorage, base = backing.allocate(0);
                    let size = 0;
                    for await (const chunk of readBytes(stdin, signal)) {
                        charge(chunk.length);
                        const position = backing.allocate(chunk.length);
                        for (let offset = 0; offset < chunk.length; offset += 16384)
                            await backing.write(position + offset, chunk.subarray(offset, offset + 16384));
                        size += chunk.length;
                    }
                    stdinSource = { size, async read(position, length) {
                            if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 0 || position + length > size)
                                throw new RangeError("Invalid image input range");
                            const bytes = new Uint8Array(length);
                            for (let offset = 0; offset < length; offset += 16384)
                                bytes.set(await backing.read(base + position + offset, Math.min(16384, length - offset)), offset);
                            return bytes;
                        } };
                }
            }
            if (stdinSource)
                result = await inspect(stdinSource);
        }
        else {
            const absolute = resolvePath(cwd, path);
            try {
                const capabilities = await fs.capabilitiesFor?.(absolute, io) ?? fs.capabilities;
                const buffered = async () => { const bytes = await fs.readFile(absolute, io); charge(bytes.length); return withImageSource(bytes, fs, signal, inspect); };
                if (capabilities.retainedRead && fs.openReadFile) {
                    let entered = false;
                    try {
                        result = await withImageSource(absolute, fs, signal, source => { entered = true; charge(source.size); return inspect(source); });
                    }
                    catch (error) {
                        if (entered || !(error instanceof FsError) || error.code !== "ENOTSUP")
                            throw error;
                        result = await buffered();
                    }
                }
                else
                    result = await buffered();
            }
            catch (error) {
                if (!missing(error))
                    throw error;
            }
        }
        return result;
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
