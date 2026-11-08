import { defaultRuntime } from "@poe-code/compression";
import type { SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";
import { exrHeader, exrPixels } from "./exr.js";

export async function readExrFromSource(source: ImageByteSource, signal: AbortSignal) {
    const reader = new SourceBytes(source, signal, "EXR"), steps = exrHeader(source.size); let next = steps.next();
    while (!next.done) {
        const { position, length } = next.value, bytes = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
            const byte = await reader.at(position + i);
            if (byte === undefined) throw new Error("Truncated EXR header");
            bytes[i] = byte;
        }
        next = steps.next(bytes);
    }
    return next.value;
}

export async function decodeExrToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
    const header = await readExrFromSource(source, signal), { width, height } = header.metadata;
    checkLimitInputPixels(width, height, options);
    const length = width * height * 4, position = storage.allocate(length), storedData16 = { position: storage.allocate(length * 2), length }, storedDataFloat = { position: storage.allocate(length * 4), length };
    const steps = exrPixels(header, source.size); let next = steps.next();
    while (!next.done) {
        await defaultRuntime.yieldTurn(signal);
        const step = next.value;
        if ("position" in step) next = steps.next(await source.read(step.position, step.length, { signal }));
        else {
            const offset = step.y * width * 4;
            await storage.write(position + offset, step.data, { signal });
            await storage.write(storedData16.position + offset * 2, new Uint8Array(step.data16.buffer), { signal });
            await storage.write(storedDataFloat.position + offset * 4, new Uint8Array(step.dataFloat.buffer), { signal });
            next = steps.next(new Uint8Array());
        }
    }
    return { ...header.metadata, position, storedData16, storedDataFloat };
}
