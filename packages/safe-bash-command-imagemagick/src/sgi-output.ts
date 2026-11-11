import type { RgbaImage, StoredRgbaImage, ImageByteStorage } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";

/** SGI verbatim RGB(A): a 512-byte header followed by bottom-up channel planes. */
function* sgiChunks(image: Pick<RgbaImage, "width" | "height" | "hasAlpha">): Generator<Uint8Array | { offset: number; length: number }, void, Uint8Array> {
    const { width, height } = image, channels = image.hasAlpha ? 4 : 3;
    if (width < 1 || height < 1 || width > 65535 || height > 65535) throw new Error("SGI dimensions must be between 1 and 65535");
    const header = new Uint8Array(512), view = new DataView(header.buffer);
    view.setUint16(0, 474);
    header[3] = 1;
    view.setUint16(4, 3);
    view.setUint16(6, width);
    view.setUint16(8, height);
    view.setUint16(10, channels);
    view.setUint32(16, 255);
    yield header;
    for (let channel = 0; channel < channels; channel++) {
        for (let y = height - 1; y >= 0; y--) {
            for (let x = 0; x < width; x += 4096) {
                const count = Math.min(4096, width - x);
                const pixels = yield { offset: (y * width + x) * 4, length: count * 4 };
                const samples = new Uint8Array(count);
                for (let i = 0; i < count; i++) samples[i] = pixels[i * 4 + channel]!;
                yield samples;
            }
        }
    }
}

export function encodeSgiImage(image: RgbaImage): Uint8Array {
    const steps = sgiChunks(image);
    let next = steps.next();
    const output = new Uint8Array(512 + image.width * image.height * (image.hasAlpha ? 4 : 3));
    let offset = 0;
    while (!next.done) {
        if (next.value instanceof Uint8Array) { output.set(next.value, offset); offset += next.value.length; next = steps.next(); }
        else next = steps.next(image.data.subarray(next.value.offset, next.value.offset + next.value.length));
    }
    return output;
}

export async function* encodeSgiFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    const steps = sgiChunks(image);
    let next = steps.next();
    while (!next.done) {
        await yieldTurn(signal);
        signal.throwIfAborted();
        if (next.value instanceof Uint8Array) { yield next.value; next = steps.next(); }
        else {
            const { offset, length } = next.value;
            const data = await storage.read(image.position + offset, length, { signal });
            if (data.length !== length) throw new Error("Truncated SGI pixel storage");
            next = steps.next(data);
        }
    }
}
