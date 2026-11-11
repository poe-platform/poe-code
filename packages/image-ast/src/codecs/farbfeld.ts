import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { defaultRuntime } from "@poe-code/compression";

export function isFarbfeldBytes(bytes: Uint8Array): boolean {
    return bytes.length >= 8 && "farbfeld".split("").every((char, i) => bytes[i] === char.charCodeAt(0));
}

export function readFarbfeldMetadata(bytes: Uint8Array, size = bytes.length): ImageMetadata {
    if (!isFarbfeldBytes(bytes) || bytes.length < 16) throw new Error("Invalid farbfeld header");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(8), height = view.getUint32(12);
    if (!width || !height || !Number.isSafeInteger(width * height * 8)) throw new Error("Invalid farbfeld dimensions");
    if (size - 16 < width * height * 8) throw new Error("Truncated farbfeld raster");
    return { format: "farbfeld", width, height, channels: 4, depth: "ushort", space: "srgb", hasAlpha: true, bitsPerSample: 16, density: 72, size };
}

function farbfeldPixels(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const data16 = new Uint16Array(bytes.length / 2), data = new Uint8Array(data16.length);
    for (let i = 0; i < data.length; i++) {
        data16[i] = view.getUint16(i * 2);
        data[i] = Math.round(data16[i]! / 257);
    }
    return { data, data16 };
}

export function decodeFarbfeldImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
    const metadata = readFarbfeldMetadata(bytes);
    checkLimitInputPixels(metadata.width, metadata.height, options);
    return { ...metadata, ...farbfeldPixels(bytes.subarray(16, 16 + metadata.width * metadata.height * 8)) };
}

export async function decodeFarbfeldToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
    signal.throwIfAborted();
    const metadata = readFarbfeldMetadata(await source.read(0, Math.min(16, source.size), { signal }), source.size);
    checkLimitInputPixels(metadata.width, metadata.height, options);
    const length = metadata.width * metadata.height * 4, position = storage.allocate(length);
    const storedData16 = { position: storage.allocate(length * 2), length };
    for (let offset = 0; offset < length; offset += 4096) {
        await defaultRuntime.yieldTurn(signal);
        const count = Math.min(4096, length - offset);
        const bytes = await source.read(16 + offset * 2, count * 2, { signal });
        if (bytes.length !== count * 2) throw new Error("Truncated farbfeld raster");
        const pixels = farbfeldPixels(bytes);
        await storage.write(position + offset, pixels.data, { signal });
        await storage.write(storedData16.position + offset * 2, new Uint8Array(pixels.data16.buffer), { signal });
    }
    return { ...metadata, position, storedData16 };
}
