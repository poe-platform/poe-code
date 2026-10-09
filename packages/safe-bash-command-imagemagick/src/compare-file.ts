import { EncodedSnapshots } from "./encoded-snapshots.js";
import { decodeFileImage } from "./image-raster.js";
import { readImageMetadataFromSource, tryPdfMetadata, readImageMetadata, decodeImage, encodeStoredImage, tryImageFile, UnsupportedStoredResource, UnsupportedImageFormat, type ImageMetadata, type SharpInputOptions, type StoredRgbaImage, type RgbaImage, type ImageByteSource, type OutputEncodeOptions } from "@poe-code/image-ast/portable";
import { PagedStorage, PagedStorageCache } from "@poe-code/safe-fs/storage";
import { FsError, type FileSystem } from "@poe-code/safe-fs/contracts";
import { resolvePath } from "safe-bash-contracts/path";
import { writeBytes, type ByteSink } from "safe-bash-contracts/io";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { CommandContext } from "safe-bash-contracts/command";
import { withImageInputs, type ImageFileInput, type ImageInputReader } from "./image-input.js";
export interface CompareFileInput extends ImageFileInput {
    readonly stdout?: ByteSink;
    readonly registerCleanup?: CommandContext["registerCleanup"];
}
export interface CompareFileSession {
    readonly storage: PagedStorage;
    readonly read: ImageInputReader;
    load(path: string, options: (metadata: ImageMetadata | undefined) => SharpInputOptions | Iterable<SharpInputOptions>, visit?: (image: StoredRgbaImage, options: SharpInputOptions, metadata: ImageMetadata | undefined, byteLength: number) => Promise<void>, source?: ImageByteSource | null): Promise<StoredRgbaImage | undefined>;
    retain(image: RgbaImage): Promise<StoredRgbaImage>;
    stage(image: StoredRgbaImage, path: string, encoding: OutputEncodeOptions): Promise<void>;
    publishPending(): Promise<void>;
    publishText(image: StoredRgbaImage, path: string, chunks: AsyncIterable<Uint8Array>): Promise<void>;
    publish(image: StoredRgbaImage, path: string, encoding: OutputEncodeOptions): Promise<Uint8Array | undefined>;
}
export class CompareInputFailure extends Error {
    constructor(readonly reason: unknown) { super("Comparison input failed"); }
}
export async function withCompareFiles<T>(input: CompareFileInput, stdinBytes: Uint8Array | undefined, signal: AbortSignal, run: (session: CompareFileSession) => Promise<T>): Promise<T> {
    const { filesystem: fs, cwd, stdout, registerCleanup } = input, context = { signal, ...(registerCleanup ? { registerCleanup } : {}) }, io = { signal };
    // Coalesce scratch writes into object-sized pages without increasing the 1 MiB working set.
    const storage = new PagedStorage({ fs, cwd, env: {}, signal }, 16, new PagedStorageCache(16, 65536));
    const snapshots = new EncodedSnapshots(storage, signal);
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
        const result = await withImageInputs(input, stdinBytes, signal, async (read) => {
        const publishImage = async (image: StoredRgbaImage, path: string, encoding: OutputEncodeOptions, snapshot?: NonNullable<import("@poe-code/image-ast/portable").StoredImageFileInput["encoded"]>, retire = true): Promise<Uint8Array | undefined> => {
                if (path !== "-" || snapshot) {
                    const output = resolvePath(cwd, path), info = await tryImageFile({ image, storage, ...(snapshot ? { encoded: snapshot } : {}), async close() { if (retire) { await storage.close(); await read.close(); } } }, output, { filesystem: budgetedFs, workingDirectory: cwd, signal }, encoding);
                    if (info)
                        return;
                }
                const encoded = snapshot ? (async function* () {
                    for (let position = 0; position < snapshot.source.size; position += 16384) {
                        await yieldTurn(signal);
                        yield new Uint8Array(await snapshot.source.read(position, Math.min(16384, snapshot.source.size - position), io));
                    }
                })() : encodeStoredImage(image, storage, signal, encoding), chunks: Uint8Array[] = [];
                let size = 0;
                try {
                    for await (const chunk of encoded) {
                        if (path === "-" && !snapshot && stdout)
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
                if (path === "-" && !snapshot && stdout)
                    return;
                const bytes = new Uint8Array(size);
                let offset = 0;
                for (const chunk of chunks) {
                    bytes.set(chunk, offset);
                    offset += chunk.length;
                }
                if (path === "-" && !snapshot)
                    return bytes;
                await writeFileOutput(context, bytes, admitted => fs.writeFile(resolvePath(cwd, path), admitted, io));
            };
        const publishPending = async () => {
            let index = 0;
            for await (const [path, snapshot] of snapshots) await publishImage(snapshot.image, path, snapshot.encoding, snapshot.encoded, ++index === snapshots.size);
            snapshots.clear();
        };
        return run({ storage, retain, read,
            async load(path, options, visit, source) {
                if (source === null) return;
                let entered = false, completed = false;
                try {
                    const consume = async (source: ImageByteSource) => {
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
                            if (error instanceof CompareInputFailure || error instanceof FsError || error instanceof UnsupportedImageFormat)
                                throw error;
                            if (error instanceof UnsupportedStoredResource) {
                                metadata = await tryPdfMetadata(checked, fs, cwd, signal, {}) ?? undefined;
                            }
                        }
                        const configurations = () => {
                            const requested = options(metadata);
                            return (Symbol.iterator in requested ? requested : [requested])[Symbol.iterator]();
                        };
                        let iterator = configurations(), processed = 0, last: StoredRgbaImage | undefined;
                        try {
                            let next = iterator.next();
                            while (!next.done) {
                                await yieldTurn(signal);
                                let configured = next.value, image: StoredRgbaImage;
                                try {
                                    image = bytes ? await retain(decodeImage(bytes, configured)) : await decodeFileImage(checked, storage, fs, cwd, signal, configured);
                                } catch (error) {
                                    if (!(error instanceof UnsupportedStoredResource)) throw error;
                                    bytes ??= await materialize(checked);
                                    if (!metadata) {
                                        try { metadata = readImageMetadata(bytes); } catch { /* Decoder supplies the established diagnostic. */ }
                                        if (metadata) {
                                            iterator.return?.(); iterator = configurations();
                                            for (let skipped = 0; skipped <= processed; skipped++) next = iterator.next();
                                            if (next.done) break;
                                            configured = next.value;
                                        }
                                    }
                                    image = await retain(decodeImage(bytes, configured));
                                }
                                await visit?.(image, configured, metadata, checked.size);
                                last = image; processed++; next = iterator.next();
                            }
                            completed = true;
                            return last;
                        } finally { iterator.return?.(); }

                    };
                    const snapshot = path === "-" ? undefined : await snapshots.get(path);
                    return source ? await consume(source) : snapshot ? await consume(snapshot.encoded.source) : await read(path, consume);
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
            stage: snapshots.stage.bind(snapshots),
            publishPending,
            async publishText(image, path, chunks) {
                const encoded = (async function* () {
                    let size = 0;
                    for await (const chunk of chunks) { size += chunk.length; yield chunk; }
                    return { format: "txt", width: image.width, height: image.height, channels: image.channels, premultiplied: false, size };
                })();
                await snapshots.stage(image, path, { format: "raw" }, encoded);
                await publishPending();
            },
            async publish(image, path, encoding) {
                if (!snapshots.size) return publishImage(image, path, encoding);
                let bytes: Uint8Array | undefined;
                if (path === "-") bytes = await publishImage(image, path, encoding);
                else await snapshots.stage(image, path, encoding);
                await publishPending();
                return bytes;
            }
        });
        });
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
