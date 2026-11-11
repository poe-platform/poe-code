import { createMiffBzip } from "./miff-bzip.js";
import type { OutputEncodeOptions, RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { createByteCodec, defaultRuntime } from "@poe-code/compression";

export function miffChannels(image: Pick<RgbaImage, "space" | "hasAlpha">): 1 | 2 | 3 | 4 | 5 {
    return image.space === "cmyk" ? image.hasAlpha ? 5 : 4 : image.space === "b-w" || image.space === "grey16" ? image.hasAlpha ? 2 : 1 : image.hasAlpha ? 4 : 3;
}

function miffPixels(bytes: Uint8Array, channels: number, sampleBytes: number, compression: OutputEncodeOptions["miffCompression"], meta: readonly Uint8Array[], inks?: Float64Array): Uint8Array {
    const pixels = new Uint8Array(bytes.length / 4 * (channels + meta.length));
    const view = new DataView(pixels.buffer);
    let output = 0;
    for (let offset = 0; offset < bytes.length; offset += 4 * sampleBytes) {
        const colors = inks ? 4 : channels <= 2 ? 1 : 3;
        if (inks) for (let channel = 0; channel < 4; channel++) {
            const value = Math.round(Math.max(0, Math.min(1, inks[offset / sampleBytes + channel]!)) * (sampleBytes === 2 ? 65535 : 255));
            if (sampleBytes === 2) view.setUint16(output + channel * 2, value);
            else pixels[output + channel] = value;
        }
        else pixels.set(bytes.subarray(offset, offset + colors * sampleBytes), output);
        output += colors * sampleBytes;
        if (channels > colors) {
            pixels.set(bytes.subarray(offset + 3 * sampleBytes, offset + 4 * sampleBytes), output);
            output += sampleBytes;
        }
        for (const plane of meta) {
            pixels.set(plane.subarray(offset, offset + sampleBytes), output);
            output += sampleBytes;
        }
    }
    if (compression !== "rle") return pixels;
    const stride = (channels + meta.length) * sampleBytes;
    const encoded = new Uint8Array(pixels.length + pixels.length / stride);
    let length = 0;
    for (let offset = 0; offset < pixels.length;) {
        let count = 1;
        while (count < 256 && offset + count * stride < pixels.length) {
            let equal = true;
            for (let channel = 0; channel < stride; channel++) {
                if (pixels[offset + channel] !== pixels[offset + count * stride + channel]) { equal = false; break; }
            }
            if (!equal) break;
            count++;
        }
        encoded.set(pixels.subarray(offset, offset + stride), length);
        encoded[length + stride] = count - 1;
        length += stride + 1;
        offset += count * stride;
    }
    return encoded.subarray(0, length);
}

function miffHeader(image: Pick<RgbaImage, "renderingIntent" | "chromaticity" | "properties" | "width" | "height" | "space" | "hasAlpha" | "virtualCanvas" | "resolution" | "magickUnits" | "density" | "disposal" | "loop" | "delayTicks" | "ticksPerSecond"> & { magickColorspace?: string }, depth: 8 | 16, compression: OutputEncodeOptions["miffCompression"], delay: number | undefined, loop: number | undefined, metaCount: number): Uint8Array {
    const { width, height } = image;
    const page = image.virtualCanvas ?? { width, height, x: 0, y: 0 };
    let properties = "";
    for (const key of ["comment", "label"] as const) {
        const value = image.properties?.[key];
        if (value !== undefined) properties += `${key}={${value.replaceAll("\\", "\\\\").replaceAll("{", "\\{").replaceAll("}", "\\}")}}\n`;
    }
    const renderingIntent = ["Saturation", "Perceptual", "Relative", "Absolute"].find(intent => intent.toLowerCase() === image.renderingIntent?.toLowerCase());
    if (renderingIntent) properties += `rendering-intent=${renderingIntent}\n`;
    let chromaticity = "";
    const defaults = { "red-primary": [0.64, 0.33], "green-primary": [0.3, 0.6], "blue-primary": [0.15, 0.06], "white-point": [0.3127, 0.329] };
    for (const key of ["red-primary", "green-primary", "blue-primary", "white-point"] as const) {
        const pair = image.chromaticity?.[key] ?? defaults[key];
        chromaticity += `${key}=${pair[0]},${pair[1]}\n`;
    }
    const resolution = image.resolution;
    const scale = resolution?.unit === "meter" ? 100 : 1;
    const x = Number((resolution ? resolution.x / scale : image.density).toPrecision(6));
    const y = Number((resolution ? resolution.y / scale : image.density).toPrecision(6));
    const unit = resolution?.unit ?? image.magickUnits;
    const units = unit === "inch" ? "PixelsPerInch" : unit === "cm" || unit === "meter" ? "PixelsPerCentimeter" : "Undefined";
    const density = resolution ? `resolution=${x}x${y}\n` : "";
    const ticksPerSecond = image.ticksPerSecond ?? 100;
    const delayTicks = image.delayTicks ?? (image.ticksPerSecond === undefined ? Math.floor((delay ?? 0) / 10) : Math.round((delay ?? 0) * ticksPerSecond / 1000));
    const animation = `delay=${delayTicks}\nticks-per-second=${ticksPerSecond}\niterations=${loop ?? image.loop ?? 0}\ndispose=${["Undefined", "None", "Background", "Previous"][typeof image.disposal === "number" ? image.disposal : image.disposal?.[0] ?? 0] ?? "Undefined"}\n`;
    const geometry = page.width || page.height || page.x || page.y ? `page=${page.width}x${page.height}${page.x < 0 ? "" : "+"}${page.x}${page.y < 0 ? "" : "+"}${page.y}\n` : "";
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 || !Number.isSafeInteger(width * height * 4)) throw new RangeError("Invalid MIFF dimensions");
    const channels = metaCount ? `number-channels=${miffChannels(image) + metaCount} number-meta-channels=${metaCount}\n` : "";
    return new TextEncoder().encode(`id=ImageMagick version=1.0\nclass=DirectClass colors=0 matte=${image.hasAlpha ? "True" : "False"}\n${channels}columns=${width} rows=${height} depth=${depth}\n${geometry}${properties}${chromaticity}${animation}${density}units=${units}\ncolorspace=${image.space === "cmyk" ? "CMYK" : miffChannels(image) <= 2 ? "Gray" : image.magickColorspace ?? "sRGB"}\ncompression=${compression === "zip" ? "Zip" : compression === "bzip" ? "BZip" : compression === "rle" ? "RLE" : "None"}\n\f\n:\x1a`);
}

