import { decodeFileImage } from "./image-raster.js";
import { readImageMetadataFromSource, tryPdfMetadata, readImageMetadata, decodeImage, encodeStoredImage, tryImageFile, UnsupportedStoredResource, type ImageMetadata, type SharpInputOptions, type StoredRgbaImage, type RgbaImage, type ImageByteSource, type OutputEncodeOptions } from "@poe-code/image-ast/portable";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { FsError, type FileSystem } from "@poe-code/safe-fs/contracts";
import { resolvePath } from "safe-bash-contracts/path";
import { writeBytes, type ByteSink } from "safe-bash-contracts/io";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { CommandContext } from "safe-bash-contracts/command";
import { withImageInputs, type ImageFileInput } from "./image-input.js";
export interface CompareFileInput extends ImageFileInput {
    readonly stdout?: ByteSink;
    readonly registerCleanup?: CommandContext["registerCleanup"];
}
export interface CompareFileSession {
    readonly storage: PagedStorage;
    load(path: string, options: (metadata: ImageMetadata | undefined) => SharpInputOptions): Promise<StoredRgbaImage | undefined>;
    retain(image: RgbaImage): Promise<StoredRgbaImage>;
    publish(image: StoredRgbaImage, path: string, encoding: OutputEncodeOptions): Promise<Uint8Array | undefined>;
}
export class CompareInputFailure extends Error {
    constructor(readonly reason: unknown) { super("Comparison input failed"); }
}
export async function withCompareFiles<T>(input: CompareFileInput, stdinBytes: Uint8Array | undefined, signal: AbortSignal, run: (session: CompareFileSession) => Promise<T>): Promise<T> {
    const { filesystem: fs, cwd, stdout, registerCleanup } = input, context = { signal, ...(registerCleanup ? { registerCleanup } : {}) }, io = { signal };
    const storage = new PagedStorage({ fs, cwd, env: {}, signal });
    let failed = true;
    const materialize = async (source: ImageByteSource) => { const bytes = new Uint8Array(source.size); for (let offset = 0; offset < source.size; offset += 16384) {
        signal.throwIfAborted();
        bytes.set(await source.read(offset, Math.min(16384, source.size - offset), io), offset);
    } return bytes; };
    const retain = async (image: RgbaImage): Promise<StoredRgbaImage> => { const { data, data16: ignored, ...metadata } = image, position = storage.allocate(data.length); for (let offset = 0; offset < data.length; offset += 16384) {
        if (offset % 1048576 === 0)
            await yieldTurn(signal);
        await storage.write(position + offset, data.subarray(offset, offset + 16384));
    } return { ...metadata, position }; };
    const budgetedFs = new Proxy(fs, { get(target, key) {
            if (key === "publishFileConditional" && target.publishFileConditional)
                return async (path: string, source: AsyncIterable<Uint8Array>, options: Parameters<NonNullable<FileSystem["publishFileConditional"]>>[2]) => target.publishFileConditional!(path, (async function* () { for await (const chunk of source) {
                    let bytes!: Uint8Array;
                    await writeFileOutput(context, chunk, async (admitted) => { bytes = admitted; });
                    yield bytes;
                } })(), options);
            if (key === "createStagedFile" && target.createStagedFile)
                return async (...args: Parameters<NonNullable<FileSystem["createStagedFile"]>>) => { const staged = await target.createStagedFile!(...args), writer = staged.writer; if (!writer)
                    return staged; return { ...staged, writer: { ...writer, write: (bytes: Uint8Array, options?: Parameters<typeof writer.write>[1]) => writeFileOutput(context, bytes, admitted => writer.write(admitted, options)), finish: writer.finish.bind(writer) } }; };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } });
    try {
        const result = await withImageInputs(input, stdinBytes, signal, async (read) => run({ storage, retain,
            async load(path, options) {
                let entered = false, completed = false;
                try {
                    return await read(path, async (source) => {
                        entered = true;
                        const checked: ImageByteSource = { size: source.size, async read(position, length) { try {
                                return await source.read(position, length, io);
                            }
                            catch (error) {
                                throw new CompareInputFailure(error);
                            } } };
                        let bytes: Uint8Array | undefined, metadata: ImageMetadata | undefined;
                        try {
                            metadata = await readImageMetadataFromSource(checked, signal, undefined, storage);
                        }
                        catch (error) {
                            if (error instanceof CompareInputFailure || error instanceof FsError)
                                throw error;
                            if (error instanceof UnsupportedStoredResource) {
                                metadata = await tryPdfMetadata(checked, fs, cwd, signal, {}) ?? undefined;
                            }
                        }
                        const configured = options(metadata);
                        try {
                            const image = await decodeFileImage(checked, storage, fs, cwd, signal, configured);
                            completed = true;
                            return image;
                        }
                        catch (error) {
                            if (!(error instanceof UnsupportedStoredResource))
                                throw error;
                            bytes = await materialize(checked);
                            if (!metadata) {
                                try {
                                    metadata = readImageMetadata(bytes);
                                }
                                catch { /* Decoder supplies the established diagnostic. */ }
                            }
                            const image = await retain(decodeImage(bytes, options(metadata)));
                            completed = true;
                            return image;
                        }
                    });
                }
                catch (error) {
                    signal.throwIfAborted();
                    if (error instanceof CompareInputFailure)
                        throw error;
                    if (!entered || completed || error instanceof FsError)
                        throw new CompareInputFailure(error);
                    if (error instanceof Error && error.message === "Truncated TIFF directory")
                        throw new RangeError("Offset is outside the bounds of the DataView");
                    throw error;
                }
            },
            async publish(image, path, encoding) {
                if (path !== "-") {
                    const output = resolvePath(cwd, path), info = await tryImageFile({ image, storage, async close() { await storage.close(); await read.close(); } }, output, { filesystem: budgetedFs, workingDirectory: cwd, signal }, encoding);
                    if (info)
                        return;
                }
                const encoded = encodeStoredImage(image, storage, signal, encoding), chunks: Uint8Array[] = [];
                let size = 0;
                try {
                    for await (const chunk of encoded) {
                        if (path === "-" && stdout)
                            await writeBytes(stdout, chunk, signal);
                        else {
                            chunks.push(chunk);
                            size += chunk.length;
                        }
                    }
                }
                finally {
                    await encoded.return(undefined);
                }
                if (path === "-" && stdout)
                    return;
                const bytes = new Uint8Array(size);
                let offset = 0;
                for (const chunk of chunks) {
                    bytes.set(chunk, offset);
                    offset += chunk.length;
                }
                if (path === "-")
                    return bytes;
                await writeFileOutput(context, bytes, admitted => fs.writeFile(resolvePath(cwd, path), admitted, io));
            }
        }));
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
}
