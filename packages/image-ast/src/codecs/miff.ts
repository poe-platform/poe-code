import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { defaultRuntime } from "@poe-code/compression";

export function miffChannels(image: Pick<RgbaImage, "space" | "hasAlpha">): 1 | 2 | 3 | 4 {
    return image.space === "b-w" || image.space === "grey16" ? image.hasAlpha ? 2 : 1 : image.hasAlpha ? 4 : 3;
}

function miffPixels(bytes: Uint8Array, channels: number, sampleBytes: number, compression?: "none" | "rle"): Uint8Array {
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

function miffHeader(image: Pick<RgbaImage, "width" | "height" | "space" | "hasAlpha"> & { magickColorspace?: string }, depth: 8 | 16, compression?: "none" | "rle"): Uint8Array {
    const { width, height } = image;
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 || !Number.isSafeInteger(width * height * 4)) throw new RangeError("Invalid MIFF dimensions");
    return new TextEncoder().encode(`id=ImageMagick version=1.0\nclass=DirectClass colors=0 matte=${image.hasAlpha ? "True" : "False"}\ncolumns=${width} rows=${height} depth=${depth}\ncolorspace=${miffChannels(image) <= 2 ? "Gray" : image.magickColorspace === "RGB" ? "RGB" : "sRGB"}\ncompression=${compression === "rle" ? "RLE" : "None"}\n\f\n:\x1a`);
}

export function encodeMiffImage(image: RgbaImage, requestedDepth?: 8 | 16, compression?: "none" | "rle"): Uint8Array {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (const page of image.miffPages ?? [image]) {
        const depth = requestedDepth ?? (page.depth === "ushort" ? 16 : 8);
        const header = miffHeader(page, depth, compression), size = page.width * page.height * 4;
        if (page.data.length !== size) throw new Error("Invalid MIFF pixels");
        if (page.data16 && page.data16.length !== size) throw new Error("Invalid MIFF pixels");
        const pixels = depth === 8 ? page.data : new Uint8Array(size * 2);
        if (depth === 16) {
            const view = new DataView(pixels.buffer);
            for (let index = 0; index < size; index++) view.setUint16(index * 2, page.data16?.[index] ?? page.data[index]! * 257);
        }
        const packed = miffPixels(pixels, miffChannels(page), depth / 8, compression);
        chunks.push(header, packed);
        length += header.length + packed.length;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
}

export async function* encodeMiffFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal, requestedDepth?: 8 | 16, compression?: "none" | "rle"): AsyncGenerator<Uint8Array> {
    for (let index = 0; index < (image.storedMiffPages?.length ?? 1); index++) {
        signal.throwIfAborted();
        const page = image.storedMiffPages ? await image.storedMiffPages.at(index) : image;
        signal.throwIfAborted();
        const depth = requestedDepth ?? (page.depth === "ushort" ? 16 : 8);
        const source16 = depth === 16 ? page.storedData16 : undefined;
        yield miffHeader(page, depth, compression);
        const length = page.width * page.height * 4;
        if (source16 && source16.length !== length) throw new Error("Invalid MIFF pixels");
        for (let offset = 0; offset < length; offset += 4096) {
            signal.throwIfAborted();
            if (offset % 65536 === 0) await defaultRuntime.yieldTurn(signal);
            const size = Math.min(4096, length - offset), bytes = await storage.read((source16?.position ?? page.position) + offset * (source16 ? 2 : 1), size * (source16 ? 2 : 1), { signal });
            signal.throwIfAborted();
            if (bytes.length !== size * (source16 ? 2 : 1)) throw new Error("Truncated MIFF backing storage");
            if (depth === 8) yield miffPixels(bytes, miffChannels(page), 1, compression);
            else {
                const pixels = new Uint8Array(size * 2), view = new DataView(pixels.buffer);
                const samples = source16 ? new Uint16Array(new Uint8Array(bytes).buffer) : undefined;
                for (let index = 0; index < size; index++) view.setUint16(index * 2, samples?.[index] ?? bytes[index]! * 257);
                yield miffPixels(pixels, miffChannels(page), 2, compression);
            }
        }
    }
}
