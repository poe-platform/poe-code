import { defaultRuntime } from "@poe-code/compression";
import type { SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";
import { miffHeader, miffPixels } from "./miff-input.js";
import { miffLzma } from "./miff-lzma.js";

export async function readMiffFromSource(source: ImageByteSource, signal: AbortSignal, page?: number, options?: SharpInputOptions) {
    const reader = new SourceBytes(source, signal, "MIFF"), steps = miffHeader(source.size, page, options); let next = steps.next();
    try {
        while (!next.done) {
            if (next.value instanceof Uint8Array) {
                await defaultRuntime.yieldTurn(signal);
                next = steps.next();
                continue;
            }
            const { offset, length } = next.value;
            signal.throwIfAborted();
            const byte = length === 1 ? await reader.at(offset) : undefined;
            const bytes = length === 1 ? byte === undefined ? new Uint8Array() : Uint8Array.of(byte) : await source.read(offset, length, { signal });
            signal.throwIfAborted();
            if (length > 1) await defaultRuntime.yieldTurn(signal);
            next = steps.next(bytes);
        }
        return next.value;
    } finally { steps.return(undefined!); }
}

export async function decodeMiffToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
    const { metadata, offset, colors, pixelBytes, compression } = await readMiffFromSource(source, signal, options?.page, options);
    checkLimitInputPixels(metadata.width, metadata.height, options);
    const count = metadata.width * metadata.height, position = storage.allocate(count * 4), sampleBytes = metadata.bitsPerSample! / 8;
    const storedData16 = sampleBytes > 1 || metadata.space === "cmyk" ? { position: storage.allocate(count * 8), length: count * 4 } : undefined;
    const storedHueSamples = metadata.space === "cmyk" ? storage.allocate(count * 32) : undefined;
    const palette = colors ? new Uint8Array(colors * 3 * sampleBytes) : undefined;
    if (palette) for (let start = 0; start < palette.length; start += 8192) {
        await defaultRuntime.yieldTurn(signal);
        const length = Math.min(8192, palette.length - start), bytes = await source.read(offset + start, length, { signal });
        signal.throwIfAborted();
        if (bytes.length !== length) throw new Error("Truncated MIFF palette");
        palette.set(bytes, start);
    }
    const raster = offset + (palette?.length ?? 0);
    const chunkPixels = Math.min(1024, Math.floor(8192 / pixelBytes));
    if (compression === "LZMA") {
        const chunks = miffLzma(raster, source.size, pixelBytes, count * pixelBytes);
        let pixel = 0;
        try {
            let chunk = chunks.next();
            while (!chunk.done) {
                await defaultRuntime.yieldTurn(signal);
                if (chunk.value instanceof Uint8Array) {
                    const pixels = miffPixels(chunk.value, metadata);
                    await storage.write(position + pixel * 4, pixels.data, { signal });
                    if (storedData16) await storage.write(storedData16.position + pixel * 8, new Uint8Array(pixels.data16!.buffer), { signal });
                    pixel += pixels.data.length / 4;
                    chunk = chunks.next();
                } else {
                    const bytes = await source.read(chunk.value.offset, chunk.value.length, { signal });
                    signal.throwIfAborted();
                    chunk = chunks.next(bytes);
                }
            }
        } finally { chunks.return(raster); }
    } else for (let pixel = 0; pixel < count; pixel += chunkPixels) {
        await defaultRuntime.yieldTurn(signal);
        const length = Math.min(chunkPixels, count - pixel) * pixelBytes;
        const input = await source.read(raster + pixel * pixelBytes, length, { signal });
        signal.throwIfAborted();
        if (input.length !== length) throw new Error("Truncated MIFF raster");
        const pixels = miffPixels(input, metadata, palette);
        await storage.write(position + pixel * 4, pixels.data, { signal });
        if (storedHueSamples !== undefined) await storage.write(storedHueSamples + pixel * 32, new Uint8Array(pixels.hueSamples!.buffer), { signal });
        if (storedData16) await storage.write(storedData16.position + pixel * 8, new Uint8Array(pixels.data16!.buffer), { signal });
    }
    return { ...metadata, position, ...(storedData16 ? { storedData16 } : {}), ...(storedHueSamples === undefined ? {} : { storedHueSamples }) };
}