export function encodeMiffImage(image: RgbaImage, requestedDepth?: 8 | 16, requestedCompression?: OutputEncodeOptions["miffCompression"], loop?: number): Uint8Array {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (const page of image.miffPages ?? [image]) {
        const depth = requestedDepth ?? (page.depth === "ushort" ? 16 : 8);
        const meta = page.metaChannels ?? [], channels = miffChannels(page);
        // Native MIFF RLE packets only carry color and alpha, so retain extra samples uncompressed.
        const compression = meta.length && requestedCompression === "rle" ? "none" : requestedCompression;
        const header = miffHeader(page, depth, compression, page.delay?.[0], loop ?? image.loop, meta.length), size = page.width * page.height * 4;
        const planes = [page, ...meta].map(plane => {
            if (plane.width !== page.width || plane.height !== page.height || plane.data.length !== size || plane.data16 && plane.data16.length !== size) throw new Error("Invalid MIFF pixels");
            if (depth === 8) return plane.data;
            const pixels = new Uint8Array(size * 2), view = new DataView(pixels.buffer);
            for (let index = 0; index < size; index++) view.setUint16(index * 2, plane.data16?.[index] ?? plane.data[index]! * 257);
            return pixels;
        });
        const inks = page.space === "cmyk" ? page.hueSamples : undefined;
        if (page.space === "cmyk" && inks?.length !== size) throw new Error("Invalid MIFF CMYK samples");
        const packed = miffPixels(planes[0]!, channels, depth / 8, compression, planes.slice(1), inks);
        chunks.push(header);
        length += header.length;
        const compressor = compression === "zip" || compression === "bzip" ? createMiffCompressor(page.width * (channels + meta.length) * (depth / 8), compression) : undefined;
        try {
            for (const chunk of compressor ? compressor.push(packed, true) : [packed]) {
                chunks.push(chunk);
                length += chunk.length;
            }
        } finally { compressor?.close(); }
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
}

export async function* encodeMiffFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal, requestedDepth?: 8 | 16, requestedCompression?: OutputEncodeOptions["miffCompression"], loop?: number): AsyncGenerator<Uint8Array> {
    for (let index = 0; index < (image.storedMiffPages?.length ?? 1); index++) {
        signal.throwIfAborted();
        const page = image.storedMiffPages ? await image.storedMiffPages.at(index) : image;
        signal.throwIfAborted();
        const depth = requestedDepth ?? (page.depth === "ushort" ? 16 : 8);
        const meta = page.storedMetaChannels ?? [], channels = miffChannels(page);
        const compression = meta.length && requestedCompression === "rle" ? "none" : requestedCompression;
        const length = page.width * page.height * 4;
        for (const plane of [page, ...meta]) {
            if (plane.width !== page.width || plane.height !== page.height || plane.storedData16 && plane.storedData16.length !== length) throw new Error("Invalid MIFF pixels");
        }
        yield miffHeader(page, depth, compression, await page.storedDelay?.at(0, { signal }) ?? page.delay?.[0], loop ?? image.loop, meta.length);
        const compressor = compression === "zip" || compression === "bzip" ? createMiffCompressor(page.width * (channels + meta.length) * (depth / 8), compression) : undefined;
        try {
            const chunkSize = page.space === "cmyk" ? 2048 : 4096;
            for (let offset = 0; offset < length; offset += chunkSize) {
                signal.throwIfAborted();
                if (offset % 65536 === 0) await defaultRuntime.yieldTurn(signal);
                const size = Math.min(chunkSize, length - offset), planes: Uint8Array[] = [];
                for (const plane of [page, ...meta]) {
                    const source16 = depth === 16 ? plane.storedData16 : undefined;
                    const bytes = await storage.read((source16?.position ?? plane.position) + offset * (source16 ? 2 : 1), size * (source16 ? 2 : 1), { signal });
                    signal.throwIfAborted();
                    if (bytes.length !== size * (source16 ? 2 : 1)) throw new Error("Truncated MIFF backing storage");
                    if (depth === 8) planes.push(new Uint8Array(bytes));
                    else {
                        const pixels = new Uint8Array(size * 2), view = new DataView(pixels.buffer);
                        const samples = source16 ? new Uint16Array(new Uint8Array(bytes).buffer) : undefined;
                        for (let index = 0; index < size; index++) view.setUint16(index * 2, samples?.[index] ?? bytes[index]! * 257);
                        planes.push(pixels);
                    }
                }
                let inks: Float64Array | undefined;
                if (page.space === "cmyk") {
                    if (page.storedHueSamples === undefined) throw new Error("Invalid MIFF CMYK samples");
                    const bytes = await storage.read(page.storedHueSamples + offset * 8, size * 8, { signal });
                    signal.throwIfAborted();
                    if (bytes.length !== size * 8) throw new Error("Truncated MIFF CMYK samples");
                    inks = new Float64Array(new Uint8Array(bytes).buffer);
                }
                const packed = miffPixels(planes[0]!, channels, depth / 8, compression, planes.slice(1), inks);
                for (const chunk of compressor ? compressor.push(packed, offset + size === length) : [packed]) {
                    signal.throwIfAborted();
                    yield chunk;
                }
            }
        } finally { compressor?.close(); }
    }
}

