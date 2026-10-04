import { encodeStoredImage, type ImageByteSource, type OutputEncodeOptions, type StoredImageFileInput, type StoredRgbaImage } from "@poe-code/image-ast/portable";
import { StoredImageStack } from "./stored-stack.js";
import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";

interface Snapshot {
    image: StoredRgbaImage;
    encoding: OutputEncodeOptions;
    encoded: NonNullable<StoredImageFileInput["encoded"]>;
}
interface SnapshotRecord {
    path: string;
    image: number;
    firstPage: number;
    size: number;
    encoding: OutputEncodeOptions;
    info: Snapshot["encoded"]["info"];
    next: number | null;
    order: number;
}
/** Encoded pages stay in caller storage, even when encoders allocate their own scratch. */
export class EncodedSnapshots {
    size = 0;
    private buckets: IntegerTable;
    private readonly order: IntegerTable;
    private readonly images: StoredImageStack;
    private readonly records = new Map<number, SnapshotRecord>();
    private readonly pages: IntegerTable;
    private nextPage = 0;
    constructor(private readonly storage: PagedStorage, private readonly signal: AbortSignal) {
        this.pages = new IntegerTable(storage, 128);
        this.buckets = new IntegerTable(storage, 128); this.order = new IntegerTable(storage, 128);
        this.images = new StoredImageStack(storage, signal);
    }
    async stage(image: StoredRgbaImage, path: string, encoding: OutputEncodeOptions, source?: AsyncGenerator<Uint8Array, Snapshot["encoded"]["info"] | undefined>): Promise<void> {
        const firstPage = this.nextPage, page = new Uint8Array(4096), encoder = source ?? encodeStoredImage(image, this.storage, this.signal, encoding);
        let used = 0, size = 0;
        const retain = async () => {
            const position = this.storage.allocate(used);
            await this.storage.write(position, page.subarray(0, used));
            await this.pages.set(BigInt(this.nextPage++), BigInt(position));
            used = 0;
        };
        try {
            while (true) {
                await yieldTurn(this.signal);
                const next = await encoder.next();
                if (next.done) {
                    if (!next.value) throw new Error("Image encoding did not finish");
                    if (used) await retain();
                    const hash = this.hash(path), previous = await this.find(path, hash);
                    const record: SnapshotRecord = { path, image: this.images.length, firstPage, size, encoding, info: next.value, next: Number(await this.buckets.get(hash) ?? -1n), order: previous?.order ?? this.size };
                    await this.images.push(image);
                    const bytes = new TextEncoder().encode(JSON.stringify(record)), position = this.storage.allocate(bytes.length + 8), header = new Uint8Array(8);
                    new DataView(header.buffer).setFloat64(0, bytes.length, true); await this.storage.write(position, header);
                    for (let start = 0; start < bytes.length; start += 4096) { await yieldTurn(this.signal); await this.storage.write(position + 8 + start, bytes.subarray(start, start + 4096)); }
                    await this.buckets.set(hash, BigInt(position)); await this.order.set(BigInt(record.order), BigInt(position));
                    if (!previous) this.size++;
                    this.cache(position, record);
                    return;
                }
                for (let offset = 0; offset < next.value.length;) {
                    const count = Math.min(next.value.length - offset, 4096 - used);
                    page.set(next.value.subarray(offset, offset + count), used);
                    used += count; size += count; offset += count;
                    if (used === 4096) await retain();
                }
            }
        } finally { await encoder.return(undefined); }
    }
    private hash(path: string): bigint {
        let hash = 14695981039346656037n;
        for (let index = 0; index < path.length; index++) hash = BigInt.asUintN(64, (hash ^ BigInt(path.charCodeAt(index))) * 1099511628211n);
        return hash;
    }
    private cache(position: number, record: SnapshotRecord): void {
        this.records.delete(position);
        if (this.records.size === 32) this.records.delete(this.records.keys().next().value!);
        this.records.set(position, record);
    }
    private async record(position: number): Promise<SnapshotRecord> {
        const cached = this.records.get(position); if (cached) return cached;
        const header = await this.storage.read(position, 8), size = new DataView(header.buffer, header.byteOffset, header.byteLength).getFloat64(0, true);
        const decoder = new TextDecoder(); let text = "";
        for (let start = 0; start < size; start += 4096) { await yieldTurn(this.signal); text += decoder.decode(await this.storage.read(position + 8 + start, Math.min(4096, size - start)), { stream: true }); }
        const record = JSON.parse(text + decoder.decode()) as SnapshotRecord; this.cache(position, record); return record;
    }
    private async find(path: string, hash: bigint): Promise<SnapshotRecord | undefined> {
        let position = Number(await this.buckets.get(hash) ?? -1n);
        while (position >= 0) { await yieldTurn(this.signal); const record = await this.record(position); if (record.path === path) return record; position = record.next ?? -1; }
    }
    private async snapshot(record: SnapshotRecord): Promise<Snapshot> {
        const { firstPage, size } = record;
        const source: ImageByteSource = { size, read: async (position, length) => {
            this.signal.throwIfAborted();
            if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 0 || length > 16384 || position + length > size) throw new RangeError("Invalid encoded snapshot range");
            const bytes = new Uint8Array(length);
            for (let offset = 0; offset < length;) {
                const logical = position + offset, index = firstPage + Math.floor(logical / 4096), within = logical % 4096;
                const count = Math.min(length - offset, 4096 - within), physical = await this.pages.get(BigInt(index));
                if (physical === undefined) throw new Error("Missing encoded snapshot page");
                const part = await this.storage.read(Number(physical) + within, count);
                if (part.length !== count) throw new Error("Truncated encoded snapshot page");
                bytes.set(part, offset); offset += count;
            }
            return bytes;
        } };
        return { image: (await this.images.get(record.image))!, encoding: record.encoding, encoded: { source, info: record.info } };
    }
    async get(path: string): Promise<Snapshot | undefined> {
        const record = await this.find(path, this.hash(path)); return record ? this.snapshot(record) : undefined;
    }
    async *[Symbol.asyncIterator](): AsyncGenerator<readonly [string, Snapshot]> {
        for (let index = 0; index < this.size; index++) {
            const position = await this.order.get(BigInt(index)); if (position === undefined) throw new Error("Missing pending image");
            const record = await this.record(Number(position)); yield [record.path, await this.snapshot(record)] as const;
        }
    }
    clear(): void { this.size = 0; this.records.clear(); this.buckets = new IntegerTable(this.storage, 128); }

}
