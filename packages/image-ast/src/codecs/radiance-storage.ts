import type { SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";
import { radianceHeader, radianceRows } from "./radiance.js";

export async function readRadianceFromSource(source: ImageByteSource, signal: AbortSignal) {
    const reader = new SourceBytes(source, signal, "Radiance"), steps = radianceHeader(source.size); let next = steps.next();
    while (!next.done) next = steps.next(await reader.at(next.value));
    return next.value;
}

export async function decodeRadianceToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
    const header = await readRadianceFromSource(source, signal), { width, height } = header.metadata;
    checkLimitInputPixels(width, height, options);
    const length = width * height * 4, position = storage.allocate(length), storedData16 = { position: storage.allocate(length * 2), length }, storedDataFloat = { position: storage.allocate(length * 4), length };
    const reader = new SourceBytes(source, signal, "Radiance"), steps = radianceRows(header, options); let next = steps.next();
    while (!next.done) {
        if (typeof next.value === "number") next = steps.next(await reader.at(next.value));
        else {
            const row = next.value;
            for (let start = 0; start < row.indices.length;) {
                let end = start + 1;
                while (end < row.indices.length && row.indices[end] === row.indices[start]! + (end - start) * 4) end++;
                const target = row.indices[start]!;
                await storage.write(position + target, row.data.subarray(start * 4, end * 4), { signal });
                await storage.write(storedData16.position + target * 2, new Uint8Array(row.data16.buffer, start * 8, (end - start) * 8), { signal });
                await storage.write(storedDataFloat.position + target * 4, new Uint8Array(row.dataFloat.buffer, start * 16, (end - start) * 16), { signal });
                start = end;
            }
            next = steps.next();
        }
    }
    return { ...header.metadata, position, storedData16, storedDataFloat };
}
