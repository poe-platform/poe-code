import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast";
import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { HueMetadata } from "./colorspace-hue.js";
import { magickResizeCanvas } from "./resize-canvas.js";

function colorKey(samples: Uint8Array | Uint16Array, offset: number, hasAlpha: boolean): bigint {
    let key = 0n;
    for (let channel = 0; channel < (hasAlpha ? 4 : 3); channel++) key = key << 16n | BigInt(samples[offset + channel]!);
    return key;
}

// ImageMagick compares HDRI channels with MagickEpsilon in Q16 units.
function equalWorkingColors(left: Float64Array, leftOffset: number, right: Float64Array, rightOffset: number, cmyk: boolean, hasAlpha: boolean, normalized: boolean): boolean {
    const epsilon = 1e-12 / (normalized ? 65535 : 257);
    for (let channel = 0; channel < (cmyk || hasAlpha ? 4 : 3); channel++) {
        if (Math.abs(left[leftOffset + channel]! - right[rightOffset + channel]!) >= epsilon) return false;
    }
    return true;
}

export class UniqueColors {
    private readonly exact = new Set<bigint>();
    private readonly leaves = new Map<number, { samples: Float64Array; alpha: number | undefined }[]>();
    size = 0;

    add(samples: Uint8Array | Uint16Array | Float64Array, offset: number, order: number, alpha?: number, hasAlpha = true, normalized = alpha !== undefined): boolean {
        if (samples instanceof Float64Array) {
            const leaf = this.leaves.get(order) ?? [];
            if (leaf.some(color => (!hasAlpha || color.alpha === alpha) && equalWorkingColors(color.samples, 0, samples, offset, alpha !== undefined, hasAlpha, normalized))) return false;
            leaf.push({ samples: samples.slice(offset, offset + 4), alpha });
            this.leaves.set(order, leaf);
        } else {
            const key = colorKey(samples, offset, hasAlpha);
            if (this.exact.has(key)) return false;
            this.exact.add(key);
        }
        this.size++;
        return true;
    }
}

export function colorOrder(samples: Uint8Array | Uint16Array, offset: number, hasAlpha: boolean, inks?: Float64Array): number {
    const scale = samples instanceof Uint16Array ? 257 : 1;
    // HDRI inks can exceed the output range; native tree keys use clamped bytes.
    const r = Math.round(inks ? Math.max(0, Math.min(255, inks[offset]! * 255)) : samples[offset]! / scale);
    const g = Math.round(inks ? Math.max(0, Math.min(255, inks[offset + 1]! * 255)) : samples[offset + 1]! / scale);
    const b = Math.round(inks ? Math.max(0, Math.min(255, inks[offset + 2]! * 255)) : samples[offset + 2]! / scale);
    const a = hasAlpha ? Math.round(samples[offset + 3]! / scale) : 0;
    let order = 0;
    // Native classification visits bits 7 through 1; exact colors sharing a
    // leaf retain their first occurrence, including hidden RGB at zero alpha.
    // Retained inactive alpha still splits the tree.
    // CMYK uses cyan, magenta and yellow here; black does not split the tree.
    for (let bit = 7; bit >= 1; bit--) order = order * 16 + ((r >> bit & 1) | (g >> bit & 1) << 1 | (b >> bit & 1) << 2 | (a >> bit & 1) << 3);
    return order;
}

export function* uniqueColorsSteps(image: RgbaImage & HueMetadata & { inactiveAlpha?: boolean | undefined; alphaBlend?: boolean | undefined }): Generator<void, RgbaImage & HueMetadata, void> {
    // Disassociate disables the native alpha trait; Deactivate and Discrete retain it.
    const dropAlpha = !image.hasAlpha && image.inactiveAlpha === true && image.alphaBlend === false;
    const hasAlpha = !dropAlpha && (image.hasAlpha || image.inactiveAlpha === true);
    const samples = image.data16 ?? image.data, seen = new UniqueColors();
    const inks = image.space === "cmyk" ? image.hueSamples : undefined;
    let pixels: { offset: number; order: number }[] = [];
    for (let offset = 0; offset < samples.length; offset += 4) {
        if (offset % 4096 === 0) yield;
        const order = colorOrder(samples, offset, hasAlpha, inks);
        if (!seen.add(image.hueSamples ?? image.evaluateSamples ?? samples, offset, order, inks ? samples[offset + 3]! : undefined, !dropAlpha, image.hueSamples !== undefined)) continue;
        pixels.push({ offset, order });
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
        if (dropAlpha) {
            data[index * 4 + 3] = 255;
            if (data16) data16[index * 4 + 3] = 65535;
            if (evaluateSamples) evaluateSamples[index * 4 + 3] = 255;
            if (hueSamples && !inks) hueSamples[index * 4 + 3] = 1;
        }
    }
    const virtualCanvas = magickResizeCanvas(image, pixels.length, 1);
    return { ...image, ...(dropAlpha ? { inactiveAlpha: false, alphaSeparate: false, channels: image.space === "cmyk" ? 4 : image.channels <= 2 ? 1 : 3 } : {}), isPalette: false, width: pixels.length, height: 1, ...(virtualCanvas ? { virtualCanvas } : {}), data, ...(hueSamples ? { hueSamples } : {}), ...(evaluateSamples ? { evaluateSamples } : {}), ...(data16 ? { data16 } : {}) };
}

