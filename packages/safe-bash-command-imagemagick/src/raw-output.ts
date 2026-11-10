import { encodeImage as encodeRaster, encodeStoredImage as encodeStoredRaster, type ImageFormat as RasterFormat, type OutputEncodeOptions as RasterOptions, type RgbaImage, type StoredRgbaImage, type ImageByteStorage, type OutputInfo } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";
import { rgbToCmyk } from "./colorspace-cmyk.js";

export type RawImage = RgbaImage & { rawFrames?: readonly RgbaImage[] };
export type StoredRawImage = StoredRgbaImage & { rawFrames?: { length: number; at(index: number): Promise<StoredRgbaImage> } };

export type RawCoder = "rgb" | "rgba" | "rgbo" | "bgr" | "bgra" | "bgro" | "gray" | "graya" | "cmyk" | "cmyka";
export type ImageFormat = RasterFormat | RawCoder;
export type OutputEncodeOptions = Omit<RasterOptions, "format"> & { format: ImageFormat; rawInterlace?: "line" | "plane" | "partition" | undefined; endian?: string | undefined; jpegExtent?: number | undefined; webpTargetSize?: number | undefined; webpPass?: number | undefined };

/** Search complete output sizes, including alpha and container overhead. */
function* webpTargetQualities(options: OutputEncodeOptions): Generator<number, number, number> {
    let low = 0, high = 100, quality = Math.round(options.quality ?? 80);
    let best = quality, distance = Infinity;
    for (let pass = 0; pass < (options.webpPass ?? 6) && low <= high; pass++) {
        const size = yield quality;
        const error = Math.abs(size - options.webpTargetSize!);
        if (error < distance) { best = quality; distance = error; }
        if (error === 0) break;
        if (size < options.webpTargetSize!) low = quality + 1;
        else high = quality - 1;
        // Check the reachable endpoint before spending passes bisecting the range.
        quality = pass === 0 ? (size < options.webpTargetSize! ? 100 : 0) : Math.floor((low + high) / 2);
    }
    return best;
}
export function isRawCoder(format: string | undefined): format is RawCoder {
    return format === "rgbo" || format === "bgro" || format === "rgb" || format === "rgba" || format === "bgr" || format === "bgra" || format === "gray" || format === "graya" || format === "cmyk" || format === "cmyka";
}

export function encodeImage(image: RawImage, options: OutputEncodeOptions): ReturnType<typeof encodeRaster> {
    if (options.format === "pam") options = { ...options, netpbmDepth: options.netpbmDepth ?? image.bitsPerSample ?? (image.depth === "ushort" ? 16 : 8) };
    const format = options.format;
    if (!isRawCoder(format)) {
        if (format === "webp" && options.lossless === false && (options.webpTargetSize ?? 0) > 0) {
            const search = webpTargetQualities(options);
            let next = search.next();
            while (!next.done) {
                const quality = next.value;
                const encoded = encodeRaster(image, { ...options, format, quality, synthesizeExif: false });
                next = search.next(encoded.data.length);
                if (next.done && next.value === quality) return encoded;
            }
            return encodeRaster(image, { ...options, format, quality: next.value, synthesizeExif: false });
        }
        let encoded = encodeRaster(image, { ...options, format, synthesizeExif: false });
        if (format === "jpeg" && options.jpegExtent !== undefined && encoded.data.length > options.jpegExtent) {
            let low = 1, high = Math.floor(options.quality ?? 92) - 1;
            let best: typeof encoded | undefined;
            while (low <= high) {
                const quality = Math.floor((low + high) / 2);
                encoded = encodeRaster(image, { ...options, format, quality, chromaSubsampling: quality < 90 ? "4:2:0" : "4:4:4", synthesizeExif: false });
                if (encoded.data.length <= options.jpegExtent) { best = encoded; low = quality + 1; }
                else high = quality - 1;
            }
            return best ?? encoded;
        }
        return encoded;
    }
    // Native RGBO adds zero opacity only to packed and Line output; BGRO has three channels.
    const channels = (format.startsWith("gray") ? 1 : format.startsWith("cmyk") ? 4 : 3) + (format.endsWith("a") || (format === "rgbo" && options.rawInterlace !== "plane" && options.rawInterlace !== "partition") ? 1 : 0);
    const selectedChannels = Array.from({ length: channels }, (_, channel) => channel);
    if (!image.rawFrames) return { data: encodeRawPixels(image, options, selectedChannels), format: "raw", channels };
    const frames = options.rawInterlace === "partition"
        ? selectedChannels.flatMap(channel => image.rawFrames!.map(frame => encodeRawPixels(frame, options, [channel])))
        : image.rawFrames.map(frame => encodeRawPixels(frame, options, selectedChannels));
    const data = new Uint8Array(frames.reduce((size, frame) => size + frame.length, 0));
    let offset = 0;
    for (const frame of frames) { data.set(frame, offset); offset += frame.length; }
    return { data, format: "raw", channels };
}

