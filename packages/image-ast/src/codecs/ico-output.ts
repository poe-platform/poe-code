import { BmpPalette } from "./bmp-palette.js";
import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";

function payloadSize(image: Pick<RgbaImage, "width" | "height">, depth = 32): number {
    if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width > 512 || image.height > 512) throw new Error("ICO dimensions must be between 1 and 512");
    return 40 + (depth <= 8 ? 4 * 2 ** depth : 0) + Math.ceil(image.width * depth / 32) * 4 * image.height + Math.ceil(image.width / 32) * 4 * image.height;
}
function directory(count: number): Uint8Array {
    if (count < 1 || count > 65535) throw new Error("ICO requires between 1 and 65535 images");
    const bytes = new Uint8Array(6 + count * 16), view = new DataView(bytes.buffer);
    view.setUint16(2, 1, true); view.setUint16(4, count, true);
    return bytes;
}
function entry(bytes: Uint8Array, index: number, image: Pick<RgbaImage, "width" | "height">, offset: number, depth = 32): number {
    const size = payloadSize(image, depth), p = 6 + index * 16, view = new DataView(bytes.buffer);
    if (offset + size > 0xffffffff) throw new Error("ICO output exceeds 32-bit offsets");
    bytes[p] = image.width % 256; bytes[p + 1] = image.height % 256;
    bytes[p + 2] = depth < 8 ? 2 ** depth : 0;
    view.setUint16(p + 4, 1, true); view.setUint16(p + 6, depth, true);
    view.setUint32(p + 8, size, true); view.setUint32(p + 12, offset, true);
    return offset + size;
}
function dib(image: Pick<RgbaImage, "width" | "height">, depth = 32): Uint8Array {
    const bytes = new Uint8Array(40), view = new DataView(bytes.buffer);
    view.setUint32(0, 40, true); view.setInt32(4, image.width, true); view.setInt32(8, image.height * 2, true);
    view.setUint16(12, 1, true); view.setUint16(14, depth, true);
    view.setUint32(20, payloadSize(image, depth) - 40 - (depth <= 8 ? 4 * 2 ** depth : 0), true);
    return bytes;
}
function row(rgba: Uint8Array, alpha: boolean, palette?: BmpPalette): Uint8Array {
    if (palette) {
        const depth = palette.depth, bytes = new Uint8Array(Math.ceil(rgba.length / 4 * depth / 32) * 4);
        for (let x = 0; x < rgba.length / 4; x++) {
            const index = palette.index(rgba[x * 4]!, rgba[x * 4 + 1]!, rgba[x * 4 + 2]!);
            bytes[Math.floor(x * depth / 8)]! |= index << (8 - depth - x * depth % 8);
        }
        return bytes;
    }
    const bytes = new Uint8Array(rgba.length);
    for (let p = 0; p < rgba.length; p += 4) {
        bytes[p] = rgba[p + 2]!; bytes[p + 1] = rgba[p + 1]!; bytes[p + 2] = rgba[p]!; bytes[p + 3] = alpha ? rgba[p + 3]! : 255;
    }
    return bytes;
}
function mask(rgba: Uint8Array, alpha: boolean): Uint8Array {
    const bytes = new Uint8Array(Math.ceil(rgba.length / 4 / 32) * 4);
    if (alpha) for (let x = 0; x < rgba.length / 4; x++) if (rgba[x * 4 + 3] === 0) bytes[x >> 3]! |= 128 >> (x % 8);
    return bytes;
}
export function encodeIcoImage(image: RgbaImage): Uint8Array {
    const pages = image.icoPages ?? [image], header = directory(pages.length);
    const palettes = pages.map(page => {
        let palette = page.isPalette && !page.hasAlpha ? new BmpPalette(false) : undefined;
        if (palette) for (let p = 0; p < page.data.length; p += 4) {
            if (!palette.add(page.data[p]!, page.data[p + 1]!, page.data[p + 2]!, 255)) { palette = undefined; break; }
        }
        return palette;
    });
    let size = header.length;
    pages.forEach((page, index) => { size = entry(header, index, page, size, palettes[index]?.depth); });
    const bytes = new Uint8Array(size); bytes.set(header);
    let offset = header.length;
    for (const [index, page] of pages.entries()) {
        const palette = palettes[index];
        bytes.set(dib(page, palette?.depth), offset); offset += 40;
        if (palette) { const colors = palette.bytes(4); bytes.set(colors, offset); offset += colors.length; }
        for (const andMask of [false, true]) for (let y = page.height - 1; y >= 0; y--) {
            const rgba = page.data.subarray(y * page.width * 4, (y + 1) * page.width * 4);
            const data = andMask ? mask(rgba, page.hasAlpha) : row(rgba, page.hasAlpha, palette);
            bytes.set(data, offset); offset += data.length;
        }
    }
    return bytes;
}
export async function* encodeIcoFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    const count = image.storedIcoPages?.length ?? 1, header = directory(count);
    const palettes: (BmpPalette | undefined)[] = [];
    let offset = header.length;
    for (let i = 0; i < count; i++) {
        signal.throwIfAborted();
        const page = image.storedIcoPages ? await image.storedIcoPages.at(i) : image;
        payloadSize(page);
        let palette = page.isPalette && !page.hasAlpha ? new BmpPalette(false) : undefined;
        if (palette) for (let y = 0; y < page.height && palette; y++) {
            signal.throwIfAborted();
            const rgba = await storage.read(page.position + y * page.width * 4, page.width * 4, { signal });
            if (rgba.length !== page.width * 4) throw new Error("Truncated ICO pixel storage");
            for (let p = 0; p < rgba.length; p += 4) {
                if (!palette.add(rgba[p]!, rgba[p + 1]!, rgba[p + 2]!, 255)) { palette = undefined; break; }
            }
        }
        palettes.push(palette);
        offset = entry(header, i, page, offset, palette?.depth);
    }
    yield header;
    for (let i = 0; i < count; i++) {
        signal.throwIfAborted();
        const page = image.storedIcoPages ? await image.storedIcoPages.at(i) : image;
        const palette = palettes[i];
        yield dib(page, palette?.depth);
        if (palette) yield palette.bytes(4);
        for (const andMask of [false, true]) for (let y = page.height - 1; y >= 0; y--) {
            signal.throwIfAborted();
            const rgba = await storage.read(page.position + y * page.width * 4, page.width * 4, { signal });
            if (rgba.length !== page.width * 4) throw new Error("Truncated ICO pixel storage");
            yield andMask ? mask(rgba, page.hasAlpha) : row(rgba, page.hasAlpha, palette);
        }
    }
}
