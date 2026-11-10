import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast";
import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { HueMetadata } from "./colorspace-hue.js";
import { magickResizeCanvas } from "./resize-canvas.js";

function colorKey(samples: Uint8Array | Uint16Array | Float64Array, offset: number, hasAlpha: boolean): bigint {
    let key = 0n;
    if (samples instanceof Float64Array) {
        const bits = new BigUint64Array(samples.buffer, samples.byteOffset, samples.length);
        for (let channel = 0; channel < 4; channel++) {
            // Ignore inactive alpha and treat signed zero as the same sample.
            key = key << 64n | (channel === 3 && !hasAlpha || samples[offset + channel] === 0 ? 0n : bits[offset + channel]!);
        }
        return key;
    }
    for (let channel = 0; channel < 4; channel++) key = key << 16n | BigInt(channel === 3 && !hasAlpha ? 65535 : samples[offset + channel]!);
    return key;
}

function colorOrder(samples: Uint8Array | Uint16Array, offset: number, hasAlpha: boolean, inks?: Float64Array): number {
    const scale = samples instanceof Uint16Array ? 257 : 1;
    const r = Math.round(inks ? inks[offset]! * 255 : samples[offset]! / scale);
    const g = Math.round(inks ? inks[offset + 1]! * 255 : samples[offset + 1]! / scale);
    const b = Math.round(inks ? inks[offset + 2]! * 255 : samples[offset + 2]! / scale);
    const a = hasAlpha ? Math.round(samples[offset + 3]! / scale) : 0;
    let order = 0;
    // Native classification visits bits 7 through 1; exact colors sharing a
    // leaf retain their first occurrence, including hidden RGB at zero alpha.
    // CMYK uses cyan, magenta and yellow here; black does not split the tree.
    for (let bit = 7; bit >= 1; bit--) order = order * 16 + ((r >> bit & 1) | (g >> bit & 1) << 1 | (b >> bit & 1) << 2 | (a >> bit & 1) << 3);
    return order;
}

export function* uniqueColorsSteps(image: RgbaImage & HueMetadata): Generator<void, RgbaImage & HueMetadata, void> {
    const samples = image.data16 ?? image.data, seen = new Set<bigint>();
    let pixels: { offset: number; order: number }[] = [];
    for (let offset = 0; offset < samples.length; offset += 4) {
        if (offset % 4096 === 0) yield;
        const key = colorKey(image.evaluateSamples ?? samples, offset, image.hasAlpha);
        if (seen.has(key)) continue;
        seen.add(key);
        pixels.push({ offset, order: colorOrder(samples, offset, image.hasAlpha, image.space === "cmyk" ? image.hueSamples : undefined) });
    }
    // Stable radix sorting stays cooperative even for an all-unique raster.
    for (let shift = 0; shift < 28; shift += 4) {
        const buckets: typeof pixels[] = Array.from({ length: 16 }, () => []);
        for (let index = 0; index < pixels.length; index++) {
            if (index % 1024 === 0) yield;
            const pixel = pixels[index]!;
            buckets[pixel.order >>> shift & 15]!.push(pixel);
        }
        pixels = [];
        for (const bucket of buckets) for (const pixel of bucket) {
            if (pixels.length % 1024 === 0) yield;
            pixels.push(pixel);
        }
    }
    const data = new Uint8Array(pixels.length * 4), data16 = image.data16 ? new Uint16Array(data.length) : undefined;
    const hueSamples = image.hueSamples ? new Float64Array(data.length) : undefined;
    const evaluateSamples = image.evaluateSamples ? new Float64Array(data.length) : undefined;
    for (let index = 0; index < pixels.length; index++) {
        if (index % 1024 === 0) yield;
        const offset = pixels[index]!.offset;
        data.set(image.data.subarray(offset, offset + 4), index * 4);
        if (data16) data16.set(image.data16!.subarray(offset, offset + 4), index * 4);
        if (hueSamples) hueSamples.set(image.hueSamples!.subarray(offset, offset + 4), index * 4);
        if (evaluateSamples) evaluateSamples.set(image.evaluateSamples!.subarray(offset, offset + 4), index * 4);
    }
    const virtualCanvas = magickResizeCanvas(image, pixels.length, 1);
    return { ...image, width: pixels.length, height: 1, ...(virtualCanvas ? { virtualCanvas } : {}), data, ...(hueSamples ? { hueSamples } : {}), ...(evaluateSamples ? { evaluateSamples } : {}), ...(data16 ? { data16 } : {}) };
}

