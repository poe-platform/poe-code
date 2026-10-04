import type { ImageByteStorage, StoredRgbaImage } from "@poe-code/image-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { RasterBackingCache } from "./raster-backing.js";

export async function remapStoredImage(image: StoredRgbaImage, paletteImage: StoredRgbaImage, storage: ImageByteStorage, dither: boolean, signal: AbortSignal): Promise<StoredRgbaImage> {
    const palette: number[] = [], seen = new Set<number>();
    for (let offset = 0; offset < paletteImage.width * paletteImage.height * 4 && palette.length < 256; offset += 4096) {
        await yieldTurn(signal);
        const length = Math.min(4096, paletteImage.width * paletteImage.height * 4 - offset), bytes = await storage.read(paletteImage.position + offset, length, { signal });
        if (bytes.length !== length) throw new Error("Truncated remap palette");
        for (let i = 0; i < length && palette.length < 256; i += 4) {
            const key = bytes[i]! << 16 | bytes[i + 1]! << 8 | bytes[i + 2]!;
            if (!seen.has(key)) { seen.add(key); palette.push(key); }
        }
    }
    if (!palette.length) return image;
    const count = image.width * image.height, cache = new RasterBackingCache(storage, signal);
    const errors = dither ? { position: storage.allocate(count * 12), length: count * 12 } : undefined;
    if (errors) for (let start = 0; start < count; start += 1024) {
        await yieldTurn(signal);
        const length = Math.min(1024, count - start), pixels = await storage.read(image.position + start * 4, length * 4, { signal });
        if (pixels.length !== length * 4) throw new Error("Truncated remap pixels");
        const bytes = new Uint8Array(length * 12), view = new DataView(bytes.buffer);
        for (let i = 0; i < length; i++) for (let c = 0; c < 3; c++) view.setFloat32(i * 12 + c * 4, pixels[i * 4 + c]!, true);
        await storage.write(errors.position + start * 12, bytes, { signal });
    }
    const position = storage.allocate(count * 4);
    for (let start = 0; start < count; start += 1024) {
        await yieldTurn(signal);
        const length = Math.min(1024, count - start), pixels = new Uint8Array(await storage.read(image.position + start * 4, length * 4, { signal }));
        if (pixels.length !== length * 4) throw new Error("Truncated remap pixels");
        for (let i = 0; i < length; i++) {
            const current = start + i, offset = i * 4;
            const r = errors ? Math.max(0, Math.min(255, await cache.float32(errors, current * 12))) : pixels[offset]!;
            const g = errors ? Math.max(0, Math.min(255, await cache.float32(errors, current * 12 + 4))) : pixels[offset + 1]!;
            const b = errors ? Math.max(0, Math.min(255, await cache.float32(errors, current * 12 + 8))) : pixels[offset + 2]!;
            let best = palette[0]!, distance = Infinity;
            for (const color of palette) {
                const next = (r - (color >>> 16)) ** 2 + (g - (color >>> 8 & 255)) ** 2 + (b - (color & 255)) ** 2;
                if (next < distance) { best = color; distance = next; }
            }
            pixels[offset] = best >>> 16; pixels[offset + 1] = best >>> 8 & 255; pixels[offset + 2] = best & 255;
            if (errors) {
                const x = current % image.width, y = Math.floor(current / image.width);
                const spread = async (nx: number, ny: number, weight: number) => {
                    if (nx < 0 || nx >= image.width || ny >= image.height) return;
                    const next = (ny * image.width + nx) * 12;
                    await cache.setFloat32(errors, next, await cache.float32(errors, next) + (r - pixels[offset]!) * weight);
                    await cache.setFloat32(errors, next + 4, await cache.float32(errors, next + 4) + (g - pixels[offset + 1]!) * weight);
                    await cache.setFloat32(errors, next + 8, await cache.float32(errors, next + 8) + (b - pixels[offset + 2]!) * weight);
                };
                await spread(x + 1, y, 7 / 16);
                await spread(x - 1, y + 1, 3 / 16);
                await spread(x, y + 1, 5 / 16);
                await spread(x + 1, y + 1, 1 / 16);
            }
        }
        await storage.write(position + start * 4, pixels, { signal });
    }
    return { ...image, position };
}