function encodeRawPixels(image: RgbaImage, options: OutputEncodeOptions, channels: readonly number[]): Uint8Array {
    const format = options.format;
    const requestedDepth = options.netpbmDepth ?? image.bitsPerSample ?? (image.depth === "ushort" ? 16 : 8);
    const depth = options.tiffFloatDepth ?? (requestedDepth === 1 || requestedDepth === 2 || requestedDepth === 4 || requestedDepth === 10 || requestedDepth === 12 ? requestedDepth : requestedDepth > 8 ? 16 : 8);
    const pixels = image.width * image.height;
    const rowSamples = image.width * (options.rawInterlace ? 1 : channels.length);
    const rowBytes = Math.ceil(rowSamples * depth / 8);
    const data = new Uint8Array(rowBytes * image.height * (options.rawInterlace ? channels.length : 1));
    const working = format === "gray" && (depth === 10 || depth === 12) ? image.evaluateSamples : undefined;
    const view = new DataView(data.buffer), samples = working ?? image.data16 ?? image.data;
    const scale = !working && image.data16 ? 65535 : 255, maximum = 2 ** depth - 1;
    for (let pixel = 0; pixel < pixels; pixel++) {
        const inks = format.startsWith("cmyk") ? image.space === "cmyk" && image.hueSamples
            ? image.hueSamples.subarray(pixel * 4, pixel * 4 + 4)
            : rgbToCmyk(samples[pixel * 4]! / scale, samples[pixel * 4 + 1]! / scale, samples[pixel * 4 + 2]! / scale) : undefined;
        for (let c = 0; c < channels.length; c++) {
            const channel = channels[c]!;
            // Native BGR/BGRA Plane output uses RGB order, unlike packed and Line output.
            const index = format === "graya" && channel === 1 ? 3 : format.startsWith("bgr") && options.rawInterlace !== "plane" && channel < 3 ? 2 - channel : channel;
            const value = inks
                ? channel < 4 ? Math.max(0, Math.min(1, inks[channel]!)) * scale : image.hasAlpha ? samples[pixel * 4 + 3]! : scale
                : format.startsWith("gray") && channel === 0
                ? 0.212656 * samples[pixel * 4]! + 0.715158 * samples[pixel * 4 + 1]! + 0.072186 * samples[pixel * 4 + 2]!
                : format === "rgbo" && channel === 3 ? 0 : index === 3 && !image.hasAlpha ? scale : samples[pixel * 4 + index]!;
            const quantum = Math.round(value * maximum / scale);
            const sample = (options.rawInterlace === "plane" || options.rawInterlace === "partition") ? c * pixels + pixel
                : options.rawInterlace === "line" ? Math.floor(pixel / image.width) * image.width * channels.length + c * image.width + pixel % image.width
                : pixel * channels.length + c;
            const rowBit = (sample % rowSamples) * depth;
            const offset = Math.floor(sample / rowSamples) * rowBytes + Math.floor(rowBit / 8);
            const little = options.endian === undefined || options.endian === "lsb";
            if (options.tiffFloatDepth) {
                // ImageMagick scales Q16 samples by the reciprocal quantum range.
                const normalized = value * (65535 / scale) * (1 / 65535);
                if (depth === 64) view.setFloat64(offset, normalized, little);
                else if (depth === 32) view.setFloat32(offset, normalized, little);
                else {
                    const exponent = Math.floor(Math.log2(normalized));
                    const half = normalized < 2 ** -14 ? Math.round(normalized * 2 ** 24)
                        : (exponent + 15) * 1024 + Math.round((normalized / 2 ** exponent - 1) * 1024);
                    view.setUint16(offset, half, little);
                }
            } else if (depth < 8) data[offset] = data[offset]! | (quantum << (8 - depth - rowBit % 8));
            else if (depth === 10 || depth === 12) {
                // Packed raw samples are MSB-first; zero padding ends each row.
                const packed = quantum << (24 - depth - rowBit % 8);
                data[offset] = data[offset]! | (packed >>> 16);
                data[offset + 1] = data[offset + 1]! | ((packed >>> 8) & 255);
            }
            else if (depth === 16) view.setUint16(offset, quantum, little);
            else data[offset] = quantum;
        }
    }
    return data;
}

