import { defaultRuntime } from "@poe-code/compression";
import type { SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";
import { miffHeader, miffPixels } from "./miff-input.js";

export async function readMiffFromSource(source: ImageByteSource, signal: AbortSignal, page?: number) {
    const reader = new SourceBytes(source, signal, "MIFF"), steps = miffHeader(source.size, page); let next = steps.next();
    while (!next.done) next = steps.next(await reader.at(next.value));
    return next.value;
}

export async function decodeMiffToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
    const { metadata, offset, colors, pixelBytes } = await readMiffFromSource(source, signal, options?.page);
    checkLimitInputPixels(metadata.width, metadata.height, options);
    const count = metadata.width * metadata.height, position = storage.allocate(count * 4), sampleBytes = metadata.bitsPerSample! / 8;
    const storedData16 = sampleBytes > 1 ? { position: storage.allocate(count * 8), length: count * 4 } : undefined;
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
    for (let pixel = 0; pixel < count; pixel += chunkPixels) {
        await defaultRuntime.yieldTurn(signal);
        const length = Math.min(chunkPixels, count - pixel) * pixelBytes;
        const input = await source.read(raster + pixel * pixelBytes, length, { signal });
        signal.throwIfAborted();
        if (input.length !== length) throw new Error("Truncated MIFF raster");
        const pixels = miffPixels(input, metadata, palette);
        await storage.write(position + pixel * 4, pixels.data, { signal });
        if (storedData16) await storage.write(storedData16.position + pixel * 8, new Uint8Array(pixels.data16!.buffer), { signal });
    }
    return { ...metadata, position, ...(storedData16 ? { storedData16 } : {}) };
}