export async function uniqueColorsStored(image: StoredRgbaImage & HueMetadata, storage: PagedStorage, signal: AbortSignal): Promise<StoredRgbaImage & HueMetadata> {
    const seen = new IntegerTable(storage, 512), order = new IntegerTable(storage, 512), size = image.width * image.height * 4;
    let count = 0;
    for (let start = 0; start < size; start += 2048) {
        await yieldTurn(signal);
        const length = Math.min(2048, size - start);
        const bytes = await storage.read((image.storedData16?.position ?? image.position) + start * (image.storedData16 ? 2 : 1), length * (image.storedData16 ? 2 : 1));
        const samples = image.storedData16 ? new Uint16Array(bytes.slice().buffer) : bytes;
        const working = image.storedEvaluateSamples === undefined ? undefined
            : new Float64Array((await storage.read(image.storedEvaluateSamples + start * 8, length * 8)).slice().buffer);
        const inks = image.space === "cmyk" && image.storedHueSamples !== undefined
            ? new Float64Array((await storage.read(image.storedHueSamples + start * 8, length * 8)).slice().buffer) : undefined;
        for (let offset = 0; offset < length; offset += 4) {
            const key = colorKey(working ?? samples, offset, image.hasAlpha);
            let slot = key;
            if (working) {
                // The paged table has 64-bit keys. Hash all working-sample bits,
                // then compare exact colors and probe on a hash collision.
                slot = 14695981039346656037n;
                for (let shift = 0n; shift < 256n; shift += 8n) slot = BigInt.asUintN(64, (slot ^ (key >> shift & 255n)) * 1099511628211n);
            }
            let previous = await seen.get(slot);
            while (working && previous !== undefined) {
                const source = Number(previous);
                const candidate = source >= start && source < start + length ? working
                    : new Float64Array((await storage.read(image.storedEvaluateSamples! + source * 8, 32)).slice().buffer);
                if (colorKey(candidate, candidate === working ? source - start : 0, image.hasAlpha) === key) break;
                await yieldTurn(signal);
                slot = BigInt.asUintN(64, slot + 1n);
                previous = await seen.get(slot);
            }
            if (previous !== undefined) continue;
            await seen.set(slot, BigInt(start + offset));
            // 36 low bits retain source order within a leaf. The source offset
            // also lets white RGBA16 use the table's full 64-bit key range.
            await order.set(BigInt(colorOrder(samples, offset, image.hasAlpha, inks)) << 36n | BigInt((start + offset) / 4), BigInt(start + offset));
            count++;
        }
    }
    const position = storage.allocate(count * 4), storedData16 = image.storedData16 ? { position: storage.allocate(count * 8), length: count * 4 } : undefined;
    const storedHueSamples = image.storedHueSamples === undefined ? undefined : storage.allocate(count * 32);
    const hueBytes = storedHueSamples === undefined ? undefined : new Uint8Array(4096 * 8);
    const storedEvaluateSamples = image.storedEvaluateSamples === undefined ? undefined : storage.allocate(count * 32);
    const evaluateBytes = storedEvaluateSamples === undefined ? undefined : new Uint8Array(4096 * 8);
    const data = new Uint8Array(4096), data16 = storedData16 ? new Uint16Array(4096) : undefined;
    let written = 0, used = 0;
    for await (const [, source] of order.entries()) {
        if (used === 0) await yieldTurn(signal);
        const offset = Number(source);
        if (data16) {
            const bytes = await storage.read(image.storedData16!.position + offset * 2, 8);
            const samples = new Uint16Array(bytes.slice().buffer);
            data16.set(samples, used);
            data.set(Uint8Array.from(samples, value => Math.round(value / 257)), used);
        } else data.set(await storage.read(image.position + offset, 4), used);
        if (hueBytes) hueBytes.set(await storage.read(image.storedHueSamples! + offset * 8, 32), used * 8);
        if (evaluateBytes) evaluateBytes.set(await storage.read(image.storedEvaluateSamples! + offset * 8, 32), used * 8);
        used += 4;
        if (used === data.length || written + used === count * 4) {
            await storage.write(position + written, data.subarray(0, used));
            if (data16) await storage.write(storedData16!.position + written * 2, new Uint8Array(data16.buffer, 0, used * 2));
            if (hueBytes) await storage.write(storedHueSamples! + written * 8, hueBytes.subarray(0, used * 8));
            if (evaluateBytes) await storage.write(storedEvaluateSamples! + written * 8, evaluateBytes.subarray(0, used * 8));
            written += used; used = 0;
        }
    }
    const virtualCanvas = magickResizeCanvas(image, count, 1);
    return { ...image, position, width: count, height: 1, ...(virtualCanvas ? { virtualCanvas } : {}), ...(storedHueSamples === undefined ? {} : { storedHueSamples }), ...(storedEvaluateSamples === undefined ? {} : { storedEvaluateSamples }), ...(storedData16 ? { storedData16 } : {}) };
}
