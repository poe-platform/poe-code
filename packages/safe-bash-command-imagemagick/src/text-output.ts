import { histogramColorNames } from "./histogram-color-names.js";
import { hueTextPixel, type HueMetadata } from "./colorspace-hue.js";
import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";

const hex = (value: number) => value.toString(16).toUpperCase().padStart(2, "0");
export function pixelEnumerationLine(x: number, y: number, r: number, g: number, b: number, a: number, colorspace = "srgba"): string {
    const alpha = colorspace.endsWith("a");
    const samples = colorspace.startsWith("gray") ? String(r) : `${r},${g},${b}`;
    const name = colorspace === "srgba" && a === 255 ? histogramColorNames[(r << 16) | (g << 8) | b] : undefined;
    return `${x},${y}: (${samples}${alpha ? `,${a}` : ""})  #${hex(r)}${hex(g)}${hex(b)}${alpha ? hex(a) : ""}  ${name ?? `${colorspace}(${samples}${alpha ? `,${Number((a / 255).toPrecision(6))}` : ""})`}`;
}
export function srgbDepthEnumerationLine(x: number, y: number, samples: Uint8Array | Uint16Array, hasAlpha: boolean, depth: number): string {
    const levels = 2 ** Math.min(depth, 16) - 1, maximum = depth <= 8 ? 255 : 65535;
    const sourceMaximum = samples instanceof Uint16Array ? 65535 : 255;
    const channels = Array.from(samples.subarray(0, hasAlpha ? 4 : 3), value => Math.round(Math.round(value * levels / sourceMaximum) * maximum / levels));
    const color = channels.map(value => hex(value).padStart(maximum === 255 ? 2 : 4, "0")).join("");
    const rgb = channels.slice(0, 3);
    const percent = maximum === 65535 && rgb.some(value => value % 257 !== 0);
    const values = rgb.map(value => percent ? `${Number((value * 100 / maximum).toPrecision(6))}%` : String(value / (maximum === 65535 ? 257 : 1)));
    if (hasAlpha) values.push(String(Number((channels[3]! / maximum).toPrecision(6))));
    const name = !hasAlpha || channels[3] === maximum ? histogramColorNames[(Math.round(rgb[0]! * 255 / maximum) << 16) | (Math.round(rgb[1]! * 255 / maximum) << 8) | Math.round(rgb[2]! * 255 / maximum)] : undefined;
    return `${x},${y}: (${channels.join(",")})  #${color}  ${name && !percent ? name : `srgb${hasAlpha ? "a" : ""}(${values.join(",")})`}`;
}
export function gray16EnumerationLine(x: number, y: number, gray: number, alpha: number | undefined): string {
    const value = gray % 257 === 0 ? String(gray / 257) : `${Number((gray * 100 / 65535).toPrecision(6))}%`;
    const color = hex(gray).padStart(4, "0").repeat(3);
    return `${x},${y}: (${gray}${alpha === undefined ? "" : `,${alpha}`})  #${color}${alpha === undefined ? "" : hex(alpha).padStart(4, "0")}  gray${alpha === undefined ? "" : "a"}(${value}${alpha === undefined ? "" : `,${Number((alpha / 65535).toPrecision(6))}`})`;
}
export function histogramLine(key: number | bigint, count: number, hasAlpha: boolean): string {
    if (typeof key === "bigint") {
        const samples = [48n, 32n, 16n, ...(hasAlpha ? [0n] : [])].map(shift => Number((key >> shift) & 65535n));
        const color = samples.slice(0, 3).map(value => `${Number((value * 100 / 65535).toPrecision(6))}%`);
        if (hasAlpha) color.push(String(Number((samples[3]! / 65535).toPrecision(6))));
        return `${String(count).padStart(14)}: (${samples.join(",")}) #${samples.map(value => hex(value).padStart(4, "0")).join("")} srgb${hasAlpha ? "a" : ""}(${color.join(",")})`;
    }
    const r = (key >>> 24) & 255, g = (key >>> 16) & 255, b = (key >>> 8) & 255;
    const a = key & 255;
    if (hasAlpha) return `  ${count}: (${r},${g},${b},${a}) #${hex(r)}${hex(g)}${hex(b)}${hex(a)} srgba(${r},${g},${b},${Number((a / 255).toPrecision(6))})`;
    return `${String(count).padStart(14)}: (${r},${g},${b}) #${hex(r)}${hex(g)}${hex(b)} ${histogramColorNames[key >>> 8] ?? `srgb(${r},${g},${b})`}`;
}
export function* sparseColorPoints(image: Pick<RgbaImage, "width" | "space" | "hasAlpha">, data: Uint8Array | Uint16Array, start = 0): Generator<string> {
    const highDepth = data instanceof Uint16Array, opaque = highDepth ? 65535 : 255;
    const gray = image.space === "b-w" || image.space === "grey16";
    for (let offset = 0; offset < data.length; offset += 4) {
        if (image.hasAlpha && data[offset + 3] !== opaque) continue;
        const pixel = start + offset / 4;
        const channels = data.subarray(offset, offset + (gray ? 1 : 3));
        const percent = highDepth && channels.some(value => value % 257 !== 0);
        const samples = Array.from(channels, value => percent ? `${Number((value * 100 / 65535).toPrecision(6))}%` : String(value / (highDepth ? 257 : 1)));
        if (image.hasAlpha) samples.push("1");
        yield `${pixel % image.width},${Math.floor(pixel / image.width)},${gray ? "gray" : "srgb"}${image.hasAlpha ? "a" : ""}(${samples.join(",")}) `;
    }
}
export async function* storedSparseColor(image: StoredRgbaImage, storage: PagedStorage, signal: AbortSignal): AsyncGenerator<string> {
    const size = image.width * image.height * 4, highDepth = image.storedData16 !== undefined;
    for (let start = 0; start < size; start += 16384) {
        await yieldTurn(signal);
        const bytes = await storage.read((image.storedData16?.position ?? image.position) + start * (highDepth ? 2 : 1), Math.min(16384, size - start) * (highDepth ? 2 : 1));
        const data = highDepth ? new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) : bytes;
        yield* sparseColorPoints(image, data, start / 4);
    }
}
export async function* storedPixelEnumeration(image: StoredRgbaImage & HueMetadata, storage: PagedStorage, signal: AbortSignal, depth?: number): AsyncGenerator<string> {
    const maximum = ["HCL", "HCLp", "HSL", "HSB", "HSV", "HWB", "XYZ"].includes(image.magickColorspace ?? "") && (depth ?? image.bitsPerSample ?? (image.depth === "ushort" ? 16 : 8)) <= 8 ? 255 : 65535;
    const srgbDepth = depth !== undefined && image.space === "srgb" && !image.magickColorspace;
    const colorspace = `${image.space === "b-w" || image.space === "grey16" ? "gray" : image.magickColorspace === "RGB" ? "rgb" : "srgb"}${image.hasAlpha ? "a" : ""}`;
    const gray16 = (image.space === "b-w" || image.space === "grey16") && image.storedData16 !== undefined;
    yield srgbDepth ? `# ImageMagick pixel enumeration: ${image.width},${image.height},0,${depth > 8 ? 65535 : 255},srgb${image.hasAlpha ? "a" : ""}\n` : gray16 ? `# ImageMagick pixel enumeration: ${image.width},${image.height},0,65535,gray${image.hasAlpha ? "a" : ""}\n` : (image.magickColorspace === "HCL" || image.magickColorspace === "HCLp" || image.magickColorspace === "HSL" || image.magickColorspace === "HSB" || image.magickColorspace === "HSV" || image.magickColorspace === "HWB" || image.magickColorspace === "XYZ" || image.magickColorspace === "YCbCr" || image.magickColorspace === "OHTA" || image.magickColorspace === "YUV" || image.magickColorspace === "CIELab") ? `# ImageMagick pixel enumeration: ${image.width},${image.height},0,${maximum},${image.magickColorspace.toLowerCase()}${image.hasAlpha ? "a" : ""}\n` : `# ImageMagick pixel enumeration: ${image.width},${image.height},0,255,${colorspace}\n`;
    const size = image.width * image.height * 4;
    for (let start = 0; start < size; start += 16384) {
        await yieldTurn(signal);
        const bytes = await storage.read(image.position + start, Math.min(16384, size - start));
        const original = (srgbDepth || gray16 || image.magickColorspace === "HCL" || image.magickColorspace === "HCLp" || image.magickColorspace === "HSL" || image.magickColorspace === "HSB" || image.magickColorspace === "HSV" || image.magickColorspace === "HWB" || image.magickColorspace === "XYZ" || image.magickColorspace === "YCbCr" || image.magickColorspace === "OHTA" || image.magickColorspace === "YUV" || image.magickColorspace === "CIELab") && image.storedData16 ? await storage.read(image.storedData16.position + start * 2, bytes.length * 2) : undefined;
        const data16 = original ? new Uint16Array(original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength)) : undefined;
        const samples = (image.magickColorspace === "HCL" || image.magickColorspace === "HCLp" || image.magickColorspace === "HSL" || image.magickColorspace === "HWB" || image.magickColorspace === "XYZ" || image.magickColorspace === "YCbCr" || image.magickColorspace === "OHTA" || image.magickColorspace === "YUV" || image.magickColorspace === "CIELab") && image.storedHueSamples !== undefined ? await storage.read(image.storedHueSamples + start * 8, bytes.length * 8) : undefined;
        const hueSamples = samples ? new Float64Array(samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength)) : undefined;
        for (let offset = 0; offset < bytes.length; offset += 4) {
            const pixel = (start + offset) / 4;
            if (srgbDepth) {
                yield srgbDepthEnumerationLine(pixel % image.width, Math.floor(pixel / image.width), (data16 ?? bytes).subarray(offset, offset + 4), image.hasAlpha, depth) + "\n";
                continue;
            }
            if ((image.magickColorspace === "HCL" || image.magickColorspace === "HCLp" || image.magickColorspace === "HSL" || image.magickColorspace === "HSB" || image.magickColorspace === "HSV" || image.magickColorspace === "HWB" || image.magickColorspace === "XYZ" || image.magickColorspace === "YCbCr" || image.magickColorspace === "OHTA" || image.magickColorspace === "YUV" || image.magickColorspace === "CIELab")) {
                yield `${pixel % image.width},${Math.floor(pixel / image.width)}: ${hueTextPixel(Array.from(data16?.subarray(offset, offset + 4) ?? bytes.subarray(offset, offset + 4), value => data16 ? value : value * 257), image.hasAlpha, image.magickColorspace, hueSamples ? Array.from(hueSamples.subarray(offset, offset + 4)) : undefined, maximum)}\n`;
                continue;
            }
            if (gray16) {
                yield gray16EnumerationLine(pixel % image.width, Math.floor(pixel / image.width), data16![offset]!, image.hasAlpha ? data16![offset + 3]! : undefined) + "\n";
                continue;
            }
            yield pixelEnumerationLine(pixel % image.width, Math.floor(pixel / image.width), bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!, colorspace) + "\n";
        }
    }
}
export async function* storedHistogram(image: StoredRgbaImage & HueMetadata, storage: PagedStorage, signal: AbortSignal): AsyncGenerator<string> {
    const hue = ["HCL", "HCLp", "HSL", "HSB", "HSV", "HWB", "XYZ", "YCbCr", "OHTA", "YUV", "CIELab"].includes(image.magickColorspace ?? "");
    const counts = new IntegerTable(storage, 512), order = hue ? new IntegerTable(storage, 128) : undefined, size = image.width * image.height * 4;
    const sampleOffsets = (image.magickColorspace === "HCL" || image.magickColorspace === "HCLp" || image.magickColorspace === "HSL" || image.magickColorspace === "HWB" || image.magickColorspace === "XYZ" || image.magickColorspace === "YCbCr" || image.magickColorspace === "OHTA" || image.magickColorspace === "YUV" || image.magickColorspace === "CIELab") && image.storedHueSamples !== undefined ? new IntegerTable(storage, 128) : undefined;
    let unique = 0;
    for (let start = 0; start < size; start += 16384) {
        await yieldTurn(signal);
        const bytes = await storage.read(image.position + start, Math.min(16384, size - start));
        const original = image.storedData16 ? await storage.read(image.storedData16.position + start * 2, bytes.length * 2) : undefined;
        const data16 = original ? new Uint16Array(original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength)) : undefined;
        for (let offset = 0; offset < bytes.length; offset += 4) {
            const key = (data16 || hue) ? Array.from(data16?.subarray(offset, offset + 4) ?? bytes.subarray(offset, offset + 4), value => BigInt(data16 ? value : value * 257)).reduce((key, value) => (key << 16n) | value, 0n) : BigInt(((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0), count = await counts.get(key);
            if (count === undefined) {
                if (sampleOffsets) await sampleOffsets.set(BigInt(unique), BigInt(start + offset));
                if (order) await order.set(BigInt(unique), key);
                unique++;
            }
            await counts.set(key, (count ?? 0n) + 1n);
        }
    }
    if (!hue) {
        let index = 0;
        for await (const [key, count] of counts.entries()) {
            if (index++ % 128 === 0) await yieldTurn(signal);
            yield histogramLine(image.storedData16 ? key : Number(key), Number(count), image.hasAlpha) + "\n";
        }
        if (!unique) yield "\n";
        return;
    }
    for (let index = 0; index < unique; index++) {
        if (index % 128 === 0) await yieldTurn(signal);
        const key = (await order!.get(BigInt(index)))!;
        const samples = sampleOffsets ? await storage.read(image.storedHueSamples! + Number(await sampleOffsets.get(BigInt(index))) * 8, 32) : undefined;
        const hueSamples = samples ? Array.from(new Float64Array(samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength))) : undefined;
        yield (image.magickColorspace === "HCL" || image.magickColorspace === "HCLp" || image.magickColorspace === "HSL" || image.magickColorspace === "HSB" || image.magickColorspace === "HSV" || image.magickColorspace === "HWB" || image.magickColorspace === "XYZ" || image.magickColorspace === "YCbCr" || image.magickColorspace === "OHTA" || image.magickColorspace === "YUV" || image.magickColorspace === "CIELab") ? `  ${Number(await counts.get(key))}: ${hueTextPixel([48n, 32n, 16n, 0n].map(shift => Number((key >> shift) & 65535n)), image.hasAlpha, image.magickColorspace, hueSamples)}\n` : histogramLine(Number(key), Number(await counts.get(key)), image.hasAlpha) + "\n";
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
