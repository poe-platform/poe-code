import type { ConvolveRequest } from "./convolve-kernel.js";

export interface MaskChannels { r: boolean; g: boolean; b: boolean }

/** Blend edited pixels with their originals; white protects and black permits writes. */
export function* writeMaskPixelSteps(image: { width: number; height: number }, mask: { width: number; height: number }, highDepth = false, alphaOpaque = false, channels?: MaskChannels): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x += 4096) {
            yield;
            const count = Math.min(4096, image.width - x), position = (y * image.width + x) * 4;
            // Keep HDRI samples until after clipping, as in the native pixel cache.
            const samples: Float64Array[] = [];
            for (const image of [0, 1]) {
                const working = yield { kind: "read", evaluate: true, image, position, length: count * 4 };
                const bytes = working?.length ? undefined : (yield { kind: "read", highDepth, image, position, length: count * 4 })!;
                samples.push(working?.length ? new Float64Array(working.slice().buffer)
                    : Float64Array.from(highDepth ? new Uint16Array(bytes!.slice().buffer) : bytes!, value => highDepth ? value / 257 : value));
            }
            const edited = samples[0]!, original = samples[1]!;
            const maskX = Math.min(x, mask.width - 1), maskCount = Math.min(count, mask.width - maskX);
            const maskPosition = (Math.min(y, mask.height - 1) * mask.width + maskX) * 4;
            const workingMask = yield { kind: "read", evaluate: true, image: 2, position: maskPosition, length: maskCount * 4 };
            const pixels = workingMask?.length ? new Float64Array(workingMask.slice().buffer)
                : Float64Array.from(new Uint16Array((yield { kind: "read", highDepth: true, image: 2, position: maskPosition, length: maskCount * 4 })!.slice().buffer), value => value / 257);
            const output = new Float64Array(count * 4);
            for (let i = 0; i < count; i++) {
                const m = Math.min(i, maskCount - 1) * 4;
                const intensity = (0.212656 * pixels[m]! + 0.715158 * pixels[m + 1]! + 0.072186 * pixels[m + 2]!) / 255;
                if (alphaOpaque) {
                    const source = intensity > 0.5 ? edited : original;
                    for (let channel = 0; channel < 4; channel++) output[i * 4 + channel] = source[i * 4 + channel]!;
                } else blendMaskedPixel(output, original, edited, i * 4, intensity, 255, channels);
            }
            yield { kind: "write", evaluate: true, position, data: new Uint8Array(output.buffer) };
            // Mask blending creates fractional samples even from 8-bit inputs.
            const bounded = Uint16Array.from(output, value => Math.round(Math.max(0, Math.min(65535, value * 257))));
            yield { kind: "write", highDepth: true, position, data: new Uint8Array(bounded.buffer) };
            if (!highDepth) yield { kind: "write", position, data: Uint8Array.from(output, value => Math.round(Math.max(0, Math.min(255, value)))) };
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
export function blendMaskedPixel(output: Uint8Array | Uint16Array | Float64Array, original: Uint8Array | Uint16Array | Float64Array, edited: Uint8Array | Uint16Array | Float64Array, offset: number, protection: number, maximum: number, channels?: MaskChannels, alphaActive = true): void {
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
        const value = original[offset + channel]! * sourceAlpha + edited[offset + channel]! * editedAlpha * (1 - sourceAlpha);
        output[offset + channel] = output instanceof Float64Array ? Math.fround(value * 257) / 257 : Math.round(value);
    }
    output[offset + 3] = original[offset + 3]!;
}
