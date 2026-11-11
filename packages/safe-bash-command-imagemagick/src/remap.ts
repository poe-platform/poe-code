import type { ImageByteStorage, StoredRgbaImage } from "@poe-code/image-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { RasterBackingCache } from "./raster-backing.js";

// Interleaved RGB bits give the native octree traversal order (R, G, B
// have child weights 1, 2, 4). Native chooses the last equal-distance color.
export function remapColorOrder(r: number, g: number, b: number): number {
    let order = 0;
    for (let bit = 7; bit >= 0; bit--) {
        order = order * 8 + ((r >>> bit & 1) | (g >>> bit & 1) << 1 | (b >>> bit & 1) << 2);
    }
    return order;
}

export async function remapStoredImage(image: StoredRgbaImage, paletteImage: StoredRgbaImage, storage: ImageByteStorage, dither: boolean, diffusionAmount: number, signal: AbortSignal): Promise<StoredRgbaImage> {
    const palette: number[][] = [], seen = new Set<string>();
    for (let offset = 0; offset < paletteImage.width * paletteImage.height * 4; offset += 4096) {
        await yieldTurn(signal);
        const length = Math.min(4096, paletteImage.width * paletteImage.height * 4 - offset), bytes = await storage.read((paletteImage.storedData16?.position ?? paletteImage.position) + offset * (paletteImage.storedData16 ? 2 : 1), length * (paletteImage.storedData16 ? 2 : 1), { signal });
        if (bytes.length !== length * (paletteImage.storedData16 ? 2 : 1)) throw new Error("Truncated remap palette");
        const samples = paletteImage.storedData16 ? Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257) : bytes;
        for (let i = 0; i < length; i += 4) {
            const color = Array.from(samples.subarray(i, i + 4));
            // Native palette classification discards RGB at zero alpha.
            if (paletteImage.hasAlpha && color[3] === 0) color.fill(0, 0, 3);
            const key = color.join(",");
            if (!seen.has(key)) { seen.add(key); palette.push(color); }
        }
    }
    if (!palette.length) return image;
    palette.sort((a, b) => remapColorOrder(b[0]!, b[1]!, b[2]!) - remapColorOrder(a[0]!, a[1]!, a[2]!));
    const count = image.width * image.height, cache = new RasterBackingCache(storage, signal);
    const errors = dither ? { position: storage.allocate(count * 16), length: count * 16 } : undefined;
    if (errors) for (let start = 0; start < count; start += 1024) {
        await yieldTurn(signal);
        const length = Math.min(1024, count - start), pixels = await storage.read(image.position + start * 4, length * 4, { signal });
        if (pixels.length !== length * 4) throw new Error("Truncated remap pixels");
        const bytes = new Uint8Array(length * 16), view = new DataView(bytes.buffer);
        for (let i = 0; i < length; i++) for (let c = 0; c < 4; c++) {
            const alpha = paletteImage.hasAlpha && c < 3 ? pixels[i * 4 + 3]! / 255 : 1;
            view.setFloat32(i * 16 + c * 4, pixels[i * 4 + c]! * alpha, true);
        }
        await storage.write(errors.position + start * 16, bytes, { signal });
    }
    const position = storage.allocate(count * 4);
    const storedData16 = (image.storedData16 || paletteImage.storedData16) ? { position: storage.allocate(count * 8), length: count * 4 } : undefined;
    for (let scanned = 0; scanned < count;) {
        await yieldTurn(signal);
        const y = Math.floor(scanned / image.width), column = scanned % image.width;
        const direction = dither && y % 2 !== 0 ? -1 : 1;
        const length = Math.min(1024, dither ? image.width - column : count - scanned);
        const start = y * image.width + (direction === 1 ? column : image.width - column - length);
        const pixels = new Uint8Array(await storage.read(image.position + start * 4, length * 4, { signal }));
        if (pixels.length !== length * 4) throw new Error("Truncated remap pixels");
        const samples = storedData16 ? new Uint16Array(length * 4) : undefined;
        for (let step = 0; step < length; step++) {
            const i = direction === 1 ? step : length - 1 - step;
            const current = start + i, offset = i * 4;
            const inputAlpha = paletteImage.hasAlpha ? pixels[offset + 3]! / 255 : 1;
            const r = errors ? Math.max(0, Math.min(255, await cache.float32(errors, current * 16))) : pixels[offset]! * inputAlpha;
            const g = errors ? Math.max(0, Math.min(255, await cache.float32(errors, current * 16 + 4))) : pixels[offset + 1]! * inputAlpha;
            const b = errors ? Math.max(0, Math.min(255, await cache.float32(errors, current * 16 + 8))) : pixels[offset + 2]! * inputAlpha;
            const a = errors ? Math.max(0, Math.min(255, await cache.float32(errors, current * 16 + 12))) : pixels[offset + 3]!;
            const alpha = paletteImage.hasAlpha ? a / 255 : 1;
            let best = palette[0]!, distance = Infinity;
            for (const color of palette) {
                const beta = paletteImage.hasAlpha ? color[3]! / 255 : 1;
                const next = (r * alpha - color[0]! * beta) ** 2 + (g * alpha - color[1]! * beta) ** 2 + (b * alpha - color[2]! * beta) ** 2 + (a - color[3]!) ** 2;
                if (next < distance) { best = color; distance = next; }
            }
            for (let c = 0; c < 4; c++) {
                pixels[offset + c] = Math.round(best[c]!);
                if (samples) samples[offset + c] = Math.round(best[c]! * 257);
            }
            if (errors) {
                const selectedAlpha = paletteImage.hasAlpha ? best[3]! / 255 : 1;
                const x = current % image.width, y = Math.floor(current / image.width);
                const spread = async (nx: number, ny: number, weight: number) => {
                    if (nx < 0 || nx >= image.width || ny >= image.height) return;
                    const next = (ny * image.width + nx) * 16;
                    weight *= diffusionAmount;
                    await cache.setFloat32(errors, next, await cache.float32(errors, next) + (r - best[0]! * selectedAlpha) * weight);
                    await cache.setFloat32(errors, next + 4, await cache.float32(errors, next + 4) + (g - best[1]! * selectedAlpha) * weight);
                    await cache.setFloat32(errors, next + 8, await cache.float32(errors, next + 8) + (b - best[2]! * selectedAlpha) * weight);
                    await cache.setFloat32(errors, next + 12, await cache.float32(errors, next + 12) + (a - best[3]!) * weight);
                };
                await spread(x + direction, y, 7 / 16);
                await spread(x - direction, y + 1, 3 / 16);
                await spread(x, y + 1, 5 / 16);
                await spread(x + direction, y + 1, 1 / 16);
            }
        }
        await storage.write(position + start * 4, pixels, { signal });
        if (storedData16 && samples) {
            await storage.write(storedData16.position + start * 8, new Uint8Array(samples.buffer), { signal });
        }
        scanned += length;
    }
    const { pngPalette: ignoredPalette, storedPngIndices: ignoredIndices, ...metadata } = image;
    // Search visits the last octree entry first for ties; cycling uses tree order.
    const indexedColors = palette.reverse().map(color => Math.round(color[3]!) * 16777216 + Math.round(color[0]!) * 65536 + Math.round(color[1]!) * 256 + Math.round(color[2]!));
    return { ...metadata, position, indexedColors, isPalette: true, ...(storedData16 ? { storedData16 } : {}) };
}
