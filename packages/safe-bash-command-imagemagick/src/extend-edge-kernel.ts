import type { ConvolveRequest } from "./convolve-kernel.js";

/** Extend the pixel grid without resampling, using the right and bottom edges. */
export function* extendEdgePixelSteps(source: { width: number; height: number }, width: number, height: number): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x += 4096) {
            yield;
            const count = Math.min(4096, width - x), left = Math.min(x, source.width - 1);
            const length = Math.min(count, source.width - left);
            const bytes = (yield { kind: "read", position: (Math.min(y, source.height - 1) * source.width + left) * 4, length: length * 4 })!;
            const data = new Uint8Array(count * 4);
            data.set(bytes);
            for (let pixel = length; pixel < count; pixel++) data.set(bytes.subarray(bytes.length - 4), pixel * 4);
            yield { kind: "write", position: (y * width + x) * 4, data };
        }
    }
}
