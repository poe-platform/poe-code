import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { defaultRuntime } from "@poe-code/compression";

export function isDdsBytes(bytes: Uint8Array): boolean {
    return bytes[0] === 0x44 && bytes[1] === 0x44 && bytes[2] === 0x53 && bytes[3] === 0x20;
}

export function readDdsMetadata(bytes: Uint8Array, size = bytes.length): ImageMetadata {
    if (!isDdsBytes(bytes) || bytes.length < 128) throw new Error("Invalid DDS header");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(4, true) !== 124 || view.getUint32(76, true) !== 32) throw new Error("Invalid DDS header");
    if (!(view.getUint32(80, true) & 4) || view.getUint32(84, true) !== 0x31545844) throw new Error("Unsupported DDS compression (expected DXT1)");
    if (view.getUint32(112, true) & 0x20fe00) throw new Error("Unsupported DDS cube or volume texture");
    const width = view.getUint32(16, true), height = view.getUint32(12, true);
    if (!width || !height || !Number.isSafeInteger(width * height * 4)) throw new Error("Invalid DDS dimensions");
    if (size - 128 < Math.ceil(width / 4) * Math.ceil(height / 4) * 8) throw new Error("Truncated DDS raster");
    const hasAlpha = hasTransparentPixels(bytes.subarray(128), width, height);
    return { format: "dds", width, height, channels: hasAlpha ? 4 : 3, depth: "uchar", space: "srgb", hasAlpha, bitsPerSample: 8, density: 72, pages: 1, size };
}

function hasTransparentPixels(bytes: Uint8Array, width: number, height: number, startBlock = 0): boolean {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), columns = Math.ceil(width / 4);
    const blocks = Math.min(Math.floor(bytes.length / 8), columns * Math.ceil(height / 4) - startBlock);
    for (let block = 0; block < blocks; block++) {
        if (view.getUint16(block * 8, true) > view.getUint16(block * 8 + 2, true)) continue;
        const indices = view.getUint32(block * 8 + 4, true);
        const x = (startBlock + block) % columns * 4, y = Math.floor((startBlock + block) / columns) * 4;
        for (let row = 0; row < Math.min(4, height - y); row++) for (let column = 0; column < Math.min(4, width - x); column++)
            if (((indices >>> ((row * 4 + column) * 2)) & 3) === 3) return true;
    }
    return false;
}

export async function readDdsMetadataFromSource(source: ImageByteSource, signal: AbortSignal): Promise<ImageMetadata> {
    signal.throwIfAborted();
    const metadata = readDdsMetadata(await source.read(0, Math.min(128, source.size), { signal }), source.size);
    const blocks = Math.ceil(metadata.width / 4) * Math.ceil(metadata.height / 4);
    for (let block = 0; block < blocks; block += 1024) {
        await defaultRuntime.yieldTurn(signal);
        const length = Math.min(1024, blocks - block) * 8;
        const bytes = await source.read(128 + block * 8, length, { signal });
        if (bytes.length !== length) throw new Error("Truncated DDS raster");
        if (hasTransparentPixels(bytes, metadata.width, metadata.height, block)) return { ...metadata, hasAlpha: true, channels: 4 };
    }
    return metadata;
}

// Each BC1 block stores two RGB565 endpoints and sixteen two-bit palette indices.
function decodeBlock(bytes: Uint8Array): Uint8Array {
    if (bytes.length !== 8) throw new Error("Truncated DDS raster");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const first = view.getUint16(0, true), second = view.getUint16(2, true);
    const palette = new Uint8Array(16);
    for (const [index, value] of [first, second].entries()) {
        const r = value >>> 11, g = (value >>> 5) & 63, b = value & 31;
        palette.set([(r << 3) | (r >>> 2), (g << 2) | (g >>> 4), (b << 3) | (b >>> 2), 255], index * 4);
    }
    for (let channel = 0; channel < 3; channel++) {
        const a = palette[channel]!, b = palette[channel + 4]!;
        palette[8 + channel] = first > second ? Math.floor((2 * a + b) / 3) : Math.floor((a + b) / 2);
        palette[12 + channel] = first > second ? Math.floor((a + 2 * b) / 3) : 0;
    }
    palette[11] = 255;
    palette[15] = first > second ? 255 : 0;
    const indices = view.getUint32(4, true), data = new Uint8Array(64);
    for (let pixel = 0; pixel < 16; pixel++) {
        const index = ((indices >>> (pixel * 2)) & 3) * 4;
        data.set(palette.subarray(index, index + 4), pixel * 4);
    }
    return data;
}

export function decodeDdsImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
    const metadata = readDdsMetadata(bytes);
    checkLimitInputPixels(metadata.width, metadata.height, options);
    const { width, height } = metadata, data = new Uint8Array(width * height * 4);
    let offset = 128;
    for (let y = 0; y < height; y += 4) for (let x = 0; x < width; x += 4) {
        const block = decodeBlock(bytes.subarray(offset, offset + 8));
        offset += 8;
        for (let row = 0; row < Math.min(4, height - y); row++)
            data.set(block.subarray(row * 16, row * 16 + Math.min(4, width - x) * 4), ((y + row) * width + x) * 4);
    }
    const hasAlpha = data.some((value, index) => index % 4 === 3 && value === 0);
    return { ...metadata, hasAlpha, channels: hasAlpha ? 4 : 3, data };
}

export async function decodeDdsToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
    signal.throwIfAborted();
    const metadata = readDdsMetadata(await source.read(0, Math.min(128, source.size), { signal }), source.size);
    checkLimitInputPixels(metadata.width, metadata.height, options);
    const { width, height } = metadata, position = storage.allocate(width * height * 4);
    const columns = Math.ceil(width / 4);
    let hasAlpha = false;
    for (let y = 0; y < height; y += 4) for (let column = 0; column < columns; column += 128) {
        await defaultRuntime.yieldTurn(signal);
        const count = Math.min(128, columns - column);
        const bytes = await source.read(128 + (y / 4 * columns + column) * 8, count * 8, { signal });
        if (bytes.length !== count * 8) throw new Error("Truncated DDS raster");
        const rowLength = Math.min(count * 4, width - column * 4) * 4;
        const rows = new Uint8Array(rowLength * 4);
        for (let i = 0; i < count; i++) {
            const block = decodeBlock(bytes.subarray(i * 8, i * 8 + 8));
            const length = Math.min(16, rowLength - i * 16);
            for (let row = 0; row < 4; row++) rows.set(block.subarray(row * 16, row * 16 + length), row * rowLength + i * 16);
        }
        for (let row = 0; row < Math.min(4, height - y); row++) {
            if (rows.subarray(row * rowLength, (row + 1) * rowLength).some((value, index) => index % 4 === 3 && value === 0)) hasAlpha = true;
            await storage.write(position + ((y + row) * width + column * 4) * 4, rows.subarray(row * rowLength, (row + 1) * rowLength), { signal });
        }
    }
    return { ...metadata, hasAlpha, channels: hasAlpha ? 4 : 3, position };
}
