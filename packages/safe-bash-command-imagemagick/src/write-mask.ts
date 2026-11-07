import type { ConvolveRequest } from "./convolve-kernel.js";

/** Blend edited pixels with their originals; white protects and black permits writes. */
export function* writeMaskPixelSteps(image: { width: number; height: number }, mask: { width: number; height: number }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x += 4096) {
            yield;
            const count = Math.min(4096, image.width - x), position = (y * image.width + x) * 4;
            const edited = (yield { kind: "read", position, length: count * 4 })!;
            const original = (yield { kind: "read", image: 1, position, length: count * 4 })!;
            const maskX = Math.min(x, mask.width - 1), maskCount = Math.min(count, mask.width - maskX);
            const pixels = (yield { kind: "read", image: 2, position: (Math.min(y, mask.height - 1) * mask.width + maskX) * 4, length: maskCount * 4 })!;
            const output = new Uint8Array(count * 4);
            for (let i = 0; i < count; i++) {
                const m = Math.min(i, maskCount - 1) * 4;
                const protection = (0.212656 * pixels[m]! + 0.715158 * pixels[m + 1]! + 0.072186 * pixels[m + 2]!) / 255;
                for (let channel = 0; channel < 4; channel++) {
                    const offset = i * 4 + channel;
                    output[offset] = Math.round(edited[offset]! * (1 - protection) + original[offset]! * protection);
                }
            }
            yield { kind: "write", position, data: output };
        }
    }
}
