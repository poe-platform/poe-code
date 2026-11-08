import { ZipDirectoryIndex, type ZipMetadataStorage } from "@poe-code/office-package/zip";
import { crc32 } from "@poe-code/office-package";
import { archiveSettings, InputTypeError, ResourceLimitError, type ArchiveContext } from "./archive.js";
import { UnsupportedEditError } from "./xml-write.js";
import type { DocumentBudget } from "./budget.js";
import type {RasterHeader} from "./raster-header.js";
type Density = {
    horizontalDpi: number | null;
    verticalDpi: number | null;
};
function unsupported(): never { throw new UnsupportedEditError("Raster header or density metadata is invalid or unsupported."); }
export interface RasterHeaderSource {
    readonly size: number;
    read(position: number, length: number): Promise<Uint8Array>;
}
class HeaderReader {
    private page = new Uint8Array(0);
    private position = -1;
    constructor(readonly source: RasterHeaderSource, readonly storage: ZipMetadataStorage, readonly budget: DocumentBudget, readonly signal: AbortSignal) { }
    get size(): number { return this.source.size; }
    interval(offset: number, length: number): void {
        this.signal.throwIfAborted();
        this.budget.charge("work", 1);
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > this.size || length > this.size - offset)
            unsupported();
    }
    async byte(offset: number): Promise<number> {
        this.interval(offset, 1);
        if (offset < this.position || offset >= this.position + this.page.length) {
            this.position = Math.floor(offset / 4096) * 4096;
            const length = Math.min(4096, this.size - this.position), bytes = await this.source.read(this.position, length);
            this.signal.throwIfAborted();
            if (!(bytes instanceof Uint8Array) || bytes.length !== length)
                unsupported();
            this.page = new Uint8Array(bytes);
            await this.budget.checkpoint(length);
        }
        return this.page[offset - this.position]!;
    }
    async u16(offset: number, little = false): Promise<number> { this.interval(offset, 2); const a = await this.byte(offset), b = await this.byte(offset + 1); return little ? a + b * 256 : a * 256 + b; }
    async u32(offset: number, little = false): Promise<number> { this.interval(offset, 4); const a = await this.u16(offset, little), b = await this.u16(offset + 2, little); return little ? a + b * 65536 : a * 65536 + b; }
    async i32(offset: number): Promise<number> { return (await this.u32(offset, true)) | 0; }
    async text(offset: number, length: number): Promise<string> { this.interval(offset, length); let value = ""; for (let i = 0; i < length; i++)
        value += String.fromCharCode(await this.byte(offset + i)); return value; }
    async checksum(offset: number, length: number): Promise<number> {
        this.interval(offset, length);
        let crc = 0;
        for (let i = 0; i < length;) {
            await this.byte(offset + i);
            const start = offset + i - this.position, count = Math.min(length - i, this.page.length - start);
            crc = crc32(this.page.subarray(start, start + count), crc);
            i += count;
        }
        return crc;
    }
}
function dimensions(width: number, height: number, maximum = 0xffffffff): void {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > maximum || height > maximum)
        unsupported();
}
function density(x: number | null, y: number | null, factor: number): Density {
    const axis = (value: number | null): number | null => { if (value === null || value === 0)
        return null; const dpi = value * factor; if (value < 0 || !Number.isFinite(dpi) || dpi <= 0)
        unsupported(); return dpi; };
    return { horizontalDpi: axis(x), verticalDpi: axis(y) };
}
function mergeDensity(before: Density, after: Density): Density {
    const merge = (a: number | null, b: number | null) => { if (a !== null && b !== null && a !== b)
        unsupported(); return b ?? a; };
    return { horizontalDpi: merge(before.horizontalDpi, after.horizontalDpi), verticalDpi: merge(before.verticalDpi, after.verticalDpi) };
}
async function png(reader: HeaderReader): Promise<RasterHeader> {
    let offset = 8, width = 0, height = 0, color = 0, depth = 0, sawData = false, dataLength = 0, closedData = false, sawPalette = false, sawDensity = false, ended = false;
    let dpi: Density = { horizontalDpi: null, verticalDpi: null };
    while (offset < reader.size) {
        reader.interval(offset, 12);
        const length = await reader.u32(offset);
        reader.interval(offset + 8, length + 4);
        const name = await reader.text(offset + 4, 4), start = offset + 8;
        if ([...name].some(c => !(c >= "A" && c <= "Z") && !(c >= "a" && c <= "z")) || name[2]! >= "a")
            unsupported();
        reader.budget.charge("work", length + 4);
        if (await reader.checksum(offset + 4, length + 4) !== await reader.u32(start + length))
            unsupported();
        if (name === "IHDR") {
            if (offset !== 8 || length !== 13)
                unsupported();
            width = await reader.u32(start);
            height = await reader.u32(start + 4);
            dimensions(width, height, 0x7fffffff);
            depth = (await reader.byte(start + 8))!;
            color = (await reader.byte(start + 9))!;
            const depths: Readonly<Record<number, readonly number[]>> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
            if (!depths[color!]?.includes(depth!) || await reader.byte(start + 10) !== 0 || await reader.byte(start + 11) !== 0 || ![0, 1].includes((await reader.byte(start + 12))!))
                unsupported();
        }
        else if (!width)
            unsupported();
        else if (name === "PLTE") {
            if (sawPalette || sawData || color === 0 || color === 4 || length === 0 || length > 768 || length % 3 !== 0 || color === 3 && length / 3 > 2 ** depth)
                unsupported();
            sawPalette = true;
        }
        else if (name === "pHYs") {
            if (length !== 9 || sawData || sawDensity)
                unsupported();
            sawDensity = true;
            const unit = await reader.byte(start + 8);
            if (unit !== 0 && unit !== 1)
                unsupported();
            if (unit === 1)
                dpi = density(await reader.u32(start), await reader.u32(start + 4), 0.0254);
        }
        else if (name === "IDAT") {
            if (closedData || color === 3 && !sawPalette)
                unsupported();
            sawData = true;
            dataLength += length;
        }
        else if (name === "IEND") {
            if (length !== 0 || !sawData || dataLength === 0 || start + 4 !== reader.size)
                unsupported();
            ended = true;
        }
        else if (name[0]! >= "A" && name[0]! <= "Z")
            unsupported();
        if (sawData && name !== "IDAT")
            closedData = true;
        offset = start + length + 4;
    }
    if (!ended)
        unsupported();
    return { mime: "image/png", pixelWidth: width, pixelHeight: height, ...dpi };
}
interface TiffMetadata extends Density {
    width: number | null;
    height: number | null;
}
async function tiff(reader: HeaderReader, base = 0, length = reader.size): Promise<TiffMetadata> {
    reader.interval(base, length);
    if (length < 8)
        unsupported();
    const byteOrder = await reader.text(base, 2), little = byteOrder === "II";
    if (byteOrder !== "II" && byteOrder !== "MM" || await reader.u16(base + 2, little) !== 42)
        unsupported();
    const check = (offset: number, size: number) => { if (offset < 0 || offset > length || size > length - offset)
        unsupported(); reader.interval(base + offset, size); };
    const u16 = async (offset: number) => { check(offset, 2); return await reader.u16(base + offset, little); };
    const u32 = async (offset: number) => { check(offset, 4); return await reader.u32(base + offset, little); };
    let top = 0;
    const push = async (value: number) => { const bytes = new Uint8Array(16), view = new DataView(bytes.buffer); view.setFloat64(0, top, true); view.setFloat64(8, value, true); top = reader.storage.allocate(16); await reader.storage.write(top, bytes); };
    const pop = async () => { const bytes = await reader.storage.read(top, 16), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length); top = view.getFloat64(0, true); return view.getFloat64(8, true); };
    await push(await u32(4));
    const visited = new ZipDirectoryIndex(reader.storage, { signal: reader.signal }), values = new Map<number, number | readonly [
        number,
        number
    ]>();
    const sizes: Readonly<Record<number, number>> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
    while (top) {
        await reader.budget.checkpoint(16);
        const offset = await pop();
        if (!offset)
            continue;
        if (offset < 8)
            unsupported();
        if ((await visited.get(String(offset))) !== undefined)
            unsupported();
        reader.budget.charge("retainedBytes", 32);
        await visited.set(String(offset), 1);
        const count = await u16(offset);
        check(offset + 2, count * 12 + 4);
        for (let i = 0; i < count; i++) {
            reader.budget.charge("work", 12);
            const start = offset + 2 + i * 12;
            const tag = await u16(start), type = await u16(start + 2), items = await u32(start + 4), size = sizes[type];
            if (!size || items === 0)
                unsupported();
            const total = items * size;
            if (!Number.isSafeInteger(total))
                unsupported();
            const address = total <= 4 ? start + 8 : await u32(start + 8);
            if (total > 4 && address < 8)
                unsupported();
            check(address, total);
            if (![256, 257, 282, 283, 296, 34665].includes(tag))
                continue;
            if (items !== 1)
                unsupported();
            let value: number | readonly [
                number,
                number
            ];
            if (tag === 282 || tag === 283) {
                if (type !== 5)
                    unsupported();
                value = [await u32(address), await u32(address + 4)];
            }
            else {
                if (type !== 3 && type !== 4 || tag === 34665 && type !== 4 || tag === 296 && type !== 3)
                    unsupported();
                value = type === 3 ? await u16(address) : await u32(address);
            }
            const before = values.get(tag);
            if (before !== undefined && JSON.stringify(before) !== JSON.stringify(value))
                unsupported();
            reader.budget.charge("retainedBytes", 32);
            values.set(tag, value);
            if (tag === 34665) {
                if (!value)
                    unsupported();
                reader.budget.charge("retainedBytes", 8);
                await push(value as number);
            }
        }
        const next = await u32(offset + 2 + count * 12);
        if (next) {
            reader.budget.charge("retainedBytes", 8);
            await push(next);
        }
    }
    const unit = values.get(296) ?? 2;
    if (unit !== 1 && unit !== 2 && unit !== 3)
        unsupported();
    const resolution = (tag: number): number | null => {
        const value = values.get(tag);
        if (!value)
            return null;
        if (!Array.isArray(value) || value[1] === 0)
            unsupported();
        if (unit === 1)
            return null;
        const result = value[0] / value[1] * (unit === 3 ? 2.54 : 1);
        if (value[0] === 0 || !Number.isFinite(result) || result <= 0)
            unsupported();
        return result;
    };
    return { width: values.get(256) as number ?? null, height: values.get(257) as number ?? null, horizontalDpi: resolution(282), verticalDpi: resolution(283) };
}
async function jpeg(reader: HeaderReader): Promise<RasterHeader> {
    let offset = 2, width = 0, height = 0, sawScan = false;
    let dpi: Density = { horizontalDpi: null, verticalDpi: null };
    const frames = new Set([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207]);
    while (offset < reader.size) {
        reader.interval(offset, 2);
        if (await reader.byte(offset) !== 255)
            unsupported();
        while (await reader.byte(offset) === 255) {
            reader.interval(offset, 1);
            offset++;
        }
        reader.interval(offset, 1);
        const marker = (await reader.byte(offset++))!;
        if (marker === 217)
            break;
        if (marker === 216 || marker === 0 || marker >= 208 && marker <= 215)
            unsupported();
        if (marker === 1)
            continue;
        const length = await reader.u16(offset);
        if (length < 2)
            unsupported();
        reader.interval(offset, length);
        const start = offset + 2, payload = length - 2;
        if (marker === 224 && payload >= 5 && await reader.text(start, 5) === "JFIF\0") {
            if (payload < 14)
                unsupported();
            const unit = await reader.byte(start + 7);
            if (unit !== 0 && unit !== 1 && unit !== 2)
                unsupported();
            const thumbnail = (await reader.byte(start + 12))! * (await reader.byte(start + 13))! * 3;
            if (thumbnail > payload - 14)
                unsupported();
            if (unit)
                dpi = mergeDensity(dpi, density(await reader.u16(start + 8), await reader.u16(start + 10), unit === 2 ? 2.54 : 1));
        }
        else if (marker === 225 && payload >= 6 && await reader.text(start, 6) === "Exif\0\0") {
            dpi = mergeDensity(dpi, await tiff(reader, start + 6, payload - 6));
        }
        else if (frames.has(marker)) {
            if (payload < 6 || await reader.byte(start) !== 8 || !await reader.byte(start + 5) || payload !== 6 + (await reader.byte(start + 5))! * 3)
                unsupported();
            const h = await reader.u16(start + 1), w = await reader.u16(start + 3);
            dimensions(w, h, 65535);
            if (width && (width !== w || height !== h))
                unsupported();
            width = w;
            height = h;
        }
        else if (marker === 218) {
            if (!width || payload < 4 || !await reader.byte(start) || payload !== 4 + (await reader.byte(start))! * 2)
                unsupported();
            sawScan = true;
            break;
        }
        offset += length;
    }
    if (!width || !sawScan || reader.size < 2 || await reader.u16(reader.size - 2) !== 0xffd9)
        unsupported();
    return { mime: "image/jpeg", pixelWidth: width, pixelHeight: height, ...dpi };
}
/** Inspect raster dimensions and density with one owned 4 KiB source page.
 * TIFF work and visited-directory identities use caller storage; the six
 * recognized tag values stay resident. Neither source nor storage is closed. */
