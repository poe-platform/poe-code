import type { ImageByteStorage, RgbaColor, StoredRgbaImage } from "@poe-code/image-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

interface Region { position: number; length: number }
interface Page { position: number; bytes: Uint8Array; view: DataView; dirty: boolean }

/** The source, visited bitmap and traversal stack share a fixed working set. */
class FloodfillCache {
    private readonly pages = new Map<string, Page>();
    private work = 0;
    constructor(private readonly storage: ImageByteStorage, private readonly signal: AbortSignal) {}
    async allocate(length: number): Promise<Region> {
        const region = { position: this.storage.allocate(length), length }, zero = new Uint8Array(Math.min(4096, length));
        for (let offset = 0; offset < length; offset += zero.length) {
            if (offset % 65536 === 0) await yieldTurn(this.signal);
            await this.storage.write(region.position + offset, zero.subarray(0, Math.min(zero.length, length - offset)), { signal: this.signal });
        }
        return region;
    }
    private async page(region: Region, offset: number): Promise<Page> {
        this.signal.throwIfAborted();
        if (++this.work % 16384 === 0) await yieldTurn(this.signal);
        const start = Math.floor(offset / 4096) * 4096, key = region.position + ":" + start;
        let page = this.pages.get(key);
        if (page) { this.pages.delete(key); this.pages.set(key, page); return page; }
        if (this.pages.size === 32) {
            const oldest = this.pages.entries().next().value!;
            if (oldest[1].dirty) await this.storage.write(oldest[1].position, oldest[1].bytes, { signal: this.signal });
            this.pages.delete(oldest[0]);
        }
        const length = Math.min(4096, region.length - start), borrowed = await this.storage.read(region.position + start, length, { signal: this.signal });
        if (borrowed.length !== length) throw new Error("Truncated floodfill backing");
        const bytes = new Uint8Array(borrowed);
        page = { position: region.position + start, bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), dirty: false };
        this.pages.set(key, page);
        return page;
    }
    async byte(region: Region, offset: number): Promise<number> { return (await this.page(region, offset)).bytes[offset % 4096]!; }
    async mark(region: Region, offset: number): Promise<void> {
        const page = await this.page(region, offset); page.bytes[offset % 4096] = 1; page.dirty = true;
    }
    async uint32(region: Region, offset: number): Promise<number> { return (await this.page(region, offset)).view.getUint32(offset % 4096, true); }
    async setUint32(region: Region, offset: number, value: number): Promise<void> {
        const page = await this.page(region, offset); page.view.setUint32(offset % 4096, value, true); page.dirty = true;
    }
    async flush(): Promise<void> {
        for (const page of this.pages.values()) {
            this.signal.throwIfAborted();
            if (page.dirty) { await this.storage.write(page.position, page.bytes, { signal: this.signal }); page.dirty = false; }
        }
    }
}

export async function floodfillStoredImage(image: StoredRgbaImage, storage: ImageByteStorage, seedX: number, seedY: number, target: RgbaColor | undefined, replacement: RgbaColor, fuzz: number, signal: AbortSignal): Promise<StoredRgbaImage> {
    const count = image.width * image.height, source = { position: image.position, length: count * 4 }, cache = new FloodfillCache(storage, signal);
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
