import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { defaultRuntime } from "@poe-code/compression";

function miffHeader(image: { width: number; height: number; magickColorspace?: string }, depth: 8 | 16): Uint8Array {
    const { width, height } = image;
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 || !Number.isSafeInteger(width * height * 4)) throw new RangeError("Invalid MIFF dimensions");
    return new TextEncoder().encode(`id=ImageMagick version=1.0\nclass=DirectClass colors=0 matte=True\ncolumns=${width} rows=${height} depth=${depth}\ncolorspace=${image.magickColorspace === "RGB" ? "RGB" : "sRGB"}\ncompression=None\n\f\n:\x1a`);
}

export function encodeMiffImage(image: RgbaImage, requestedDepth?: 8 | 16): Uint8Array {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (const page of image.miffPages ?? [image]) {
        const depth = requestedDepth ?? (page.depth === "ushort" ? 16 : 8);
        const header = miffHeader(page, depth), size = page.width * page.height * 4;
        if (page.data.length !== size) throw new Error("Invalid MIFF pixels");
        if (page.data16 && page.data16.length !== size) throw new Error("Invalid MIFF pixels");
        const pixels = depth === 8 ? page.data : new Uint8Array(size * 2);
        if (depth === 16) {
            const view = new DataView(pixels.buffer);
            for (let index = 0; index < size; index++) view.setUint16(index * 2, page.data16?.[index] ?? page.data[index]! * 257);
        }
        chunks.push(header, pixels);
        length += header.length + pixels.length;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
}

export async function* encodeMiffFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal, requestedDepth?: 8 | 16): AsyncGenerator<Uint8Array> {
    for (let index = 0; index < (image.storedMiffPages?.length ?? 1); index++) {
        signal.throwIfAborted();
        const page = image.storedMiffPages ? await image.storedMiffPages.at(index) : image;
        signal.throwIfAborted();
        const depth = requestedDepth ?? (page.depth === "ushort" ? 16 : 8);
        const source16 = depth === 16 ? page.storedData16 : undefined;
        yield miffHeader(page, depth);
        const length = page.width * page.height * 4;
        if (source16 && source16.length !== length) throw new Error("Invalid MIFF pixels");
        for (let offset = 0; offset < length; offset += 4096) {
            signal.throwIfAborted();
            if (offset % 65536 === 0) await defaultRuntime.yieldTurn(signal);
            const size = Math.min(4096, length - offset), bytes = await storage.read((source16?.position ?? page.position) + offset * (source16 ? 2 : 1), size * (source16 ? 2 : 1), { signal });
            signal.throwIfAborted();
            if (bytes.length !== size * (source16 ? 2 : 1)) throw new Error("Truncated MIFF backing storage");
            if (depth === 8) yield new Uint8Array(bytes);
            else {
                const pixels = new Uint8Array(size * 2), view = new DataView(pixels.buffer);
                const samples = source16 ? new Uint16Array(new Uint8Array(bytes).buffer) : undefined;
                for (let index = 0; index < size; index++) view.setUint16(index * 2, samples?.[index] ?? bytes[index]! * 257);
                yield pixels;
            }
        }
    }
}
