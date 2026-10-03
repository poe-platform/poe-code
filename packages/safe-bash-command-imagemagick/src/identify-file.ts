import { withImageSource, readImageMetadataFromSource, tryPdfMetadata, decodeImageToStorage, computeStoredImageStats, readImageMetadata, decodeImage, computeImageStatsSteps, UnsupportedStoredResource, type ImageMetadata, type ImageStats, type ImageByteSource, type StoredRgbaImage, type ImageByteStorage } from "@poe-code/image-ast/portable";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { FsError, type FileSystem } from "@poe-code/safe-fs/contracts";
import { resolvePath } from "safe-bash-contracts/path";
import { readBytes } from "safe-bash-contracts/io";
import { drainCooperativeSteps } from "safe-bash-contracts/yield";
export interface IdentifyFileInput {
    readonly filesystem: FileSystem;
    readonly cwd: string;
    readonly stdin?: AsyncIterable<Uint8Array>;
    readonly inputBudget?: {
        check(bytes: number): void;
    };
}
export type IdentifyInspection = {
    readonly metadata: ImageMetadata;
    readonly size: number;
    readonly stats?: ImageStats;
    readonly bytes?: Uint8Array;
    readonly formatted?: string;
} | {
    readonly error: unknown;
};
export interface IdentifyRaster { readonly image: StoredRgbaImage; readonly storage: ImageByteStorage; }
export type IdentifyFileReader = (path: string, page: number | undefined, verbose: boolean, custom?: (metadata: ImageMetadata, size: number, pixels:()=>Promise<IdentifyRaster>) => Promise<string>) => Promise<IdentifyInspection | undefined>;
class ReadFailure extends Error {
    constructor(readonly reason: unknown) { super("Image read failed"); }
}
const missing = (error: unknown) => error instanceof FsError && ["ENOENT", "ENOTDIR", "EISDIR", "EACCES", "EPERM"].includes(error.code);
export async function withIdentifyFiles<T>(input: IdentifyFileInput, stdinBytes: Uint8Array | undefined, signal: AbortSignal, run: (reader: IdentifyFileReader) => Promise<T>): Promise<T> {
    const { filesystem: fs, cwd, stdin, inputBudget } = input, io = { signal };
    let total = 0, failed = true, stdinSource: ImageByteSource | undefined, stdinStorage: PagedStorage | undefined;
    const charge = (size: number) => { total += size; inputBudget?.check(total); };
    const read: IdentifyFileReader = async (path, page, verbose, custom) => {
        const storage = new PagedStorage({ fs, cwd: cwd, env: {}, signal });
        let failed = true;
        try {
            const inspect = async (source: ImageByteSource): Promise<IdentifyInspection> => {
                const options = page === undefined ? {} : { page }, checked: ImageByteSource = { size: source.size, async read(position, length, options) { try {
                        return await source.read(position, length, options);
                    }
                    catch (error) {
                        throw new ReadFailure(error);
                    } } };
                try {
                    {
                        try {
                            let metadata: ImageMetadata;
                            try {
                                const { storedDelay: ignoredDelay, ...result } = await readImageMetadataFromSource(checked, signal, options, storage);
                                metadata = result;
                            }
                            catch (error) {
                                if (!(error instanceof UnsupportedStoredResource))
                                    throw error;
                                const pdf = await tryPdfMetadata(checked, fs, cwd, signal, options);
                                if (!pdf)
                                    throw error;
                                metadata = pdf;
                            }
                            if(custom) return {metadata,size:source.size,formatted:await custom(metadata,source.size,async()=>({image:await decodeImageToStorage(checked,storage,signal,options),storage}))};
                            const stats = verbose ? await computeStoredImageStats(await decodeImageToStorage(checked, storage, signal, options), storage, signal) : undefined;
                            return { metadata, size: source.size, ...(stats ? { stats } : {}) };
                        }
                        catch (error) {
                            if (!(error instanceof UnsupportedStoredResource))
                                throw error;
                        }
                    }
                    const bytes = new Uint8Array(source.size);
                    for (let position = 0; position < source.size; position += 16384) {
                        signal.throwIfAborted();
                        bytes.set(await checked.read(position, Math.min(16384, source.size - position), io), position);
                    }
                    const metadata = readImageMetadata(bytes, options), stats = verbose ? await drainCooperativeSteps(computeImageStatsSteps(decodeImage(bytes, options)), signal) : undefined;
                    return { metadata, size: source.size, bytes, ...(stats ? { stats } : {}) };
                }
                catch (error) {
                    signal.throwIfAborted();
                    if (error instanceof ReadFailure)
                        throw error.reason;
                    if (error instanceof FsError)
                        throw error;
                    return { error: error instanceof Error && error.message === "Truncated TIFF directory" ? new RangeError("Offset is outside the bounds of the DataView") : error };
                }
            };
            let result: IdentifyInspection | undefined;
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
                        stdinSource = { size, read: (position, length) => backing.read(base + position, length) };
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
            failed = false;
            return result;
        }
        finally {
            try {
                await storage.close();
            }
            catch (error) {
                if (!failed)
                    await Promise.reject(error);
            }
        }
    };
    try {
        const result = await run(read);
        failed = false;
        return result;
    }
    finally {
        try {
            await stdinStorage?.close();
        }
        catch (error) {
            if (!failed)
                await Promise.reject(error);
        }
    }
}
