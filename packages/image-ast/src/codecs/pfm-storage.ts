import { defaultRuntime } from "@poe-code/compression";
import type { SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";
import { floatmapSequenceSteps } from "./floatmap-sequence.js";
import { pfmHeader, pfmPixels } from "./pfm.js";

export async function readPfmFromSource(source: ImageByteSource, signal: AbortSignal, page?: number) {
    const reader = new SourceBytes(source, signal, "PFM"), steps = floatmapSequenceSteps(source.size, pfmHeader, page); let next = steps.next();
    while (!next.done) next = steps.next(await reader.at(next.value));
    return next.value;
}

export async function decodePfmToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
    const { metadata, offset, little, scale } = await readPfmFromSource(source, signal, options?.page ?? 0), { width, height, channels } = metadata;
    checkLimitInputPixels(width, height, options);
    const length = width * height * 4, position = storage.allocate(length), storedData16 = { position: storage.allocate(length * 2), length }, storedDataFloat = { position: storage.allocate(length * 4), length };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x += 1024) {
        await defaultRuntime.yieldTurn(signal);
        const count = Math.min(1024, width - x), input = await source.read(offset + ((height - 1 - y) * width + x) * channels * 4, count * channels * 4, { signal });
        if (input.length !== count * channels * 4) throw new Error("Truncated PFM raster");
        const pixels = pfmPixels(input, channels, little, scale), target = (y * width + x) * 4;
        await storage.write(position + target, pixels.data, { signal });
        await storage.write(storedData16.position + target * 2, new Uint8Array(pixels.data16.buffer), { signal });
        await storage.write(storedDataFloat.position + target * 4, new Uint8Array(pixels.dataFloat.buffer), { signal });
    }
    return { ...metadata, position, storedData16, storedDataFloat };
}
