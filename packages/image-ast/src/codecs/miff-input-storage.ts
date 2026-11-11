import { defaultRuntime } from "@poe-code/compression";
import type { SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";
import { miffHeader, miffPixels, miffRaster } from "./miff-input.js";

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
    const header = await readMiffFromSource(source, signal, options?.page, options), { metadata } = header;
    checkLimitInputPixels(metadata.width, metadata.height, options);
    const count = metadata.width * metadata.height, position = storage.allocate(count * 4), sampleBytes = metadata.bitsPerSample! / 8;
    const storedHueSamples = metadata.space === "cmyk" ? storage.allocate(count * 32) : undefined;
    const storedEvaluateSamples = metadata.depth === "float" && storedHueSamples === undefined ? storage.allocate(count * 32) : undefined;
    const storedData16 = sampleBytes > 1 || storedHueSamples !== undefined ? { position: storage.allocate(count * 8), length: count * 4 } : undefined;
    const storedMetaChannels: StoredRgbaImage[] = Array.from({ length: metadata.metaChannelCount }, () => ({
        ...metadata, metaChannelCount: 0, channels: 1, space: "b-w", magickColorspace: "Gray", hasAlpha: false,
        position: storage.allocate(count * 4), ...(sampleBytes > 1 ? { storedData16: { position: storage.allocate(count * 8), length: count * 4 } } : {})
    }));
    const palette = header.colors ? new Uint8Array(header.colors * 3 * sampleBytes) : undefined;
    if (palette) for (let start = 0; start < palette.length; start += 8192) {
        await defaultRuntime.yieldTurn(signal);
        const length = Math.min(8192, palette.length - start), bytes = await source.read(header.offset + start, length, { signal });
        signal.throwIfAborted();
        if (bytes.length !== length) throw new Error("Truncated MIFF palette");
        palette.set(bytes, start);
    }
    const steps = miffRaster(header);
    let next = steps.next(), pixel = 0;
    try {
        while (!next.done) {
            await defaultRuntime.yieldTurn(signal);
            if (next.value instanceof Uint8Array) {
                const pixels = miffPixels(next.value, metadata, palette);
                await storage.write(position + pixel * 4, pixels.data, { signal });
                if (storedEvaluateSamples !== undefined) await storage.write(storedEvaluateSamples + pixel * 32, new Uint8Array(pixels.evaluateSamples!.buffer), { signal });
                if (storedHueSamples !== undefined) await storage.write(storedHueSamples + pixel * 32, new Uint8Array(pixels.hueSamples!.buffer), { signal });
                if (storedData16) await storage.write(storedData16.position + pixel * 8, new Uint8Array(pixels.data16!.buffer), { signal });
                for (const [index, plane] of storedMetaChannels.entries()) {
                    const samples = miffPixels(next.value, metadata, undefined, index);
                    await storage.write(plane.position + pixel * 4, samples.data, { signal });
                    if (plane.storedData16) await storage.write(plane.storedData16.position + pixel * 8, new Uint8Array(samples.data16!.buffer), { signal });
                }
                pixel += pixels.data.length / 4;
                next = steps.next();
            } else {
                const input = await source.read(next.value.offset, next.value.length, { signal });
                signal.throwIfAborted();
                next = steps.next(input);
            }
        }
    } finally { steps.return(header.offset); }
    return { ...metadata, position, ...(storedEvaluateSamples === undefined ? {} : { storedEvaluateSamples }), ...(storedMetaChannels.length ? { storedMetaChannels } : {}), ...(storedData16 ? { storedData16 } : {}), ...(storedHueSamples === undefined ? {} : { storedHueSamples }) };
}
