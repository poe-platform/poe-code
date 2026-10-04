import type { StoredRgbaImage } from "@poe-code/image-ast/portable";
import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";

const hex = (value: number) => value.toString(16).toUpperCase().padStart(2, "0");
export function pixelEnumerationLine(x: number, y: number, r: number, g: number, b: number, a: number): string {
    return `${x},${y}: (${r},${g},${b},${a})  #${hex(r)}${hex(g)}${hex(b)}${a < 255 ? hex(a) : ""}  srgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}
export function histogramLine(key: number, count: number): string {
    const r = (key >>> 24) & 255, g = (key >>> 16) & 255, b = (key >>> 8) & 255;
    return `  ${count}: (${r},${g},${b}) #${hex(r)}${hex(g)}${hex(b)} srgb(${r},${g},${b})`;
}
export async function* storedPixelEnumeration(image: StoredRgbaImage, storage: PagedStorage, signal: AbortSignal): AsyncGenerator<string> {
    yield `# ImageMagick pixel enumeration: ${image.width},${image.height},255,srgba\n`;
    const size = image.width * image.height * 4;
    for (let start = 0; start < size; start += 16384) {
        await yieldTurn(signal);
        const bytes = await storage.read(image.position + start, Math.min(16384, size - start));
        for (let offset = 0; offset < bytes.length; offset += 4) {
            const pixel = (start + offset) / 4;
            yield pixelEnumerationLine(pixel % image.width, Math.floor(pixel / image.width), bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!) + "\n";
        }
    }
}
export async function* storedHistogram(image: StoredRgbaImage, storage: PagedStorage, signal: AbortSignal): AsyncGenerator<string> {
    const counts = new IntegerTable(storage, 512), order = new IntegerTable(storage, 128), size = image.width * image.height * 4;
    let unique = 0;
    for (let start = 0; start < size; start += 16384) {
        await yieldTurn(signal);
        const bytes = await storage.read(image.position + start, Math.min(16384, size - start));
        for (let offset = 0; offset < bytes.length; offset += 4) {
            const key = BigInt(((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0), count = await counts.get(key);
            if (count === undefined) await order.set(BigInt(unique++), key);
            await counts.set(key, (count ?? 0n) + 1n);
        }
    }
    for (let index = 0; index < unique; index++) {
        if (index % 128 === 0) await yieldTurn(signal);
        const key = (await order.get(BigInt(index)))!;
        yield histogramLine(Number(key), Number(await counts.get(key))) + "\n";
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
