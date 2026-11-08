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
    const palette: number[] = [], seen = new Set<number>();
    for (let offset = 0; offset < paletteImage.width * paletteImage.height * 4; offset += 4096) {
        await yieldTurn(signal);
        const length = Math.min(4096, paletteImage.width * paletteImage.height * 4 - offset), bytes = await storage.read(paletteImage.position + offset, length, { signal });
        if (bytes.length !== length) throw new Error("Truncated remap palette");
        for (let i = 0; i < length; i += 4) {
            const key = bytes[i]! << 24 | bytes[i + 1]! << 16 | bytes[i + 2]! << 8 | bytes[i + 3]!;
            if (!seen.has(key)) { seen.add(key); palette.push(key); }
        }
    }
    if (!palette.length) return image;
    palette.sort((a, b) => remapColorOrder(b >>> 24, b >>> 16 & 255, b >>> 8 & 255) - remapColorOrder(a >>> 24, a >>> 16 & 255, a >>> 8 & 255));
    const count = image.width * image.height, cache = new RasterBackingCache(storage, signal);
    const errors = dither ? { position: storage.allocate(count * 16), length: count * 16 } : undefined;
    if (errors) for (let start = 0; start < count; start += 1024) {
        await yieldTurn(signal);
        const length = Math.min(1024, count - start), pixels = await storage.read(image.position + start * 4, length * 4, { signal });
        if (pixels.length !== length * 4) throw new Error("Truncated remap pixels");
        const bytes = new Uint8Array(length * 16), view = new DataView(bytes.buffer);
        for (let i = 0; i < length; i++) for (let c = 0; c < 4; c++) view.setFloat32(i * 16 + c * 4, pixels[i * 4 + c]!, true);
        await storage.write(errors.position + start * 16, bytes, { signal });
    }
    const position = storage.allocate(count * 4);
    const storedData16 = image.storedData16 ? { position: storage.allocate(count * 8), length: count * 4 } : undefined;
    for (let scanned = 0; scanned < count;) {
        await yieldTurn(signal);
        const y = Math.floor(scanned / image.width), column = scanned % image.width;
        const direction = dither && y % 2 !== 0 ? -1 : 1;
        const length = Math.min(1024, dither ? image.width - column : count - scanned);
        const start = y * image.width + (direction === 1 ? column : image.width - column - length);
        const pixels = new Uint8Array(await storage.read(image.position + start * 4, length * 4, { signal }));
        if (pixels.length !== length * 4) throw new Error("Truncated remap pixels");
        for (let step = 0; step < length; step++) {
            const i = direction === 1 ? step : length - 1 - step;
            const current = start + i, offset = i * 4;
            const r = errors ? Math.max(0, Math.min(255, await cache.float32(errors, current * 16))) : pixels[offset]!;
            const g = errors ? Math.max(0, Math.min(255, await cache.float32(errors, current * 16 + 4))) : pixels[offset + 1]!;
            const b = errors ? Math.max(0, Math.min(255, await cache.float32(errors, current * 16 + 8))) : pixels[offset + 2]!;
            const a = errors ? Math.max(0, Math.min(255, await cache.float32(errors, current * 16 + 12))) : pixels[offset + 3]!;
            let best = palette[0]!, distance = Infinity;
            for (const color of palette) {
                const next = (r - (color >>> 24)) ** 2 + (g - (color >>> 16 & 255)) ** 2 + (b - (color >>> 8 & 255)) ** 2 + (a - (color & 255)) ** 2;
                if (next < distance) { best = color; distance = next; }
            }
            pixels[offset] = best >>> 24; pixels[offset + 1] = best >>> 16 & 255; pixels[offset + 2] = best >>> 8 & 255; pixels[offset + 3] = best & 255;
            if (errors) {
                const x = current % image.width, y = Math.floor(current / image.width);
                const spread = async (nx: number, ny: number, weight: number) => {
                    if (nx < 0 || nx >= image.width || ny >= image.height) return;
                    const next = (ny * image.width + nx) * 16;
                    weight *= diffusionAmount;
                    await cache.setFloat32(errors, next, await cache.float32(errors, next) + (r - pixels[offset]!) * weight);
                    await cache.setFloat32(errors, next + 4, await cache.float32(errors, next + 4) + (g - pixels[offset + 1]!) * weight);
                    await cache.setFloat32(errors, next + 8, await cache.float32(errors, next + 8) + (b - pixels[offset + 2]!) * weight);
                    await cache.setFloat32(errors, next + 12, await cache.float32(errors, next + 12) + (a - pixels[offset + 3]!) * weight);
                };
                await spread(x + direction, y, 7 / 16);
                await spread(x - direction, y + 1, 3 / 16);
                await spread(x, y + 1, 5 / 16);
                await spread(x + direction, y + 1, 1 / 16);
            }
        }
        await storage.write(position + start * 4, pixels, { signal });
        if (storedData16) {
            const samples = Uint16Array.from(pixels, value => value * 257);
            await storage.write(storedData16.position + start * 8, new Uint8Array(samples.buffer), { signal });
        }
        scanned += length;
    }
    return { ...image, position, ...(storedData16 ? { storedData16 } : {}) };
}
