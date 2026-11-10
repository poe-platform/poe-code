import type { ConvolveRequest } from "./convolve-kernel.js";
import { regionContains, type Region } from "./region.js";

/** PNG32/64 and raw RGBA enable inactive alpha, setting opacity only where the write mask permits it. */
export function* pngAlphaPixelSteps(image: { width: number; height: number; hasAlpha: boolean; inactiveAlpha?: boolean | undefined; region?: Region | undefined }, mask: { width: number; height: number } | undefined, highDepth: boolean): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const maximum = highDepth ? 65535 : 255;
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x += 4096) {
            yield;
            const count = Math.min(4096, image.width - x), position = (y * image.width + x) * 4;
            const bytes = (yield { kind: "read", highDepth, position, length: count * 4 })!;
            const pixels = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes.slice();
            const maskX = mask ? Math.min(x, mask.width - 1) : 0;
            const maskCount = mask ? Math.min(count, mask.width - maskX) : 0;
            const maskBytes = mask ? (yield { kind: "read", image: 1, highDepth: true, position: (Math.min(y, mask.height - 1) * mask.width + maskX) * 4, length: maskCount * 4 })! : undefined;
            const samples = maskBytes ? new Uint16Array(maskBytes.slice().buffer) : undefined;
            for (let i = 0; i < count; i++) {
                const offset = i * 4 + 3;
                const m = Math.min(i, maskCount - 1) * 4;
                const region = image.region;
                const opaque = samples ? 0.212656 * samples[m]! + 0.715158 * samples[m + 1]! + 0.072186 * samples[m + 2]! > 65535 / 2
                    : !region || !regionContains(region, x + i, y);
                pixels[offset] = opaque ? maximum : (image.hasAlpha || image.inactiveAlpha) ? pixels[offset]! : 0;
            }
            yield { kind: "write", highDepth, position, data: new Uint8Array(pixels.buffer) };
        }
    }
}
