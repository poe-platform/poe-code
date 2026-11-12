import { rgbToCmyk } from "./colorspace-cmyk.js";
import { paintWorkingPixel } from "./paint-working.js";
import type { HueMetadata } from "./colorspace-hue.js";
import { RasterBackingCache } from "./raster-backing.js";
import type { ImageByteStorage, RgbaColor, StoredRgbaImage } from "@poe-code/image-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

// ImageMagick's RGBA fuzzy equivalence: alpha distance plus RGB distance
// weighted by both opacities. Fully transparent RGB does not affect matching.
export function matchesAlphaFloodfill(r: number, g: number, b: number, a: number, refR: number, refG: number, refB: number, refA: number, fuzz: number, referenceFuzz = fuzz): boolean {
    return (a - refA) ** 2 + ((r - refR) ** 2 + (g - refG) ** 2 + (b - refB) ** 2) * (a / 255) * (refA / 255) / 3 <= fuzz ** 2 + referenceFuzz ** 2;
}

export async function floodfillStoredImage(image: StoredRgbaImage & HueMetadata, storage: ImageByteStorage, seedX: number, seedY: number, target: (Omit<RgbaColor, "a"> & { a?: number | undefined; cmyk?: readonly number[] }) | undefined, replacement: RgbaColor, fuzz: number, signal: AbortSignal, alphaOnly = false, channels?: readonly boolean[], fillToBorder = false): Promise<StoredRgbaImage & HueMetadata> {
    if (!alphaOnly && (image.space === "b-w" || image.space === "grey16"))
        image = { ...image, space: "srgb", channels: image.hasAlpha ? 4 : 3 };
    const count = image.width * image.height, source = { position: image.storedData16?.position ?? image.position, length: count * (image.storedData16 ? 8 : 4) }, cache = new RasterBackingCache(storage, signal);
    const inks = image.space === "cmyk" && image.storedHueSamples !== undefined ? { position: image.storedHueSamples, length: count * 32 } : undefined;
    const readPixel = async (index: number): Promise<readonly number[]> => {
        let rgba: number[];
        if (image.storedData16) {
            const rg = await cache.uint32(source, index * 8), ba = await cache.uint32(source, index * 8 + 4);
            rgba = [(rg & 65535) / 257, (rg >>> 16) / 257, (ba & 65535) / 257, (ba >>> 16) / 257];
        } else {
            const pixel = await cache.uint32(source, index * 4);
            rgba = [pixel & 255, pixel >>> 8 & 255, pixel >>> 16 & 255, pixel >>> 24];
        }
        if (image.space !== "cmyk") return rgba;
        const cmyk = inks ? [await cache.float64(inks, index * 32), await cache.float64(inks, index * 32 + 8), await cache.float64(inks, index * 32 + 16), await cache.float64(inks, index * 32 + 24)]
            : rgbToCmyk(rgba[0]! / 255, rgba[1]! / 255, rgba[2]! / 255);
        return [cmyk[0]! * 255, cmyk[1]! * 255, cmyk[2]! * 255, rgba[3]!, cmyk[3]! * 255];
    };
    const start = seedY * image.width + seedX, seed = await readPixel(start);
    const targetChannels = image.space === "cmyk" && target?.cmyk ? target.cmyk.map(value => value * 255)
        : target ? [target.r, target.g, target.b, 0] : undefined;
    const r = targetChannels ? targetChannels[0]! : seed[0]!, g = targetChannels ? targetChannels[1]! : seed[1]!, b = targetChannels ? targetChannels[2]! : seed[2]!;
    const k = targetChannels ? targetChannels[3]! : seed[4]!;
    // Draw filltoborder supplies border RGB while retaining the seed opacity.
    const a = ((fillToBorder || !alphaOnly) ? target?.a : undefined) ?? seed[3]!;
    const matches = (pixel: readonly number[]) => fillToBorder !== ((image.space !== "cmyk" || (pixel[4]! - k) ** 2 <= fuzz ** 2 + (target ? 0 : fuzz ** 2)) && matchesAlphaFloodfill(pixel[0]!, pixel[1]!, pixel[2]!, image.hasAlpha ? pixel[3]! : 255, r, g, b, image.hasAlpha ? a : 255, fuzz, target ? 0 : fuzz));
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
    const storedHueSamples = image.storedHueSamples === undefined ? undefined : storage.allocate(count * 32);
    const storedEvaluateSamples = image.storedEvaluateSamples === undefined ? undefined : storage.allocate(count * 32);
    for (let start = 0; start < count; start += 1024) {
        await yieldTurn(signal);
        const length = Math.min(1024, count - start), pixels = new Uint8Array(await storage.read(image.position + start * 4, length * 4, { signal }));
        const flags = await storage.read(visited.position + start, length, { signal });
        if (pixels.length !== length * 4 || flags.length !== length) throw new Error("Truncated floodfill pixels");
        const bytes16 = image.storedData16 ? await storage.read(image.storedData16.position + start * 8, length * 8, { signal }) : undefined;
        if (bytes16 && bytes16.length !== length * 8) throw new Error("Truncated floodfill pixels");
        const data16 = bytes16 ? new Uint16Array(new Uint8Array(bytes16).buffer)
            : storedData16 ? Uint16Array.from(pixels, value => value * 257) : undefined;
        const hue = image.storedHueSamples === undefined ? undefined : new Float64Array((await storage.read(image.storedHueSamples + start * 32, length * 32, { signal })).slice().buffer);
        const evaluate = image.storedEvaluateSamples === undefined ? undefined : new Float64Array((await storage.read(image.storedEvaluateSamples + start * 32, length * 32, { signal })).slice().buffer);
        for (let i = 0; i < length; i++) if (flags[i]) {
            paintWorkingPixel(data16 ?? pixels, i * 4, data16 ? 257 : 1, replacement, image.space === "cmyk", hue, evaluate, alphaOnly, channels);
            if (data16) for (let channel = 0; channel < 4; channel++) pixels[i * 4 + channel] = Math.round(data16[i * 4 + channel]! / 257);
        }
        if (hue) await storage.write(storedHueSamples! + start * 32, new Uint8Array(hue.buffer), { signal });
        if (evaluate) await storage.write(storedEvaluateSamples! + start * 32, new Uint8Array(evaluate.buffer), { signal });
        await storage.write(position + start * 4, pixels, { signal });
        if (data16) await storage.write(storedData16!.position + start * 8, new Uint8Array(data16.buffer), { signal });
    }
    return { ...image, position, ...(storedHueSamples === undefined ? {} : { storedHueSamples }), ...(storedEvaluateSamples === undefined ? {} : { storedEvaluateSamples }), ...(storedData16 ? { storedData16 } : {}), hasAlpha: true };
}
