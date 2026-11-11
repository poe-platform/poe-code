import type { RgbaImage, StoredRgbaImage, ImageByteStorage } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";

function* isobrlChunks(image: Pick<RgbaImage, "width" | "height">, cellHeight: number): Generator<{ offset: number; length: number } | Uint8Array, void, Uint8Array> {
    const columns = Math.ceil(image.width / 2);
    for (let y = 0; y < image.height; y += cellHeight) {
        for (let column = 0; column < columns; column += 1024) {
            const count = Math.min(1024, columns - column), output = new Uint8Array(count);
            for (let row = 0; row < Math.min(cellHeight, image.height - y); row++) {
                // Native's bilevel cache advances one quantum per dot through two-quantum pixels.
                const start = column + Math.ceil(row * image.width / 2);
                const rightOffset = (row * image.width) % 2 === 0 ? 1 : 0;
                const lastHasRight = (column + count) * 2 <= image.width;
                const length = (count + (lastHasRight ? rightOffset : 0)) * 4;
                const data = yield { offset: (y * image.width + start) * 4, length };
                const leftBit = row === 3 ? 6 : row, rightBit = row === 3 ? 7 : row + 3;
                for (let i = 0; i < count; i++) {
                    if (data[i * 4]! < 128) output[i] = output[i]! | (1 << leftBit);
                    if ((column + i) * 2 + 1 < image.width && data[(i + rightOffset) * 4]! < 128)
                        output[i] = output[i]! | (1 << rightBit);
                }
            }
            yield output;
        }
    }
}

export function encodeIsobrlImage(image: RgbaImage, cellHeight: number): Uint8Array {
    const steps = isobrlChunks(image, cellHeight);
    const output = new Uint8Array(Math.ceil(image.width / 2) * Math.ceil(image.height / cellHeight));
    let next = steps.next(), offset = 0;
    while (!next.done) {
        if (next.value instanceof Uint8Array) {
            output.set(next.value, offset);
            offset += next.value.length;
            next = steps.next();
        } else next = steps.next(image.data.subarray(next.value.offset, next.value.offset + next.value.length));
    }
    return output;
}

export async function* encodeIsobrlFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal, cellHeight: number): AsyncGenerator<Uint8Array> {
    const steps = isobrlChunks(image, cellHeight);
    let next = steps.next();
    while (!next.done) {
        await yieldTurn(signal);
        signal.throwIfAborted();
        if (next.value instanceof Uint8Array) { yield next.value; next = steps.next(); }
        else {
            const bytes = await storage.read(image.position + next.value.offset, next.value.length, { signal });
            if (bytes.length !== next.value.length) throw new Error("Truncated ISOBRL pixel storage");
            next = steps.next(bytes);
        }
    }
}
