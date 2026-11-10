import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { RgbaColor } from "@poe-code/image-ast/portable";
import type { VirtualPixelMethod } from "./warp-kernel.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { Region } from "./region.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

/** Native emboss diagonal Gaussian convolution followed by channel-aware equalization. */
export function* embossPixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "data16" | "evaluateSamples"> & Partial<Pick<StoredRgbaImage, "storedData16" | "storedEvaluateSamples">> & { region?: Region | undefined }, geometry: { width?: number; height?: number }, channels?: { r: boolean; g: boolean; b: boolean; a: boolean }, virtualPixel: VirtualPixelMethod = "edge", background?: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const highDepth = !!(image.data16 || image.storedData16);
    const evaluate = !!image.evaluateSamples || image.storedEvaluateSamples !== undefined;
    const { width, height } = image, radius = geometry.width ?? 0, sigma = Math.max(1e-12, Math.abs(geometry.height ?? 1));
    let half = radius > 0 ? Math.ceil(radius) : 1;
    if (radius <= 0 && sigma > 1e-12) {
        let total = 1 + 2 * Math.exp(-1 / (2 * sigma * sigma));
        for (half = 2; half <= 5000; half++) {
            yield;
            const edge = Math.exp(-half * half / (2 * sigma * sigma));
            total += 2 * edge;
            if (edge / total < 1 / 65535) { half--; break; }
        }
    }
    if (!Number.isFinite(half) || half > 5000) throw new Error("Emboss radius exceeds 5000");
    const weights = new Float64Array(half * 2 + 1);
    let total = 0;
    for (let k = -half; k <= half; k++) {
        const weight = (k === 0 ? 1 : -1) * Math.exp(-k * k / (sigma * sigma));
        weights[k + half] = weight; total += weight;
    }
    const reciprocal = Math.abs(total) < 1e-12 ? (total < 0 ? -1e12 : 1e12) : 1 / total;
    for (let k = 0; k < weights.length; k++) weights[k]! *= reciprocal;
    const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 128 : 0;
    const fill = (virtualPixel === "background" || virtualPixel.endsWith("-tile")) && background
        ? [background.r, background.g, background.b, background.a]
        : [gray, gray, gray, virtualPixel === "transparent" ? 0 : 255];
    const mask = channels ? [channels.r, channels.g, channels.b, channels.a && image.hasAlpha] : [true, true, true, image.hasAlpha];
    const histograms = Array.from({ length: channels ? 4 : 1 }, () => new Float64Array(65536));
    const lookups = histograms.map(() => new Float64Array(65536));
    const bin = (value: number): number => Math.max(0, Math.min(65535, Math.round(value * 257)));
    // Recompute bounded spans for the second pass, retaining floating point values
    // until equalization instead of rounding the convolution to eight bits.
    for (let pass = 0; pass < 2; pass++) {
        for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 512) {
            yield;
            const count = Math.min(512, width - left), sums = new Float64Array(count * 4);
            for (let k = -half; k <= half; k++) {
                yield;
                const weight = weights[k + half]!;
                if (weight === 0) continue;
                const map = (x: number) => virtualPixelIndex(left + x - k, y + k, width, height, virtualPixel);
                for (let x = 0; x < count;) {
                    yield;
                    const pixel = map(x);
                    let run = 1;
                    const direction = map(x + 1) - pixel;
                    if (direction >= -1 && direction <= 1) {
                        while (x + run < count && (pixel < 0 ? map(x + run) < 0 : map(x + run) === pixel + run * direction && pixel + run * direction >= 0)) run++;
                    }
                    let samples: Uint8Array | Float64Array | number[] = fill;
                    if (pixel >= 0) {
                        const start = direction === -1 ? pixel - run + 1 : pixel;
                        const length = (direction === 0 ? 1 : run) * 4;
                        const bytes = yield { kind: "read", evaluate, highDepth, position: start * 4, length };
                        if (!bytes || bytes.length !== length * (evaluate ? 8 : highDepth ? 2 : 1)) throw new Error("Truncated emboss pixels");
                        samples = evaluate ? new Float64Array(bytes.slice().buffer)
                            : highDepth ? Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257) : bytes;
                    }
                    for (let i = 0; i < run; i++) {
                        const offset = (pixel < 0 || direction === 0 ? 0 : direction === -1 ? run - i - 1 : i) * 4;
                        const alpha = image.hasAlpha ? samples[offset + 3]! / 255 : 1;
                        for (let channel = 0; channel < 3; channel++) sums[(x + i) * 4 + channel]! += samples[offset + channel]! * weight * alpha;
                        sums[(x + i) * 4 + 3]! += weight * alpha;
                    }
                    x += run;
                }
            }
            // Keep convolution values unrounded until equalization. Explicit
            // selections use per-channel maps; the default shares an intensity map.
            for (let x = 0; x < count; x++) {
                const alpha = sums[x * 4 + 3]!;
                if (image.hasAlpha) for (let channel = 0; channel < 3; channel++) {
                    sums[x * 4 + channel]! /= Math.abs(alpha) < 1e-12 ? (alpha < 0 ? -1e-12 : 1e-12) : alpha;
                }
                sums[x * 4 + 3] = alpha * 255;
                // Q16-HDRI stores convolution results as float32 quantum samples.
                for (let channel = 0; channel < 4; channel++) sums[x * 4 + channel] = Math.fround(sums[x * 4 + channel]! * 257) / 257;
            }
            const region = image.region;
            const position = (y * width + left) * 4;
            const bytes = pass === 1 || image.region ? yield { kind: "read", evaluate, highDepth, position, length: count * 4 } : undefined;
            if ((pass === 1 || image.region) && (!bytes || bytes.length !== count * 4 * (evaluate ? 8 : highDepth ? 2 : 1))) throw new Error("Truncated emboss pixels");
            const samples = bytes ? evaluate ? new Float64Array(bytes.slice().buffer)
                : Float64Array.from(highDepth ? new Uint16Array(bytes.slice().buffer) : bytes, value => highDepth ? value / 257 : value) : undefined;
            // The native cache composites the region mask after convolution, before
            // building the histogram. Keep HDRI values through both mask applications.
            if (region) for (let x = 0; x < count; x++) {
                if (left + x >= region.x && left + x < region.x + region.width && y >= region.y && y < region.y + region.height) continue;
                const sourceAlpha = image.hasAlpha ? samples![x * 4 + 3]! / 255 : 1;
                const editedAlpha = image.hasAlpha ? sums[x * 4 + 3]! / 255 : 1;
                for (let channel = 0; channel < 3; channel++) sums[x * 4 + channel] = samples![x * 4 + channel]! * sourceAlpha + sums[x * 4 + channel]! * editedAlpha * (1 - sourceAlpha);
                sums[x * 4 + 3] = samples![x * 4 + 3]!;
            }
            if (pass === 0) {
                for (let x = 0; x < count; x++) {
                    if (channels) {
                        for (let channel = 0; channel < 4; channel++) if (mask[channel]) histograms[channel]![bin(sums[x * 4 + channel]!)]!++;
                    } else histograms[0]![bin(sums[x * 4]! * 0.212656 + sums[x * 4 + 1]! * 0.715158 + sums[x * 4 + 2]! * 0.072186)]!++;
                }
            } else {
                const values = samples!.slice();
                for (let x = 0; x < count; x++) for (let channel = 0; channel < (image.hasAlpha ? 4 : 3); channel++) {
                    if (!mask[channel]) continue;
                    const map = channels ? channel : 0, black = histograms[map]![0]!, lookup = lookups[map]!;
                    const value = sums[x * 4 + channel]!;
                    let equalized = black === width * height ? value : lookup[bin(value)]!;
                    // Equalization writes through the same mask using the convolved source.
                    if (region && (left + x < region.x || left + x >= region.x + region.width || y < region.y || y >= region.y + region.height)) {
                        const sourceAlpha = image.hasAlpha ? sums[x * 4 + 3]! / 255 : 1;
                        const editedAlpha = image.hasAlpha ? (black === width * height ? sums[x * 4 + 3]! : lookup[bin(sums[x * 4 + 3]!)]!) / 255 : 1;
                        equalized = channel === 3 ? value : value * sourceAlpha + equalized * editedAlpha * (1 - sourceAlpha);
                    }
                    values[x * 4 + channel] = Math.fround(equalized * 257) / 257;
                }
                const data = highDepth ? Uint16Array.from(values, value => Math.max(0, Math.min(65535, Math.round(value * 257))))
                    : Uint8Array.from(values, value => Math.max(0, Math.min(255, Math.round(value))));
                yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
                yield { kind: "write", evaluate: true, position, data: new Uint8Array(values.buffer) };
            }
        }
        if (pass === 0) for (let channel = 0; channel < histograms.length; channel++) {
            if (channels && !mask[channel]) continue;
            const histogram = histograms[channel]!, lookup = lookups[channel]!;
            let sum = 0;
            const black = histogram[0]!, range = width * height - black;
            for (let i = 0; i < histogram.length; i++) {
                if (i % 4096 === 0) yield;
                sum += histogram[i]!;
                lookup[i] = range === 0 ? 0 : Math.fround(65535 * (sum - black) / range) / 257;
            }
        }
    }
}
