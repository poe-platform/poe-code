import type { ImageByteSource } from "./png-storage.js";
import { defaultRuntime } from "@poe-code/compression";

/** A supported convenience format without a retained codec or capability yet. */
export class UnsupportedStoredResource extends Error {}

/** Unknown formats cannot become valid by materializing their encoded bytes. */
export class UnsupportedImageFormat extends UnsupportedStoredResource {
    constructor() { super("Input buffer contains unsupported image format"); }
}

export async function rejectUnknownImage(source: ImageByteSource, signal: AbortSignal): Promise<never> {
    for (let position = 0; position < source.size; position += 16384) {
        if (position % 1048576 === 0) await defaultRuntime.yieldTurn(signal);
        signal.throwIfAborted();
        const length = Math.min(16384, source.size - position), bytes = await source.read(position, length, { signal });
        signal.throwIfAborted();
        if (!(bytes instanceof Uint8Array) || bytes.length !== length) throw new Error("Truncated image source");
    }
    throw new UnsupportedImageFormat();
}
