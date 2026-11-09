import type { ConvolveRequest } from "./convolve-kernel.js";

export interface MaskChannels { r: boolean; g: boolean; b: boolean }

/** Blend edited pixels with their originals; white protects and black permits writes. */
export function* writeMaskPixelSteps(image: { width: number; height: number }, mask: { width: number; height: number }, highDepth = false, alphaOpaque = false, channels?: MaskChannels): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x += 4096) {
            yield;
            const count = Math.min(4096, image.width - x), position = (y * image.width + x) * 4;
            const editedBytes = (yield { kind: "read", highDepth, position, length: count * 4 })!;
            const edited = highDepth ? new Uint16Array(editedBytes.slice().buffer) : editedBytes;
            const originalBytes = (yield { kind: "read", highDepth, image: 1, position, length: count * 4 })!;
            const original = highDepth ? new Uint16Array(originalBytes.slice().buffer) : originalBytes;
            const maskX = Math.min(x, mask.width - 1), maskCount = Math.min(count, mask.width - maskX);
            const pixels = (yield { kind: "read", image: 2, position: (Math.min(y, mask.height - 1) * mask.width + maskX) * 4, length: maskCount * 4 })!;
            const output = highDepth ? new Uint16Array(count * 4) : new Uint8Array(count * 4);
            for (let i = 0; i < count; i++) {
                const m = Math.min(i, maskCount - 1) * 4;
                const intensity = (0.212656 * pixels[m]! + 0.715158 * pixels[m + 1]! + 0.072186 * pixels[m + 2]!) / 255;
                if (alphaOpaque) {
                    const source = intensity > 0.5 ? edited : original;
                    for (let channel = 0; channel < 4; channel++) output[i * 4 + channel] = source[i * 4 + channel]!;
                } else blendMaskedPixel(output, original, edited, i * 4, intensity, highDepth ? 65535 : 255, channels);
            }
            yield { kind: "write", highDepth, position, data: new Uint8Array(output.buffer) };
        }
    }
}

/** Attach mask pixels at image coordinates, extending the mask's edge as needed. */
export function* writeMaskExtentSteps(image: { width: number; height: number }, mask: { width: number; height: number }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x += 4096) {
            yield;
            const count = Math.min(4096, image.width - x), maskX = Math.min(x, mask.width - 1);
            const maskCount = Math.min(count, mask.width - maskX);
            const pixels = (yield { kind: "read", position: (Math.min(y, mask.height - 1) * mask.width + maskX) * 4, length: maskCount * 4 })!;
            const data = new Uint8Array(count * 4);
            data.set(pixels);
            for (let i = maskCount; i < count; i++) data.set(pixels.subarray(pixels.length - 4), i * 4);
            yield { kind: "write", position: (y * image.width + x) * 4, data };
        }
    }
}

/** Native clip-cache compositing uses premultiplied colors and restores source alpha. */
export function blendMaskedPixel(output: Uint8Array | Uint16Array, original: Uint8Array | Uint16Array, edited: Uint8Array | Uint16Array, offset: number, protection: number, maximum: number, channels?: MaskChannels, alphaActive = true): void {
    if (protection === 0) {
        for (let channel = 0; channel < 4; channel++) output[offset + channel] = edited[offset + channel]!;
        return;
    }
    // Disabled alpha is opaque even when its stored sample is zero.
    const sourceAlpha = protection * (alphaActive ? original[offset + 3]! / maximum : 1);
    const editedAlpha = alphaActive ? edited[offset + 3]! / maximum : 1;
    for (let channel = 0; channel < 3; channel++) {
        if (channels && !(channel === 0 ? channels.r : channel === 1 ? channels.g : channels.b)) {
            output[offset + channel] = edited[offset + channel]!;
            continue;
        }
        output[offset + channel] = Math.round(original[offset + channel]! * sourceAlpha + edited[offset + channel]! * editedAlpha * (1 - sourceAlpha));
    }
    output[offset + 3] = original[offset + 3]!;
}
