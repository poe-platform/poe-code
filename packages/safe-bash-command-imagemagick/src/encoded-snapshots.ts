import { encodeStoredImage, type ImageByteSource, type OutputEncodeOptions, type StoredImageFileInput, type StoredRgbaImage } from "@poe-code/image-ast/portable";
import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";

interface Snapshot {
    image: StoredRgbaImage;
    encoding: OutputEncodeOptions;
    encoded: NonNullable<StoredImageFileInput["encoded"]>;
}
/** Encoded pages stay in caller storage, even when encoders allocate their own scratch. */
export class EncodedSnapshots extends Map<string, Snapshot> {
    private readonly pages: IntegerTable;
    private nextPage = 0;
    constructor(private readonly storage: PagedStorage, private readonly signal: AbortSignal) {
        super(); this.pages = new IntegerTable(storage, 128);
    }
    async stage(image: StoredRgbaImage, path: string, encoding: OutputEncodeOptions): Promise<void> {
        const firstPage = this.nextPage, page = new Uint8Array(4096), encoder = encodeStoredImage(image, this.storage, this.signal, encoding);
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
                    this.set(path, { image, encoding, encoded: { source, info: next.value } });
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
}
