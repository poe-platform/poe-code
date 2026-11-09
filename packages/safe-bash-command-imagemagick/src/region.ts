import type { ConvolveRequest } from "./convolve-kernel.js";

export interface Region { x: number; y: number; width: number; height: number }

/** Restore pixels outside the selected rectangle in bounded chunks. */
export function* regionPixelSteps(image: { width: number; height: number }, region: Region, highDepth = false): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const left = Math.max(0, Math.min(image.width, region.x));
    const right = Math.max(left, Math.min(image.width, region.x + region.width));
    for (let y = 0; y < image.height; y++) {
        yield;
        const spans = y < region.y || y >= region.y + region.height ? [[0, image.width, 1]] : [[0, left, 1], [left, right, 0], [right, image.width, 1]];
        for (const [start, end, source] of spans) {
            for (let x = start!; x < end!; x += 4096) {
                const position = (y * image.width + x) * 4;
                const data = (yield { kind: "read", highDepth, image: source!, position, length: Math.min(4096, end! - x) * 4 })!;
                yield { kind: "write", highDepth, position, data };
            }
        }
    }
}
