import { withImageInputs, type ImageFileInput } from "./image-input.js";
import { readImageMetadataFromSource, tryPdfMetadata, decodeImageToStorage, computeStoredImageStats, readImageMetadata, decodeImage, computeImageStatsSteps, UnsupportedStoredResource, type ImageMetadata, type ImageStats, type ImageByteSource, type StoredRgbaImage, type ImageByteStorage } from "@poe-code/image-ast/portable";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { FsError } from "@poe-code/safe-fs/contracts";
import { drainCooperativeSteps } from "safe-bash-contracts/yield";
export type IdentifyFileInput = ImageFileInput;
export type IdentifyInspection = {
    readonly metadata: ImageMetadata;
    readonly size: number;
    readonly stats?: ImageStats;
    readonly bytes?: Uint8Array;
    readonly formatted?: string;
} | {
    readonly error: unknown;
};
export interface IdentifyRaster {
    readonly image: StoredRgbaImage;
    readonly storage: ImageByteStorage;
}
export type IdentifyFileReader = (path: string, page: number | undefined, verbose: boolean, custom?: (metadata: ImageMetadata, size: number, pixels: () => Promise<IdentifyRaster>) => Promise<string>) => Promise<IdentifyInspection | undefined>;
class ReadFailure extends Error {
    constructor(readonly reason: unknown) { super("Image read failed"); }
}
export async function withIdentifyFiles<T>(input: IdentifyFileInput, stdinBytes: Uint8Array | undefined, signal: AbortSignal, run: (reader: IdentifyFileReader) => Promise<T>): Promise<T> {
    const { filesystem: fs, cwd } = input, io = { signal };
    return withImageInputs(input, stdinBytes, signal, async (load) => {
        const read: IdentifyFileReader = async (path, page, verbose, custom) => {
            const storage = new PagedStorage({ fs, cwd: cwd, env: {}, signal });
            let failed = true;
            try {
                const inspect = async (source: ImageByteSource): Promise<IdentifyInspection> => {
                    const options = page === undefined ? {} : { page }, checked: ImageByteSource = { size: source.size, async read(position, length, options) {
                            try {
                                return await source.read(position, length, options);
                            }
                            catch (error) {
                                throw new ReadFailure(error);
                            }
                        } };
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
                                if (custom)
                                    return { metadata, size: source.size, formatted: await custom(metadata, source.size, async () => ({ image: await decodeImageToStorage(checked, storage, signal, options), storage })) };
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
                const result = await load(path, inspect);
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
        return run(read);
    });
}
