import { hueTextPixel, type HueMetadata } from "./colorspace-hue.js";
import type { StoredRgbaImage } from "@poe-code/image-ast/portable";
import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";

const hex = (value: number) => value.toString(16).toUpperCase().padStart(2, "0");
export function pixelEnumerationLine(x: number, y: number, r: number, g: number, b: number, a: number): string {
    return `${x},${y}: (${r},${g},${b},${a})  #${hex(r)}${hex(g)}${hex(b)}${a < 255 ? hex(a) : ""}  srgba(${r},${g},${b},${Number((a / 255).toPrecision(6))})`;
}
export function histogramLine(key: number, count: number, hasAlpha: boolean): string {
    const r = (key >>> 24) & 255, g = (key >>> 16) & 255, b = (key >>> 8) & 255;
    const a = key & 255;
    if (hasAlpha) return `  ${count}: (${r},${g},${b},${a}) #${hex(r)}${hex(g)}${hex(b)}${hex(a)} srgba(${r},${g},${b},${Number((a / 255).toPrecision(6))})`;
    return `  ${count}: (${r},${g},${b}) #${hex(r)}${hex(g)}${hex(b)} srgb(${r},${g},${b})`;
}
export async function* storedPixelEnumeration(image: StoredRgbaImage & HueMetadata, storage: PagedStorage, signal: AbortSignal): AsyncGenerator<string> {
    yield (image.magickColorspace === "HSL" || image.magickColorspace === "HSB" || image.magickColorspace === "HWB" || image.magickColorspace === "XYZ" || image.magickColorspace === "YCbCr" || image.magickColorspace === "YUV") ? `# ImageMagick pixel enumeration: ${image.width},${image.height},0,65535,${image.magickColorspace.toLowerCase()}${image.hasAlpha ? "a" : ""}\n` : `# ImageMagick pixel enumeration: ${image.width},${image.height},0,255,srgba\n`;
    const size = image.width * image.height * 4;
    for (let start = 0; start < size; start += 16384) {
        await yieldTurn(signal);
        const bytes = await storage.read(image.position + start, Math.min(16384, size - start));
        const original = (image.magickColorspace === "HSL" || image.magickColorspace === "HSB" || image.magickColorspace === "HWB" || image.magickColorspace === "XYZ" || image.magickColorspace === "YCbCr" || image.magickColorspace === "YUV") && image.storedData16 ? await storage.read(image.storedData16.position + start * 2, bytes.length * 2) : undefined;
        const data16 = original ? new Uint16Array(original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength)) : undefined;
        const samples = (image.magickColorspace === "HWB" || image.magickColorspace === "XYZ" || image.magickColorspace === "YCbCr" || image.magickColorspace === "YUV") && image.storedHueSamples !== undefined ? await storage.read(image.storedHueSamples + start * 8, bytes.length * 8) : undefined;
        const hueSamples = samples ? new Float64Array(samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength)) : undefined;
        for (let offset = 0; offset < bytes.length; offset += 4) {
            const pixel = (start + offset) / 4;
            if ((image.magickColorspace === "HSL" || image.magickColorspace === "HSB" || image.magickColorspace === "HWB" || image.magickColorspace === "XYZ" || image.magickColorspace === "YCbCr" || image.magickColorspace === "YUV")) {
                yield `${pixel % image.width},${Math.floor(pixel / image.width)}: ${hueTextPixel(Array.from(data16?.subarray(offset, offset + 4) ?? bytes.subarray(offset, offset + 4), value => data16 ? value : value * 257), image.hasAlpha, image.magickColorspace, hueSamples ? Array.from(hueSamples.subarray(offset, offset + 4)) : undefined)}\n`;
                continue;
            }
            yield pixelEnumerationLine(pixel % image.width, Math.floor(pixel / image.width), bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!) + "\n";
        }
    }
}
export async function* storedHistogram(image: StoredRgbaImage & HueMetadata, storage: PagedStorage, signal: AbortSignal): AsyncGenerator<string> {
    const counts = new IntegerTable(storage, 512), order = new IntegerTable(storage, 128), size = image.width * image.height * 4;
    const sampleOffsets = (image.magickColorspace === "HWB" || image.magickColorspace === "XYZ" || image.magickColorspace === "YCbCr" || image.magickColorspace === "YUV") && image.storedHueSamples !== undefined ? new IntegerTable(storage, 128) : undefined;
    let unique = 0;
    for (let start = 0; start < size; start += 16384) {
        await yieldTurn(signal);
        const bytes = await storage.read(image.position + start, Math.min(16384, size - start));
        const original = (image.magickColorspace === "HSL" || image.magickColorspace === "HSB" || image.magickColorspace === "HWB" || image.magickColorspace === "XYZ" || image.magickColorspace === "YCbCr" || image.magickColorspace === "YUV") && image.storedData16 ? await storage.read(image.storedData16.position + start * 2, bytes.length * 2) : undefined;
        const data16 = original ? new Uint16Array(original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength)) : undefined;
        for (let offset = 0; offset < bytes.length; offset += 4) {
            const key = (image.magickColorspace === "HSL" || image.magickColorspace === "HSB" || image.magickColorspace === "HWB" || image.magickColorspace === "XYZ" || image.magickColorspace === "YCbCr" || image.magickColorspace === "YUV") ? Array.from(data16?.subarray(offset, offset + 4) ?? bytes.subarray(offset, offset + 4), value => BigInt(data16 ? value : value * 257)).reduce((key, value) => (key << 16n) | value, 0n) : BigInt(((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0), count = await counts.get(key);
            if (count === undefined) {
                if (sampleOffsets) await sampleOffsets.set(BigInt(unique), BigInt(start + offset));
                await order.set(BigInt(unique++), key);
            }
            await counts.set(key, (count ?? 0n) + 1n);
        }
    }
    for (let index = 0; index < unique; index++) {
        if (index % 128 === 0) await yieldTurn(signal);
        const key = (await order.get(BigInt(index)))!;
        const samples = sampleOffsets ? await storage.read(image.storedHueSamples! + Number(await sampleOffsets.get(BigInt(index))) * 8, 32) : undefined;
        const hueSamples = samples ? Array.from(new Float64Array(samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength))) : undefined;
        yield (image.magickColorspace === "HSL" || image.magickColorspace === "HSB" || image.magickColorspace === "HWB" || image.magickColorspace === "XYZ" || image.magickColorspace === "YCbCr" || image.magickColorspace === "YUV") ? `  ${Number(await counts.get(key))}: ${hueTextPixel([48n, 32n, 16n, 0n].map(shift => Number((key >> shift) & 65535n)), image.hasAlpha, image.magickColorspace, hueSamples)}\n` : histogramLine(Number(key), Number(await counts.get(key)), image.hasAlpha) + "\n";
    }
    if (!unique) yield "\n";
}
export async function* encodeText(parts: AsyncIterable<string>, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    const encoder = new TextEncoder(); let bytes = new Uint8Array(4096), used = 0, pending = "";
    for await (const next of parts) {
        let part = pending + next; pending = "";
        const last = part.charCodeAt(part.length - 1);
        if (last >= 0xd800 && last <= 0xdbff) { pending = part.at(-1)!; part = part.slice(0, -1); }
        signal.throwIfAborted();
        for (let offset = 0; offset < part.length;) {
            const { read, written } = encoder.encodeInto(part.slice(offset, offset + 4097), bytes.subarray(used));
            offset += read; used += written;
            if (used === bytes.length || read === 0) { yield bytes.subarray(0, used); bytes = new Uint8Array(4096); used = 0; }
        }
    }
    if (pending) {
        if (bytes.length - used < 3) { yield bytes.subarray(0, used); bytes = new Uint8Array(4096); used = 0; }
        used += encoder.encodeInto(pending, bytes.subarray(used)).written;
    }
    if (used) yield bytes.subarray(0, used);
}
