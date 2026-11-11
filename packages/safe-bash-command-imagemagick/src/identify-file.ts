import type { rawRasterInput } from "./raw-rgb.js";
import { decodeMagickImage as decodeImage } from "./image-raster.js";
import { storedHistogram } from "./text-output.js";
import { identifyStoredStatistics } from "./identify-statistics.js";
import { identifyStoredHull } from "./identify-hull.js";
import { identifyStoredMoments } from "./identify-moments.js";
import { decodeFileImage } from "./image-raster.js";
import { withImageInputs, type ImageFileInput, type ImageInputReader } from "./image-input.js";
import { readImageMetadataFromSource, tryPdfMetadata, computeStoredImageStats, readImageMetadata, computeImageStatsSteps, UnsupportedStoredResource, UnsupportedImageFormat, type ImageMetadata, type ImageStats, type ImageByteSource, type StoredRgbaImage, type ImageByteStorage } from "@poe-code/image-ast/portable";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { FsError } from "@poe-code/safe-fs/contracts";
import { drainCooperativeSteps } from "safe-bash-contracts/yield";
import type { ByteSink } from "safe-bash-contracts/io";
export interface IdentifyFileInput extends ImageFileInput {
    readonly stdout?: ByteSink;
    readonly stderr?: ByteSink;
}
export type IdentifyInspection = {
    readonly metadata: ImageMetadata;
    readonly size: number;
    readonly stats?: ImageStats;
    readonly histogram?: string;
    readonly statistics?: string;
    readonly bytes?: Uint8Array;
    readonly formatted?: string;
    readonly moments?: string;
    readonly hull?: string;
} | {
    readonly error: unknown;
};
export interface IdentifyRaster {
    readonly image: StoredRgbaImage;
    readonly storage: ImageByteStorage;
}
export type IdentifyFileReader = (path: string, page: number | undefined, verbose: boolean, custom?: (metadata: ImageMetadata, size: number, pixels: () => Promise<IdentifyRaster>) => Promise<string>, hullPrecision?: number, momentsPrecision?: number, statisticsPrecision?: number, rawInput?: (size: number) => ReturnType<typeof rawRasterInput>, transform?: (image: StoredRgbaImage, storage: PagedStorage) => Promise<StoredRgbaImage>) => Promise<IdentifyInspection | undefined>;
class ReadFailure extends Error {
    constructor(readonly reason: unknown) { super("Image read failed"); }
}
export async function withIdentifyFiles<T>(input: IdentifyFileInput, stdinBytes: Uint8Array | undefined, signal: AbortSignal, run: (reader: IdentifyFileReader, load: ImageInputReader) => Promise<T>): Promise<T> {
    const { filesystem: fs, cwd } = input, io = { signal };
    return withImageInputs(input, stdinBytes, signal, async (load) => {
        const read: IdentifyFileReader = async (path, page, verbose, custom, hullPrecision, momentsPrecision, statisticsPrecision, rawInput, transform) => {
            const storage = new PagedStorage({ fs, cwd: cwd, env: {}, signal });
            let failed = true;
            try {
                const inspect = async (source: ImageByteSource): Promise<IdentifyInspection> => {
                    const size = source.size;
                    const options = { coalesce: false, ...(page === undefined || rawInput ? {} : { page }) }, checked: ImageByteSource = { get size() { return source.size; }, async read(position, length, options) {
                            try {
                                return await source.read(position, length, options);
                            }
                            catch (error) {
                                throw new ReadFailure(error);
                            }
                        } };
                    try {
                        if (rawInput) {
                            const original = source, raw = rawInput(size);
                            source = { size: raw.size, async read(position, length) {
                                const steps = raw.read(position, length, page ?? 0);
                                let next = steps.next();
                                while (!next.done) next = steps.next(await original.read(next.value.position, next.value.length, io));
                                return next.value;
                            } };
                        }
                        {
                            try {
                                let metadata: ImageMetadata;
                                try {
                                    const { storedDelay: ignoredDelay, ...result } = await readImageMetadataFromSource(checked, signal, options, storage);
                                    metadata = result;
                                    if (page && ["pbm", "pgm", "ppm", "pam"].includes(metadata.format))
                                        metadata = { ...metadata, format: (await readImageMetadataFromSource(checked, signal, { page: 0 }, storage)).format };
                                }
                                catch (error) {
                                    if (!(error instanceof UnsupportedStoredResource) || error instanceof UnsupportedImageFormat)
                                        throw error;
                                    const pdf = await tryPdfMetadata(checked, fs, cwd, signal, options);
                                    if (!pdf)
                                        throw error;
                                    metadata = pdf;
                                }
                                const transformed = transform ? await transform(await decodeFileImage(checked, storage, fs, cwd, signal, options), storage) : undefined;
                                if (transformed) metadata = { ...transformed, format: metadata.format, ...(metadata.pages === undefined ? {} : { pages: metadata.pages }) };
                                if (custom)
                                    return { metadata, size, formatted: await custom(metadata, size, async () => ({ image: transformed ?? await decodeFileImage(checked, storage, fs, cwd, signal, options), storage })) };
                                const image = verbose ? transformed ?? await decodeFileImage(checked, storage, fs, cwd, signal, options) : undefined;
                                const statistics = image ? await identifyStoredStatistics(image, storage, statisticsPrecision ?? 6, signal) : undefined;
                                const stats = image ? await computeStoredImageStats(image, storage, signal) : undefined;
                                let histogram: string | undefined;
                                if (image) {
                                    histogram = "";
                                    for await (const line of storedHistogram(image, storage, signal)) histogram += line;
                                }
                                const hull = image && hullPrecision !== undefined ? await identifyStoredHull(image, storage, hullPrecision, signal) : undefined;
                                const moments = image && momentsPrecision !== undefined ? await identifyStoredMoments(image, storage, momentsPrecision, signal) : undefined;
                                return { metadata, size, ...(statistics === undefined ? {} : { statistics }), ...(histogram === undefined ? {} : { histogram }), ...(stats ? { stats } : {}), ...(moments === undefined ? {} : { moments }), ...(hull === undefined ? {} : { hull }) };
                            }
                            catch (error) {
                                if (!(error instanceof UnsupportedStoredResource) || error instanceof UnsupportedImageFormat)
                                    throw error;
                            }
                        }
                        const bytes = new Uint8Array(source.size);
                        for (let position = 0; position < source.size; position += 16384) {
                            signal.throwIfAborted();
                            bytes.set(await checked.read(position, Math.min(16384, source.size - position), io), position);
                        }
                        const metadata = readImageMetadata(bytes, options), stats = verbose && !transform ? await drainCooperativeSteps(computeImageStatsSteps(decodeImage(bytes, options)), signal) : undefined;
                        return { metadata, size, bytes, ...(stats ? { stats } : {}) };
                    }
                    catch (error) {
                        signal.throwIfAborted();
                        if (error instanceof ReadFailure)
                            throw error.reason;
                        if (error instanceof FsError)
                            throw error;
                        return { error };
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
        return run(read, load);
    });
}
