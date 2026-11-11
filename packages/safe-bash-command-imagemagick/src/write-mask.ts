import type { ConvolveRequest } from "./convolve-kernel.js";
import { regionContains, type Region } from "./region.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";

export interface MaskChannels { r: boolean; g: boolean; b: boolean }

/** Blend edited pixels with their originals; white protects and black permits writes. */
export function* writeMaskPixelSteps(image: { width: number; height: number; space?: string }, mask: { width: number; height: number }, highDepth = false, alphaSet = false, channels?: MaskChannels & { k?: boolean }, alphaActive = true): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    // Gray's single intensity channel occupies all three RGB storage slots.
    if (channels && (image.space === "b-w" || image.space === "grey16")) channels = { ...channels, g: channels.r, b: channels.r };
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x += 512) {
            yield;
            const count = Math.min(512, image.width - x), position = (y * image.width + x) * 4;
            // Keep HDRI samples until after clipping, as in the native pixel cache.
            const samples: Float64Array[] = [];
            let hue = false;
            for (const source of [0, 1]) {
                const colors = image.space === "cmyk" ? undefined : yield { kind: "read", hue: true, image: source, position, length: count * 4 };
                if (colors?.length) {
                    const values = Float64Array.from(new Float64Array(colors.slice().buffer), value => value * 255);
                    // A source CMYK plane stores black in slot four, not alpha.
                    const working = yield { kind: "read", evaluate: true, image: source, position, length: count * 4 };
                    const rgba = working?.length ? new Float64Array(working.slice().buffer)
                        : Float64Array.from(new Uint16Array((yield { kind: "read", highDepth: true, image: source, position, length: count * 4 })!.slice().buffer), value => value / 257);
                    for (let offset = 3; offset < values.length; offset += 4) values[offset] = rgba[offset]!;
                    samples.push(values);
                    hue = true;
                    continue;
                }
                const working = yield { kind: "read", evaluate: true, image: source, position, length: count * 4 };
                const bytes = working?.length ? undefined : (yield { kind: "read", highDepth, image: source, position, length: count * 4 })!;
                samples.push(working?.length ? new Float64Array(working.slice().buffer)
                    : Float64Array.from(highDepth ? new Uint16Array(bytes!.slice().buffer) : bytes!, value => highDepth ? value / 257 : value));
            }
            const edited = samples[0]!, original = samples[1]!;
            const editedInks = image.space === "cmyk" ? new Float64Array((yield { kind: "read", hue: true, position, length: count * 4 })!.slice().buffer) : undefined;
            const inkBytes = editedInks ? yield { kind: "read", hue: true, image: 1, position, length: count * 4 } : undefined;
            // Entering CMYK preserves protected RGB samples as C/M/Y, with zero K.
            const originalInks = editedInks ? inkBytes?.length ? new Float64Array(inkBytes.slice().buffer)
                : Float64Array.from(original, (value, index) => index % 4 === 3 ? 0 : value / 255) : undefined;
            const selectedInks = channels ? [channels.r, channels.g, channels.b, channels.k !== false] : undefined;
            const maskX = Math.min(x, mask.width - 1), maskCount = Math.min(count, mask.width - maskX);
            const maskPosition = (Math.min(y, mask.height - 1) * mask.width + maskX) * 4;
            const workingMask = yield { kind: "read", evaluate: true, image: 2, position: maskPosition, length: maskCount * 4 };
            const pixels = workingMask?.length ? new Float64Array(workingMask.slice().buffer)
                : Float64Array.from(new Uint16Array((yield { kind: "read", highDepth: true, image: 2, position: maskPosition, length: maskCount * 4 })!.slice().buffer), value => value / 257);
            const output = new Float64Array(count * 4);
            for (let i = 0; i < count; i++) {
                const m = Math.min(i, maskCount - 1) * 4;
                const intensity = (0.212656 * pixels[m]! + 0.715158 * pixels[m + 1]! + 0.072186 * pixels[m + 2]!) / 255;
                if (alphaSet) {
                    const source = intensity > 0.5 ? edited : original;
                    for (let channel = 0; channel < 4; channel++) output[i * 4 + channel] = source[i * 4 + channel]!;
                } else blendMaskedPixel(output, original, edited, i * 4, intensity, 255, channels, alphaActive);
                if (image.space === "b-w" || image.space === "grey16") {
                    output[i * 4 + 1] = output[i * 4 + 2] = output[i * 4]!;
                }
                if (editedInks && originalInks) {
                    const offset = i * 4;
                    const sourceAlpha = intensity * (alphaActive ? original[offset + 3]! / 255 : 1);
                    const editedAlpha = alphaActive ? edited[offset + 3]! / 255 : 1;
                    for (let channel = 0; channel < 4; channel++) {
                        if (alphaSet) {
                            if (intensity <= 0.5) editedInks[offset + channel] = originalInks[offset + channel]!;
                        } else if (intensity !== 0 && (!selectedInks || selectedInks[channel])) {
                            editedInks[offset + channel] = Math.fround((originalInks[offset + channel]! * sourceAlpha
                                + editedInks[offset + channel]! * editedAlpha * (1 - sourceAlpha)) * 65535) / 65535;
                        }
                    }
                    // Black lives in the ink plane; alpha remains in the RGBA backing.
                    for (let channel = 0; channel < 3; channel++)
                        output[offset + channel] = (1 - editedInks[offset + channel]!) * (1 - editedInks[offset + 3]!) * 255;
                }
            }
            if (editedInks) yield { kind: "write", hue: true, position, data: new Uint8Array(editedInks.buffer) };
            // Colorspace conversion consumes the normalized plane before the raster.
            if (hue) yield { kind: "write", hue: true, position, data: new Uint8Array(Float64Array.from(output, value => value / 255).buffer) };
            yield { kind: "write", evaluate: true, position, data: new Uint8Array(output.buffer) };
            // Mask blending creates fractional samples even from 8-bit inputs.
            const bounded = Uint16Array.from(output, value => Math.round(Math.max(0, Math.min(65535, value * 257))));
            yield { kind: "write", highDepth: true, position, data: new Uint8Array(bounded.buffer) };
            if (!highDepth) yield { kind: "write", position, data: Uint8Array.from(output, value => Math.round(Math.max(0, Math.min(255, value)))) };
        }
    }
}