function miffCompressedChunk(chunk: Uint8Array): Uint8Array {
    const bytes = new Uint8Array(4 + chunk.length);
    new DataView(bytes.buffer).setUint32(0, chunk.length);
    bytes.set(chunk, 4);
    return bytes;
}

function createMiffCompressor(rowBytes: number, compression: "zip" | "bzip") {
    // Native readers bound packets by row size and stop after the last pixel.
    // Keep the final two chunks together so the stream trailer stays in that packet.
    const chunkSize = Math.min(4096, Math.floor((rowBytes + 600) / 2));
    const codec = compression === "bzip" ? createMiffBzip(chunkSize) : createByteCodec({ direction: "encode", format: "zlib", chunkSize });
    const pending: Uint8Array[] = [];
    return {
        close: codec.close,
        *push(input: Uint8Array, final: boolean): Generator<Uint8Array> {
            for (const chunk of codec.push(input, final)) {
                pending.push(chunk);
                if (pending.length > 2) yield miffCompressedChunk(pending.shift()!);
            }
            if (final) {
                const bytes = new Uint8Array(pending.reduce((size, chunk) => size + chunk.length, 0));
                let offset = 0;
                for (const chunk of pending) { bytes.set(chunk, offset); offset += chunk.length; }
                pending.length = 0;
                yield miffCompressedChunk(bytes);
            }
        }
    };
}
