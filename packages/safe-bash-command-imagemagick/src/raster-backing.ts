import type { ImageByteStorage } from "@poe-code/image-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export interface RasterRegion { position: number; length: number }
interface Page { position: number; bytes: Uint8Array; view: DataView; dirty: boolean }

/** Caller-backed raster state shares a fixed working set, independent of image dimensions. */
export class RasterBackingCache {
    private readonly pages = new Map<string, Page>();
    private work = 0;
    constructor(private readonly storage: ImageByteStorage, private readonly signal: AbortSignal) {}
    async allocate(length: number): Promise<RasterRegion> {
        const region = { position: this.storage.allocate(length), length }, zero = new Uint8Array(Math.min(4096, length));
        for (let offset = 0; offset < length; offset += zero.length) {
            if (offset % 65536 === 0) await yieldTurn(this.signal);
            await this.storage.write(region.position + offset, zero.subarray(0, Math.min(zero.length, length - offset)), { signal: this.signal });
        }
        return region;
    }
    private async page(region: RasterRegion, offset: number): Promise<Page> {
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
        if (borrowed.length !== length) throw new Error("Truncated raster backing");
        const bytes = new Uint8Array(borrowed);
        page = { position: region.position + start, bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), dirty: false };
        this.pages.set(key, page);
        return page;
    }
    async byte(region: RasterRegion, offset: number): Promise<number> { return (await this.page(region, offset)).bytes[offset % 4096]!; }
    async mark(region: RasterRegion, offset: number): Promise<void> {
        const page = await this.page(region, offset); page.bytes[offset % 4096] = 1; page.dirty = true;
    }
    async uint32(region: RasterRegion, offset: number): Promise<number> { return (await this.page(region, offset)).view.getUint32(offset % 4096, true); }
    async setUint32(region: RasterRegion, offset: number, value: number): Promise<void> {
        const page = await this.page(region, offset); page.view.setUint32(offset % 4096, value, true); page.dirty = true;
    }
    async float32(region: RasterRegion, offset: number): Promise<number> { return (await this.page(region, offset)).view.getFloat32(offset % 4096, true); }
    async setFloat32(region: RasterRegion, offset: number, value: number): Promise<void> {
        const page = await this.page(region, offset); page.view.setFloat32(offset % 4096, value, true); page.dirty = true;
    }
    async flush(): Promise<void> {
        for (const page of this.pages.values()) {
            this.signal.throwIfAborted();
            if (page.dirty) { await this.storage.write(page.position, page.bytes, { signal: this.signal }); page.dirty = false; }
        }
    }
}