/** Attach mask pixels at image coordinates; uncovered pixels permit writes. */
export function* writeMaskExtentSteps(image: { width: number; height: number }, mask: { width: number; height: number }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x += 4096) {
            yield;
            const count = Math.min(4096, image.width - x);
            const data = new Uint8Array(count * 4);
            if (y < mask.height && x < mask.width) {
                const maskCount = Math.min(count, mask.width - x);
                data.set((yield { kind: "read", position: (y * mask.width + x) * 4, length: maskCount * 4 })!);
            }
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

/** StatisticImage checks the mask at the window's upper-left sample before output clipping. */
export function* statisticWriteMaskPixelSteps(image: { width: number; height: number; region?: Region | undefined }, rows: readonly number[], virtualPixel: VirtualPixelMethod = "edge"): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const left = Math.ceil(rows[0]!), top = Math.floor(rows.length / 2);
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x += 1024) {
            yield;
            const count = Math.min(1024, image.width - x), position = (y * image.width + x) * 4;
            const samples: Float64Array[] = [];
            for (const source of [0, 1]) {
                const working = yield { kind: "read", evaluate: true, image: source, position, length: count * 4 };
                samples.push(working?.length ? new Float64Array(working.slice().buffer)
                    : Float64Array.from(new Uint16Array((yield { kind: "read", highDepth: true, image: source, position, length: count * 4 })!.slice().buffer), value => value / 257));
            }
            const edited = samples[0]!, original = samples[1]!;
            for (let i = 0; i < count; i++) {
                const pixel = virtualPixelIndex(x + i - left, y - top, image.width, image.height, virtualPixel);
                const mask = pixel < 0 || image.region ? undefined : new Uint16Array((yield { kind: "read", highDepth: true, image: 2, position: pixel * 4, length: 4 })!.slice().buffer);
                const intensity = image.region && pixel >= 0
                    ? regionContains(image.region, pixel % image.width, Math.floor(pixel / image.width)) ? 0 : 65535
                    : mask ? 0.212656 * mask[0]! + 0.715158 * mask[1]! + 0.072186 * mask[2]! : 0;
                if (intensity <= 65535 / 2) edited.set(original.subarray(i * 4, i * 4 + 4), i * 4);
            }
            yield { kind: "write", evaluate: true, position, data: new Uint8Array(edited.buffer) };
            const bounded = Uint16Array.from(edited, value => Math.round(Math.max(0, Math.min(65535, value * 257))));
            yield { kind: "write", highDepth: true, position, data: new Uint8Array(bounded.buffer) };
        }
    }
}

/** Write-only copy cache regions retain a cleared mask after the old mask clips the pixels. */
export function* clearWriteMaskPixelSteps(image: { width: number; height: number }, area: { left: number; top: number; right: number; bottom: number }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x += 1024) {
        yield;
        const count = Math.min(1024, image.width - x), position = (y * image.width + x) * 4;
        for (const evaluate of [false, true]) {
            const bytes = yield { kind: "read", highDepth: true, evaluate, position, length: count * 4 };
            if (!bytes?.length) continue;
            const data = evaluate ? new Float64Array(bytes.slice().buffer) : new Uint16Array(bytes.slice().buffer);
            if (y >= area.top && y < area.bottom) {
                for (let i = Math.max(x, area.left); i < Math.min(x + count, area.right); i++) data.fill(0, (i - x) * 4, (i - x) * 4 + 3);
            }
            yield { kind: "write", highDepth: true, evaluate, position, data: new Uint8Array(data.buffer) };
        }
    }
}
