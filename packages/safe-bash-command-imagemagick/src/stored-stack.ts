import type { StoredRgbaImage, ImageDelayReader } from "@poe-code/image-ast/portable";
import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";

export const magickInput = Symbol("magickInput");
export interface MagickFormatContext {
    filePath?: string;
    byteLen?: number;
    originalWidth?: number;
    originalHeight?: number;
    sceneIdx?: number;
    sceneCount?: number;
    quality?: number;
}
export type StoredMagickImage = StoredRgbaImage & { [magickInput]?: MagickFormatContext };
interface DelayRegion { position: number; length: number }
interface FrameRecord { image: Omit<StoredMagickImage, "delay" | "storedDelay">; source?: MagickFormatContext; delays?: DelayRegion }

/** Immutable frame records and frame indices live in caller backing. */
export class StoredImageStack {
    private readonly indices: IntegerTable;
    private readonly frames: Map<number, StoredMagickImage>;
    private readonly records: WeakMap<StoredMagickImage, number>;
    private readonly delayRegions: WeakMap<object, DelayRegion>;
    length = 0;
    constructor(private readonly storage: PagedStorage, private readonly signal: AbortSignal, parent?: StoredImageStack) {
        this.frames = parent?.frames ?? new Map();
        this.records = parent?.records ?? new WeakMap();
        this.delayRegions = parent?.delayRegions ?? new WeakMap();
        this.indices = new IntegerTable(storage, 128);
    }
    private cache(position: number, image: StoredMagickImage): void {
        this.frames.delete(position);
        if (this.frames.size === 32) this.frames.delete(this.frames.keys().next().value!);
        this.frames.set(position, image); this.records.set(image, position);
    }
    private async retain(image: StoredMagickImage): Promise<number> {
        const known = this.records.get(image);
        if (known !== undefined) return known;
        const { delay, storedDelay, ...metadata } = image, source = storedDelay ?? delay;
        let delays = source ? this.delayRegions.get(source) : undefined;
        if (source && !delays) {
            delays = { position: this.storage.allocate(source.length * 9), length: source.length };
            for (let start = 0; start < source.length; start += 512) {
                await yieldTurn(this.signal);
                const count = Math.min(512, source.length - start), bytes = new Uint8Array(count * 9), view = new DataView(bytes.buffer);
                for (let i = 0; i < count; i++) {
                    const value = storedDelay ? await storedDelay.at(start + i, { signal: this.signal }) : delay![start + i];
                    if (value !== undefined) { bytes[i * 9] = 1; view.setFloat64(i * 9 + 1, value, true); }
                }
                await this.storage.write(delays.position + start * 9, bytes);
            }
            this.delayRegions.set(source, delays);
        }
        const record: FrameRecord = { image: metadata, ...(image[magickInput] ? { source: image[magickInput] } : {}), ...(delays ? { delays } : {}) };
        const text = JSON.stringify(record), encoder = new TextEncoder(), position = this.storage.allocate(8);
        let size = 0;
        for (let offset = 0; offset < text.length;) {
            await yieldTurn(this.signal);
            const bytes = new Uint8Array(4096), { read, written } = encoder.encodeInto(text.slice(offset, offset + 4097), bytes);
            await this.storage.write(this.storage.allocate(written), bytes.subarray(0, written));
            offset += read; size += written;
        }
        const header = new Uint8Array(8); new DataView(header.buffer).setFloat64(0, size, true);
        await this.storage.write(position, header); this.cache(position, image);
        return position;
    }
    private async read(position: number): Promise<StoredMagickImage> {
        const cached = this.frames.get(position);
        if (cached) { this.cache(position, cached); return cached; }
        const header = await this.storage.read(position, 8), size = new DataView(header.buffer, header.byteOffset, header.byteLength).getFloat64(0, true);
        if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid stored frame record");
        const decoder = new TextDecoder(); let text = "";
        for (let offset = 0; offset < size; offset += 4096) {
            await yieldTurn(this.signal);
            text += decoder.decode(await this.storage.read(position + 8 + offset, Math.min(4096, size - offset)), { stream: true });
        }
        const record = JSON.parse(text + decoder.decode()) as FrameRecord;
        const image: StoredMagickImage = { ...record.image, ...(record.source ? { [magickInput]: record.source } : {}) };
        if (record.delays) {
            const region = record.delays, storage = this.storage, signal = this.signal;
            const reader: ImageDelayReader = { length: region.length, async at(index, options) {
                signal.throwIfAborted(); options?.signal?.throwIfAborted();
                if (!Number.isSafeInteger(index) || index < 0 || index >= region.length) return;
                const bytes = await storage.read(region.position + index * 9, 9);
                signal.throwIfAborted(); options?.signal?.throwIfAborted();
                return bytes[0] ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(1, true) : undefined;
            } };
            Object.assign(image, { storedDelay: reader }); this.delayRegions.set(reader, region);
        }
        this.cache(position, image); return image;
    }
    async get(index: number): Promise<StoredMagickImage | undefined> {
        this.signal.throwIfAborted();
        if (!Number.isSafeInteger(index) || index < 0 || index >= this.length) return;
        const position = await this.indices.get(BigInt(index));
        if (position === undefined) throw new Error("Missing stored frame");
        return this.read(Number(position));
    }
    async push(image: StoredMagickImage): Promise<void> {
        this.signal.throwIfAborted();
        await this.indices.set(BigInt(this.length), BigInt(await this.retain(image))); this.length++;
    }
    async set(index: number, image: StoredMagickImage): Promise<void> {
        this.signal.throwIfAborted();
        if (!Number.isSafeInteger(index) || index < 0 || index >= this.length) throw new RangeError("Invalid frame index");
        await this.indices.set(BigInt(index), BigInt(await this.retain(image)));
    }
    async swap(first: number, second: number): Promise<void> {
        if (!Number.isSafeInteger(first) || !Number.isSafeInteger(second) || first === second || first < 0 || second < 0 || first >= this.length || second >= this.length) return;
        const a = (await this.indices.get(BigInt(first)))!, b = (await this.indices.get(BigInt(second)))!;
        await this.indices.set(BigInt(first), b); await this.indices.set(BigInt(second), a);
    }
    async remove(indices: Iterable<number>): Promise<void> {
        const removed = new IntegerTable(this.storage, 128);
        let work = 0;
        for (const index of indices) if (index >= 0 && index < this.length) { if (++work % 128 === 0) await yieldTurn(this.signal); await removed.set(BigInt(index), 1n); }
        let next = 0;
        for (let index = 0; index < this.length; index++) {
            if (index % 128 === 0) await yieldTurn(this.signal);
            if (await removed.get(BigInt(index))) continue;
            if (next !== index) await this.indices.set(BigInt(next), (await this.indices.get(BigInt(index)))!);
            next++;
        }
        this.length = next;
    }
}
