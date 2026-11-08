import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { defaultRuntime } from "@poe-code/compression";

function miffHeader(image: { width: number; height: number }): Uint8Array {
    const { width, height } = image;
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 || !Number.isSafeInteger(width * height * 4)) throw new RangeError("Invalid MIFF dimensions");
    return new TextEncoder().encode(`id=ImageMagick version=1.0\nclass=DirectClass colors=0 matte=True\ncolumns=${width} rows=${height} depth=8\ncolorspace=sRGB\ncompression=None\n\f\n:\x1a`);
}

export function encodeMiffImage(image: RgbaImage): Uint8Array {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (const page of image.miffPages ?? [image]) {
        const header = miffHeader(page), size = page.width * page.height * 4;
        if (page.data.length !== size) throw new Error("Invalid MIFF pixels");
        chunks.push(header, page.data);
        length += header.length + size;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
}

export async function* encodeMiffFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    for (let index = 0; index < (image.storedMiffPages?.length ?? 1); index++) {
        signal.throwIfAborted();
        const page = image.storedMiffPages ? await image.storedMiffPages.at(index) : image;
        signal.throwIfAborted();
        yield miffHeader(page);
        const length = page.width * page.height * 4;
        for (let offset = 0; offset < length; offset += 4096) {
            signal.throwIfAborted();
            if (offset % 65536 === 0) await defaultRuntime.yieldTurn(signal);
            const size = Math.min(4096, length - offset), bytes = await storage.read(page.position + offset, size, { signal });
            signal.throwIfAborted();
            if (bytes.length !== size) throw new Error("Truncated MIFF backing storage");
            yield new Uint8Array(bytes);
        }
    }
}