export async function characterizeRetainedRasterHeader(input: RasterHeaderSource, storage: ZipMetadataStorage, context: ArchiveContext): Promise<RasterHeader> {
    const { limits, budget, signal } = archiveSettings(context);
    if (!input || typeof input.read !== "function" || !Number.isSafeInteger(input.size) || input.size < 0)
        throw new InputTypeError("Expected retained raster source.");
    budget.check("embeddedMediaBytes", input.size);
    if (input.size > limits.maxEntryBytes)
        throw new ResourceLimitError("Raster entry byte limit exceeded.");
    budget.charge("work", input.size);
    budget.charge("retainedBytes", 128);
    const reader = new HeaderReader(input, storage, budget, signal), prefix = new Uint8Array(Math.min(8, input.size));
    for (let i = 0; i < prefix.length; i++)
        prefix[i] = await reader.byte(i);
    const begins = (...bytes: number[]) => prefix.length >= bytes.length && bytes.every((value, index) => prefix[index] === value);
    if (begins(137, 80, 78, 71, 13, 10, 26, 10))
        return await png(reader);
    if (begins(255, 216))
        return await jpeg(reader);
    if (begins(71, 73, 70, 56, 55, 97) || begins(71, 73, 70, 56, 57, 97)) {
        reader.interval(0, 13);
        const width = await reader.u16(6, true), height = await reader.u16(8, true);
        dimensions(width, height, 65535);
        const packed = (await reader.byte(10))!;
        if (packed & 128)
            reader.interval(13, 3 * 2 ** ((packed & 7) + 1));
        return { mime: "image/gif", pixelWidth: width, pixelHeight: height, horizontalDpi: null, verticalDpi: null };
    }
    if (begins(66, 77)) {
        reader.interval(0, 18);
        const size = await reader.u32(14, true);
        if (size < 40)
            unsupported();
        reader.interval(14, size);
        const width = await reader.i32(18), height = await reader.i32(22);
        if (width <= 0 || height === 0 || await reader.u16(26, true) !== 1)
            unsupported();
        dimensions(width, Math.abs(height));
        const pixelOffset = await reader.u32(10, true);
        if (pixelOffset < 14 + size || pixelOffset > input.size)
            unsupported();
        return { mime: "image/bmp", pixelWidth: width, pixelHeight: Math.abs(height), ...density(await reader.i32(38), await reader.i32(42), 0.0254) };
    }
    if (begins(73, 73, 42, 0) || begins(77, 77, 0, 42)) {
        const metadata = await tiff(reader);
        if (metadata.width === null || metadata.height === null)
            unsupported();
        dimensions(metadata.width, metadata.height);
        return { mime: "image/tiff", pixelWidth: metadata.width, pixelHeight: metadata.height, horizontalDpi: metadata.horizontalDpi, verticalDpi: metadata.verticalDpi };
    }
    unsupported();
}
