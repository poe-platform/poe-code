import { RasterBackingCache } from "./raster-backing.js";
import type { ImageByteStorage, RgbaColor, StoredRgbaImage } from "@poe-code/image-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export async function floodfillStoredImage(image: StoredRgbaImage, storage: ImageByteStorage, seedX: number, seedY: number, target: RgbaColor | undefined, replacement: RgbaColor, fuzz: number, signal: AbortSignal): Promise<StoredRgbaImage> {
    const count = image.width * image.height, source = { position: image.position, length: count * 4 }, cache = new RasterBackingCache(storage, signal);
    const start = seedY * image.width + seedX, seed = await cache.uint32(source, start * 4);
    const r = target ? target.r : seed & 255, g = target ? target.g : seed >>> 8 & 255, b = target ? target.b : seed >>> 16 & 255;
    const matches = (pixel: number) => Math.max(Math.abs((pixel & 255) - r), Math.abs((pixel >>> 8 & 255) - g), Math.abs((pixel >>> 16 & 255) - b)) <= fuzz;
    if (!matches(seed)) return image;
    const visited = await cache.allocate(count), stack = await cache.allocate(count * 4);
    let tail = 1;
    await cache.setUint32(stack, 0, start);
    await cache.mark(visited, start);
    while (tail > 0) {
        const current = await cache.uint32(stack, --tail * 4), x = current % image.width, y = Math.floor(current / image.width);
        for (const next of [y > 0 ? current - image.width : -1, y + 1 < image.height ? current + image.width : -1, x > 0 ? current - 1 : -1, x + 1 < image.width ? current + 1 : -1]) {
            if (next < 0 || await cache.byte(visited, next) || !matches(await cache.uint32(source, next * 4))) continue;
            await cache.mark(visited, next);
            await cache.setUint32(stack, tail++ * 4, next);
        }
    }
    await cache.flush();
    const position = storage.allocate(count * 4);
    for (let start = 0; start < count; start += 1024) {
        await yieldTurn(signal);
        const length = Math.min(1024, count - start), pixels = new Uint8Array(await storage.read(image.position + start * 4, length * 4, { signal }));
        const flags = await storage.read(visited.position + start, length, { signal });
        if (pixels.length !== length * 4 || flags.length !== length) throw new Error("Truncated floodfill pixels");
        for (let i = 0; i < length; i++) if (flags[i]) {
            pixels[i * 4] = replacement.r; pixels[i * 4 + 1] = replacement.g; pixels[i * 4 + 2] = replacement.b; pixels[i * 4 + 3] = replacement.a;
        }
        await storage.write(position + start * 4, pixels, { signal });
    }
    return { ...image, position, hasAlpha: true };
}
