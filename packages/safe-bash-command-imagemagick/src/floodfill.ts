import { RasterBackingCache } from "./raster-backing.js";
import type { ImageByteStorage, RgbaColor, StoredRgbaImage } from "@poe-code/image-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

// ImageMagick's RGBA fuzzy equivalence: alpha distance plus RGB distance
// weighted by both opacities. Fully transparent RGB does not affect matching.
export function matchesAlphaFloodfill(r: number, g: number, b: number, a: number, refR: number, refG: number, refB: number, refA: number, fuzz: number, referenceFuzz = fuzz): boolean {
    return (a - refA) ** 2 + ((r - refR) ** 2 + (g - refG) ** 2 + (b - refB) ** 2) * (a / 255) * (refA / 255) / 3 <= fuzz ** 2 + referenceFuzz ** 2;
}

export async function floodfillStoredImage(image: StoredRgbaImage, storage: ImageByteStorage, seedX: number, seedY: number, target: RgbaColor | undefined, replacement: RgbaColor, fuzz: number, signal: AbortSignal, alphaOnly = false, channels?: readonly boolean[], fillToBorder = false): Promise<StoredRgbaImage> {
    const count = image.width * image.height, source = { position: image.storedData16?.position ?? image.position, length: count * (image.storedData16 ? 8 : 4) }, cache = new RasterBackingCache(storage, signal);
    const readPixel = async (index: number): Promise<readonly number[]> => {
        if (image.storedData16) {
            const rg = await cache.uint32(source, index * 8), ba = await cache.uint32(source, index * 8 + 4);
            return [(rg & 65535) / 257, (rg >>> 16) / 257, (ba & 65535) / 257, (ba >>> 16) / 257];
        }
        const pixel = await cache.uint32(source, index * 4);
        return [pixel & 255, pixel >>> 8 & 255, pixel >>> 16 & 255, pixel >>> 24];
    };
    const start = seedY * image.width + seedX, seed = await readPixel(start);
    const r = target ? target.r : seed[0]!, g = target ? target.g : seed[1]!, b = target ? target.b : seed[2]!;
    const a = (fillToBorder || !alphaOnly) && target ? target.a : seed[3]!;
    const matches = (pixel: readonly number[]) => fillToBorder !== matchesAlphaFloodfill(pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]!, r, g, b, a, fuzz, target ? 0 : fuzz);
    if (!matches(seed)) return replacement.a < 255 ? { ...image, hasAlpha: true } : image;
    const visited = await cache.allocate(count), stack = await cache.allocate(count * 4);
    let tail = 1;
    await cache.setUint32(stack, 0, start);
    await cache.mark(visited, start);
    while (tail > 0) {
        const current = await cache.uint32(stack, --tail * 4), x = current % image.width, y = Math.floor(current / image.width);
        for (const next of [y > 0 ? current - image.width : -1, y + 1 < image.height ? current + image.width : -1, x > 0 ? current - 1 : -1, x + 1 < image.width ? current + 1 : -1]) {
            if (next < 0 || await cache.byte(visited, next) || !matches(await readPixel(next))) continue;
            await cache.mark(visited, next);
            await cache.setUint32(stack, tail++ * 4, next);
        }
    }
    await cache.flush();
    const position = storage.allocate(count * 4);
    const paint = [replacement.r, replacement.g, replacement.b, replacement.a];
    const storedData16 = image.storedData16 || paint.some(value => !Number.isInteger(value))
        ? { position: storage.allocate(count * 8), length: count * 4 } : undefined;
    for (let start = 0; start < count; start += 1024) {
        await yieldTurn(signal);
        const length = Math.min(1024, count - start), pixels = new Uint8Array(await storage.read(image.position + start * 4, length * 4, { signal }));
        const flags = await storage.read(visited.position + start, length, { signal });
        if (pixels.length !== length * 4 || flags.length !== length) throw new Error("Truncated floodfill pixels");
        const bytes16 = image.storedData16 ? await storage.read(image.storedData16.position + start * 8, length * 8, { signal }) : undefined;
        if (bytes16 && bytes16.length !== length * 8) throw new Error("Truncated floodfill pixels");
        const data16 = bytes16 ? new Uint16Array(new Uint8Array(bytes16).buffer)
            : storedData16 ? Uint16Array.from(pixels, value => value * 257) : undefined;
        for (let i = 0; i < length; i++) if (flags[i]) {
            for (let channel = alphaOnly ? 3 : 0; channel < 4; channel++) {
                if (channels && !channels[channel]) continue;
                const offset = i * 4 + channel;
                if (data16) data16[offset] = Math.round(paint[channel]! * 257);
                pixels[offset] = Math.round(data16 ? data16[offset]! / 257 : paint[channel]!);
            }
        }
        await storage.write(position + start * 4, pixels, { signal });
        if (data16) await storage.write(storedData16!.position + start * 8, new Uint8Array(data16.buffer), { signal });
    }
    return { ...image, position, ...(storedData16 ? { storedData16 } : {}), hasAlpha: true };
}