export async function uniqueColorsStored(image: StoredRgbaImage & HueMetadata & { inactiveAlpha?: boolean | undefined; alphaBlend?: boolean | undefined }, storage: PagedStorage, signal: AbortSignal): Promise<StoredRgbaImage & HueMetadata> {
    const dropAlpha = !image.hasAlpha && image.inactiveAlpha === true && image.alphaBlend === false;
    const hasAlpha = !dropAlpha && (image.hasAlpha || image.inactiveAlpha === true);
    const seen = new IntegerTable(storage, 512), order = new IntegerTable(storage, 512), size = image.width * image.height * 4;
    const workingPosition = image.storedHueSamples ?? image.storedEvaluateSamples;
    let count = 0;
    // Each leaf stores linked blocks of representatives: next/count, then
    // alpha and four working channels per record (all float64).
    let blockPosition = -1, block = new Float64Array(), dirty = false;
    async function loadBlock(position: number, length: number): Promise<void> {
        if (position === blockPosition) return;
        if (dirty) await storage.write(blockPosition, new Uint8Array(block.buffer));
        block = new Float64Array((await storage.read(position, length)).slice().buffer);
        blockPosition = position;
        dirty = false;
    }
    for (let start = 0; start < size; start += 2048) {
        await yieldTurn(signal);
        const length = Math.min(2048, size - start);
        const bytes = await storage.read((image.storedData16?.position ?? image.position) + start * (image.storedData16 ? 2 : 1), length * (image.storedData16 ? 2 : 1));
        const samples = image.storedData16 ? new Uint16Array(bytes.slice().buffer) : bytes;
        const working = workingPosition === undefined ? undefined
            : new Float64Array((await storage.read(workingPosition + start * 8, length * 8)).slice().buffer);
        const inks = image.space === "cmyk" ? working : undefined;
        for (let offset = 0; offset < length; offset += 4) {
            if (working) {
                const leaf = BigInt(colorOrder(samples, offset, hasAlpha, inks));
                let position = await seen.get(leaf);
                if (position === undefined) {
                    position = BigInt(storage.allocate(64));
                    await seen.set(leaf, position);
                }
                const firstPosition = position;
                let duplicate = false, scanned = 0;
                while (true) {
                    await loadBlock(Number(position), position === firstPosition ? 64 : 16384);
                    const used = block[1]!;
                    for (let index = 0; index < used; index++) {
                        const record = 2 + index * 5;
                        if ((!inks || dropAlpha || block[record] === samples[offset + 3]) && equalWorkingColors(block, record + 1, working, offset, !!inks, !dropAlpha, image.storedHueSamples !== undefined)) {
                            duplicate = true;
                            break;
                        }
                    }
                    if (duplicate) break;
                    if (used < Math.floor((block.length - 2) / 5)) {
                        const record = 2 + used * 5;
                        block[record] = inks ? samples[offset + 3]! : 0;
                        block.set(working.subarray(offset, offset + 4), record + 1);
                        block[1] = used + 1;
                        dirty = true;
                        break;
                    }
                    if (block[0] === 0) {
                        block[0] = storage.allocate(16384);
                        dirty = true;
                    }
                    position = BigInt(block[0]!);
                    if (++scanned % 128 === 0) await yieldTurn(signal);
                }
                if (duplicate) continue;
            } else {
                const key = colorKey(samples, offset, !dropAlpha);
                if (await seen.get(key) !== undefined) continue;
                await seen.set(key, BigInt(start + offset));
            }
            // 36 low bits retain source order within a leaf. The source offset
            // also lets white RGBA16 use the table's full 64-bit key range.
            await order.set(BigInt(colorOrder(samples, offset, hasAlpha, inks)) << 36n | BigInt((start + offset) / 4), BigInt(start + offset));
            count++;
        }
    }
    const position = storage.allocate(count * 4), storedData16 = image.storedData16 ? { position: storage.allocate(count * 8), length: count * 4 } : undefined;
    const storedHueSamples = image.storedHueSamples === undefined ? undefined : storage.allocate(count * 32);
    const hueBytes = storedHueSamples === undefined ? undefined : new Uint8Array(4096 * 8);
    const storedEvaluateSamples = image.storedEvaluateSamples === undefined ? undefined : storage.allocate(count * 32);
    const evaluateBytes = storedEvaluateSamples === undefined ? undefined : new Uint8Array(4096 * 8);
    const data = new Uint8Array(4096), data16 = storedData16 ? new Uint16Array(4096) : undefined;
    const hueSamples = hueBytes ? new Float64Array(hueBytes.buffer) : undefined;
    const evaluateSamples = evaluateBytes ? new Float64Array(evaluateBytes.buffer) : undefined;
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
        if (dropAlpha) {
            data[used + 3] = 255;
            if (data16) data16[used + 3] = 65535;
            if (evaluateSamples) evaluateSamples[used + 3] = 255;
            if (hueSamples && image.space !== "cmyk") hueSamples[used + 3] = 1;
        }
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
    return { ...image, ...(dropAlpha ? { inactiveAlpha: false, alphaSeparate: false, channels: image.space === "cmyk" ? 4 : image.channels <= 2 ? 1 : 3 } : {}), isPalette: false, position, width: count, height: 1, ...(virtualCanvas ? { virtualCanvas } : {}), ...(storedHueSamples === undefined ? {} : { storedHueSamples }), ...(storedEvaluateSamples === undefined ? {} : { storedEvaluateSamples }), ...(storedData16 ? { storedData16 } : {}) };
}
