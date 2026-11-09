import { blendMaskedPixel, type MaskChannels } from "./write-mask.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

export interface Region { x: number; y: number; width: number; height: number }

/** Apply a white write mask outside the selected rectangle in bounded chunks. */
export function* regionPixelSteps(image: { width: number; height: number }, region: Region, highDepth = false, channels?: MaskChannels): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const left = Math.max(0, Math.min(image.width, region.x));
    const right = Math.max(left, Math.min(image.width, region.x + region.width));
    for (let y = 0; y < image.height; y++) {
        yield;
        const spans = y < region.y || y >= region.y + region.height ? [[0, image.width, 1]] : [[0, left, 1], [left, right, 0], [right, image.width, 1]];
        for (const [start, end, source] of spans) {
            for (let x = start!; x < end!; x += 4096) {
                const position = (y * image.width + x) * 4;
                const data = (yield { kind: "read", highDepth, image: source!, position, length: Math.min(4096, end! - x) * 4 })!;
                if (source === 1) {
                    const editedBytes = (yield { kind: "read", highDepth, position, length: Math.min(4096, end! - x) * 4 })!;
                    const original = highDepth ? new Uint16Array(data.slice().buffer) : data;
                    const edited = highDepth ? new Uint16Array(editedBytes.slice().buffer) : editedBytes;
                    const output = original.slice();
                    for (let offset = 0; offset < output.length; offset += 4) blendMaskedPixel(output, original, edited, offset, 1, highDepth ? 65535 : 255, channels);
                    yield { kind: "write", highDepth, position, data: new Uint8Array(output.buffer) };
                } else yield { kind: "write", highDepth, position, data };
            }
        }
    }
}