export async function* encodeStoredImage(image: StoredRawImage, storage: ImageByteStorage, signal: AbortSignal, options: OutputEncodeOptions): ReturnType<typeof encodeStoredRaster> {
    if (options.format === "pam") options = { ...options, netpbmDepth: options.netpbmDepth ?? image.bitsPerSample ?? (image.depth === "ushort" ? 16 : 8) };
    if (!isRawCoder(options.format)) {
        let quality = options.quality ?? 92;
        if (options.format === "webp" && options.lossless === false && (options.webpTargetSize ?? 0) > 0) {
            const search = webpTargetQualities(options);
            let next = search.next();
            while (!next.done) {
                let size = 0;
                for await (const chunk of encodeStoredRaster(image, storage, signal, { ...options, format: "webp", quality: next.value, synthesizeExif: false })) size += chunk.length;
                next = search.next(size);
            }
            return yield* encodeStoredRaster(image, storage, signal, { ...options, format: "webp", quality: next.value, synthesizeExif: false });
        }
        if (options.format === "jpeg" && options.jpegExtent !== undefined) {
            let low = 1, high = Math.floor(quality), best = 1;
            while (low <= high) {
                const trial = quality;
                let size = 0;
                for await (const chunk of encodeStoredRaster(image, storage, signal, { ...options, format: "jpeg", quality: trial, chromaSubsampling: trial < 90 ? "4:2:0" : "4:4:4", synthesizeExif: false })) size += chunk.length;
                if (size <= options.jpegExtent) { best = trial; low = trial + 1; }
                else high = trial - 1;
                quality = Math.floor((low + high) / 2);
            }
            quality = best;
        }
        return yield* encodeStoredRaster(image, storage, signal, { ...options, format: options.format, ...(options.format === "jpeg" && options.jpegExtent !== undefined ? { quality, chromaSubsampling: quality < 90 ? "4:2:0" : "4:4:4" } : {}), synthesizeExif: false });
    }
    if (image.rawFrames && options.rawInterlace !== "partition") {
        let size = 0;
        let info: OutputInfo | undefined;
        for (let index = 0; index < image.rawFrames.length; index++) {
            await yieldTurn(signal);
            info = yield* encodeStoredImage(await image.rawFrames.at(index), storage, signal, options);
            size += info!.size;
        }
        return { ...info!, size };
    }
    let size = 0;
    const channels = (options.format.startsWith("gray") ? 1 : options.format.startsWith("cmyk") ? 4 : 3) + (options.format.endsWith("a") || (options.format === "rgbo" && options.rawInterlace !== "plane" && options.rawInterlace !== "partition") ? 1 : 0);
    const packedChannels = Array.from({ length: channels }, (_, channel) => channel);
    const rawFrames = image.rawFrames;
    for (let plane = 0; plane < (rawFrames ? channels : 1); plane++) {
        for (let frame = 0; frame < (rawFrames?.length ?? 1); frame++) {
            if (rawFrames) image = await rawFrames.at(frame);
            const cmyk = options.format.startsWith("cmyk") && image.space === "cmyk";
            const pixels = image.width * image.height;
            const depth = options.tiffFloatDepth ?? options.netpbmDepth ?? image.bitsPerSample ?? (image.depth === "ushort" ? 16 : 8);
            const packed = depth === 1 || depth === 2 || depth === 4 || depth === 10 || depth === 12;
            const workingPosition = options.format === "gray" && (depth === 10 || depth === 12) ? image.storedEvaluateSamples : undefined;
            const chunkPixels = cmyk || workingPosition !== undefined ? 512 : image.storedData16 ? 2048 : 4096;
            const spanPixels = options.rawInterlace === "line" ? image.width : pixels;
            // Finish each row/channel run before advancing, even when it spans several reads.
            for (let start = 0; start < pixels; start += spanPixels) {
                for (let channel = rawFrames ? plane : 0; channel < (rawFrames ? plane + 1 : options.rawInterlace ? channels : 1); channel++) {
                    for (let pixel = start; pixel < start + spanPixels;) {
                        await yieldTurn(signal);
                        // Chunk sizes are byte-aligned; only the last chunk of a packed row adds padding.
                        const count = Math.min(chunkPixels, start + spanPixels - pixel, packed ? image.width - pixel % image.width : Infinity);
                        const data = new Uint8Array(await storage.read(image.position + pixel * 4, count * 4, { signal }));
                        if (data.length !== count * 4) throw new Error("Truncated raw pixel storage");
                        let data16: Uint16Array | undefined;
                        if (image.storedData16) {
                            const bytes = await storage.read(image.storedData16.position + pixel * 8, count * 8, { signal });
                            if (bytes.length !== count * 8) throw new Error("Truncated raw sample storage");
                            data16 = new Uint16Array(new Uint8Array(bytes).buffer);
                        }
                        let hueSamples: Float64Array | undefined;
                        if (cmyk && image.storedHueSamples !== undefined) {
                            const bytes = await storage.read(image.storedHueSamples + pixel * 32, count * 32, { signal });
                            if (bytes.length !== count * 32) throw new Error("Truncated raw ink storage");
                            hueSamples = new Float64Array(new Uint8Array(bytes).buffer);
                        }
                        let evaluateSamples: Float64Array | undefined;
                        if (workingPosition !== undefined) {
                            const bytes = await storage.read(workingPosition + pixel * 32, count * 32, { signal });
                            if (bytes.length !== count * 32) throw new Error("Truncated raw working sample storage");
                            evaluateSamples = new Float64Array(new Uint8Array(bytes).buffer);
                        }
                        const encoded = encodeRawPixels({ ...image, width: count, height: 1, data, ...(data16 ? { data16 } : {}), ...(hueSamples ? { hueSamples } : {}), ...(evaluateSamples ? { evaluateSamples } : {}) }, options, options.rawInterlace ? [channel] : packedChannels);
                        size += encoded.length;
                        pixel += count;
                        yield encoded;
                    }
                }
            }
        }
    }
    return { format: "raw", width: image.width, height: image.height, channels, premultiplied: false, size };
}
