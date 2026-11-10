import type { readMiffHeader } from "./miff-input.js";
import { createMiffBzip } from "./miff-bzip.js";

/** Read requests and pixel-aligned chunks let both callers share bounded raster decoding. */
export function* miffBzipRaster(header: ReturnType<typeof readMiffHeader>): Generator<{ offset: number; length: number } | Uint8Array, number, Uint8Array | undefined> {
    const { metadata, offset: start } = header, size = metadata.size!;
    let offset = start;
    const pixelBytes = header.pixelBytes;
    const chunkBytes = Math.min(1024, Math.floor(8192 / pixelBytes)) * pixelBytes;
    const length = metadata.width * metadata.height * pixelBytes;
    function* read(length: number): Generator<{ offset: number; length: number }, Uint8Array, Uint8Array | undefined> {
        if (length > size - offset) throw new Error("Truncated MIFF raster");
        const bytes = yield { offset, length };
        if (!bytes || bytes.length !== length) throw new Error("Truncated MIFF raster");
        offset += length;
        return bytes;
    }
    const codec = createMiffBzip(chunkBytes, true), pending = new Uint8Array(chunkBytes);
    let produced = 0, buffered = 0;
    try {
        while (!codec.ended) {
            const prefix = yield* read(4);
            let remaining = new DataView(prefix.buffer, prefix.byteOffset, 4).getUint32(0);
            if (!remaining || remaining > size - offset) throw new Error("Invalid MIFF BZip packet length");
            while (remaining) {
                const input = yield* read(Math.min(8192, remaining));
                remaining -= input.length;
                for (const bytes of codec.push(input, false)) {
                    produced += bytes.length;
                    if (produced > length) throw new Error("Excess MIFF raster data");
                    let start = 0;
                    while (start < bytes.length) {
                        const count = Math.min(pending.length - buffered, bytes.length - start);
                        pending.set(bytes.subarray(start, start + count), buffered);
                        start += count; buffered += count;
                        if (buffered === pending.length) { yield pending; buffered = 0; }
                    }
                }
                if (codec.ended && remaining) throw new Error("Trailing MIFF BZip data");
            }
        }
        if (produced !== length) throw new Error("Truncated MIFF raster");
        if (buffered) yield pending.subarray(0, buffered);
    } finally { codec.close(); }
    return offset;
}

