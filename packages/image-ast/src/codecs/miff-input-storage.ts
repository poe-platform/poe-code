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
    const { metadata, offset } = await readMiffFromSource(source, signal, options?.page);
    checkLimitInputPixels(metadata.width, metadata.height, options);
    const count = metadata.width * metadata.height, position = storage.allocate(count * 4), sampleBytes = metadata.depth === "ushort" ? 2 : 1;
    const storedData16 = sampleBytes === 2 ? { position: storage.allocate(count * 8), length: count * 4 } : undefined;
    for (let pixel = 0; pixel < count; pixel += 1024) {
        await defaultRuntime.yieldTurn(signal);
        const length = Math.min(1024, count - pixel) * metadata.channels * sampleBytes;
        const input = await source.read(offset + pixel * metadata.channels * sampleBytes, length, { signal });
        signal.throwIfAborted();
        if (input.length !== length) throw new Error("Truncated MIFF raster");
        const pixels = miffPixels(input, metadata);
        await storage.write(position + pixel * 4, pixels.data, { signal });
        if (storedData16) await storage.write(storedData16.position + pixel * 8, new Uint8Array(pixels.data16!.buffer), { signal });
    }
    return { ...metadata, position, ...(storedData16 ? { storedData16 } : {}) };
}
