import { createMiffBzip } from "./miff-bzip.js";
import type { OutputEncodeOptions, RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { createByteCodec, defaultRuntime } from "@poe-code/compression";

export function miffChannels(image: Pick<RgbaImage, "space" | "hasAlpha">): 1 | 2 | 3 | 4 {
    return image.space === "b-w" || image.space === "grey16" ? image.hasAlpha ? 2 : 1 : image.hasAlpha ? 4 : 3;
}

function miffPixels(bytes: Uint8Array, channels: number, sampleBytes: number, compression?: OutputEncodeOptions["miffCompression"]): Uint8Array {
    const pixels = new Uint8Array(bytes.length / 4 * channels);
    let output = 0;
    for (let offset = 0; offset < bytes.length; offset += 4 * sampleBytes) {
        const colors = channels <= 2 ? 1 : 3;
        pixels.set(bytes.subarray(offset, offset + colors * sampleBytes), output);
        output += colors * sampleBytes;
        if (channels === 2 || channels === 4) {
            pixels.set(bytes.subarray(offset + 3 * sampleBytes, offset + 4 * sampleBytes), output);
            output += sampleBytes;
        }
    }
    if (compression !== "rle") return pixels;
    const stride = channels * sampleBytes;
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

function miffHeader(image: Pick<RgbaImage, "renderingIntent" | "chromaticity" | "properties" | "width" | "height" | "space" | "hasAlpha" | "virtualCanvas" | "resolution" | "density" | "disposal" | "loop" | "delayTicks" | "ticksPerSecond"> & { magickColorspace?: string }, depth: 8 | 16, compression: OutputEncodeOptions["miffCompression"], delay: number | undefined, loop: number | undefined): Uint8Array {
    const { width, height, virtualCanvas: page } = image;
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
    const x = resolution ? resolution.x / scale : image.density;
    const y = resolution ? resolution.y / scale : image.density;
    const units = resolution?.unit === "inch" ? "PixelsPerInch" : resolution?.unit === "cm" || resolution?.unit === "meter" ? "PixelsPerCentimeter" : "Undefined";
    const ticksPerSecond = image.ticksPerSecond ?? 100;
    const delayTicks = image.delayTicks ?? (image.ticksPerSecond === undefined ? Math.floor((delay ?? 0) / 10) : Math.round((delay ?? 0) * ticksPerSecond / 1000));
    const animation = `delay=${delayTicks}\nticks-per-second=${ticksPerSecond}\niterations=${loop ?? image.loop ?? 0}\ndispose=${["Undefined", "None", "Background", "Previous"][typeof image.disposal === "number" ? image.disposal : image.disposal?.[0] ?? 0] ?? "Undefined"}\n`;
    const geometry = page ? `page=${page.width}x${page.height}${page.x < 0 ? "" : "+"}${page.x}${page.y < 0 ? "" : "+"}${page.y}\n` : "";
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 || !Number.isSafeInteger(width * height * 4)) throw new RangeError("Invalid MIFF dimensions");
    return new TextEncoder().encode(`id=ImageMagick version=1.0\nclass=DirectClass colors=0 matte=${image.hasAlpha ? "True" : "False"}\ncolumns=${width} rows=${height} depth=${depth}\n${geometry}${properties}${chromaticity}${animation}resolution=${x}x${y}\nunits=${units}\ncolorspace=${miffChannels(image) <= 2 ? "Gray" : image.magickColorspace === "RGB" ? "RGB" : "sRGB"}\ncompression=${compression === "zip" ? "Zip" : compression === "bzip" ? "BZip" : compression === "rle" ? "RLE" : "None"}\n\f\n:\x1a`);
}

export function encodeMiffImage(image: RgbaImage, requestedDepth?: 8 | 16, compression?: OutputEncodeOptions["miffCompression"], loop?: number): Uint8Array {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (const page of image.miffPages ?? [image]) {
        const depth = requestedDepth ?? (page.depth === "ushort" ? 16 : 8);
        const header = miffHeader(page, depth, compression, page.delay?.[0], loop ?? image.loop), size = page.width * page.height * 4;
        if (page.data.length !== size) throw new Error("Invalid MIFF pixels");
        if (page.data16 && page.data16.length !== size) throw new Error("Invalid MIFF pixels");
        const pixels = depth === 8 ? page.data : new Uint8Array(size * 2);
        if (depth === 16) {
            const view = new DataView(pixels.buffer);
            for (let index = 0; index < size; index++) view.setUint16(index * 2, page.data16?.[index] ?? page.data[index]! * 257);
        }
        const packed = miffPixels(pixels, miffChannels(page), depth / 8, compression);
        chunks.push(header);
        length += header.length;
        const compressor = compression === "zip" || compression === "bzip" ? createMiffCompressor(page.width * miffChannels(page) * (depth / 8), compression) : undefined;
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

export async function* encodeMiffFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal, requestedDepth?: 8 | 16, compression?: OutputEncodeOptions["miffCompression"], loop?: number): AsyncGenerator<Uint8Array> {
    for (let index = 0; index < (image.storedMiffPages?.length ?? 1); index++) {
        signal.throwIfAborted();
        const page = image.storedMiffPages ? await image.storedMiffPages.at(index) : image;
        signal.throwIfAborted();
        const depth = requestedDepth ?? (page.depth === "ushort" ? 16 : 8);
        const source16 = depth === 16 ? page.storedData16 : undefined;
        yield miffHeader(page, depth, compression, await page.storedDelay?.at(0, { signal }) ?? page.delay?.[0], loop ?? image.loop);
        const length = page.width * page.height * 4;
        if (source16 && source16.length !== length) throw new Error("Invalid MIFF pixels");
        const compressor = compression === "zip" || compression === "bzip" ? createMiffCompressor(page.width * miffChannels(page) * (depth / 8), compression) : undefined;
        try {
            for (let offset = 0; offset < length; offset += 4096) {
                signal.throwIfAborted();
                if (offset % 65536 === 0) await defaultRuntime.yieldTurn(signal);
                const size = Math.min(4096, length - offset), bytes = await storage.read((source16?.position ?? page.position) + offset * (source16 ? 2 : 1), size * (source16 ? 2 : 1), { signal });
                signal.throwIfAborted();
                if (bytes.length !== size * (source16 ? 2 : 1)) throw new Error("Truncated MIFF backing storage");
                let packed: Uint8Array;
                if (depth === 8) packed = miffPixels(bytes, miffChannels(page), 1, compression);
                else {
                    const pixels = new Uint8Array(size * 2), view = new DataView(pixels.buffer);
                    const samples = source16 ? new Uint16Array(new Uint8Array(bytes).buffer) : undefined;
                    for (let index = 0; index < size; index++) view.setUint16(index * 2, samples?.[index] ?? bytes[index]! * 257);
                    packed = miffPixels(pixels, miffChannels(page), 2, compression);
                }
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
