import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { RgbaColor } from "@poe-code/image-ast/portable";
import type { VirtualPixelMethod } from "./warp-kernel.js";
import { createMagickRandom } from "./random.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import { regionContains, type Region } from "./region.js";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { magickIntensity } from "./intensity.js";
import type { HueMetadata } from "./colorspace-hue.js";

export interface EmbossEqualization {
    histogram?: Float64Array;
    lookup?: Float64Array;
}

/** Native emboss diagonal Gaussian convolution followed by channel-aware equalization. */
export function* embossPixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "data16" | "evaluateSamples" | "space" | "gamma"> & Partial<Pick<StoredRgbaImage, "storedData16" | "storedEvaluateSamples">> & HueMetadata & { region?: Region | undefined }, geometry: { width?: number; height?: number }, intensity: string, channels?: { r: boolean; g: boolean; b: boolean; a: boolean; k?: boolean }, virtualPixel: VirtualPixelMethod = "edge", background?: RgbaColor, equalization?: EmbossEqualization, writeMask?: Pick<RgbaImage, "width" | "height">, sync = !channels, seed?: bigint): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const cmyk = image.space === "cmyk", stride = cmyk ? 5 : 4;
    const hue = !cmyk && !!image.magickColorspace && (image.hueSamples !== undefined || image.storedHueSamples !== undefined);
    const linear = image.magickColorspace === "RGB" || image.magickColorspace === "scRGB"
        || (image.space === "b-w" || image.space === "grey16") && image.gamma === 1 && image.magickColorspace !== "Gray";
    const highDepth = !!(image.data16 || image.storedData16);
    const evaluate = !!image.evaluateSamples || image.storedEvaluateSamples !== undefined;
    function* read(position: number, length: number): Generator<ConvolveRequest | undefined, Float64Array, Uint8Array | undefined> {
        const bytes = yield { kind: "read", hue, evaluate, highDepth, position, length };
        if (!bytes || bytes.length !== length * (hue || evaluate ? 8 : highDepth ? 2 : 1)) throw new Error("Truncated emboss pixels");
        const rgba = hue ? Float64Array.from(new Float64Array(bytes.slice().buffer), value => value * 255) : evaluate ? new Float64Array(bytes.slice().buffer)
            : Float64Array.from(highDepth ? new Uint16Array(bytes.slice().buffer) : bytes, value => highDepth ? value / 257 : value);
        if (!cmyk) return rgba;
        const inkBytes = yield { kind: "read", hue: true, position, length };
        if (!inkBytes || inkBytes.length !== length * 8) throw new Error("Truncated emboss inks");
        const inks = new Float64Array(inkBytes.slice().buffer), samples = new Float64Array(length / 4 * stride);
        for (let i = 0; i < length / 4; i++) samples.set([
            inks[i * 4]! * 255, inks[i * 4 + 1]! * 255, inks[i * 4 + 2]! * 255,
            rgba[i * 4 + 3]!, inks[i * 4 + 3]! * 255,
        ], i * stride);
        return samples;
    }
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
    const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 127.5 : 0;
    const fill = (virtualPixel === "background" || virtualPixel.endsWith("-tile")) && background
        ? [background.r, background.g, background.b, background.a]
        : [gray, gray, gray, virtualPixel === "transparent" ? 0 : 255];
    if (cmyk) fill.push(gray);
    // Gray's three backing samples represent the single red/gray channel.
    if (image.space === "b-w" || image.space === "grey16") {
        // Tile borders write RGB into that shared sample; the final blue write wins.
        if (virtualPixel.endsWith("-tile")) fill[0] = fill[1] = fill[2]!;
        if (channels) channels = { ...channels, g: channels.r, b: channels.r };
    }
    const mask = channels ? [channels.r, channels.g, channels.b, channels.a && image.hasAlpha, channels.k] : [true, true, true, image.hasAlpha, true];
    const histograms = equalization?.histogram ? [equalization.histogram] : Array.from({ length: sync ? 1 : stride }, () => new Float64Array(65536));
    const lookups = equalization?.lookup ? [equalization.lookup] : histograms.map(() => new Float64Array(65536));
    const bin = (value: number): number => Math.max(0, Math.min(65535, Math.round(value * 257)));
    // Recompute bounded spans for the second pass, retaining floating point values
    // until equalization instead of rounding the convolution to eight bits.
    if (virtualPixel === "random" && (seed === undefined || BigInt.asUintN(64, seed) === 0xffffffffffffffffn))
        seed = crypto.getRandomValues(new BigUint64Array(1))[0]!;
    const randomPixels = new Map<number, number>();
    for (let pass = equalization?.lookup ? 1 : 0; pass < 2; pass++) {
        const random = virtualPixel === "random" ? createMagickRandom(seed) : undefined;
        for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 512) {
            yield;
            if (random && left === 0) {
                // Native reads the padded kernel rectangle once per output row.
                // Replay it for equalization and reuse pixels across overlapping spans.
                randomPixels.clear();
                for (let sy = y - half; sy <= y + half; sy++) for (let sx = -half; sx < width + half; sx++) {
                    if (sx >= 0 && sx < width && sy >= 0 && sy < height) continue;
                    yield;
                    randomPixels.set((sy - y + half) * (width + 2 * half) + sx + half,
                        virtualPixelIndex(sx, sy, width, height, virtualPixel, random));
                }
            }
            const count = Math.min(512, width - left), sums = new Float64Array(count * stride);
            for (let k = -half; k <= half; k++) {
                yield;
                const weight = weights[k + half]!;
                if (weight === 0) continue;
                const map = (x: number) => randomPixels.get((k + half) * (width + 2 * half) + left + x - k + half)
                    ?? virtualPixelIndex(left + x - k, y + k, width, height, virtualPixel, random);
                for (let x = 0; x < count;) {
                    yield;
                    const pixel = map(x);
                    let run = 1;
                    const direction = x + 1 < count ? map(x + 1) - pixel : 0;
                    if (direction >= -1 && direction <= 1) {
                        while (x + run < count && (pixel < 0 ? map(x + run) < 0 : map(x + run) === pixel + run * direction && pixel + run * direction >= 0)) run++;
                    }
                    let samples: Uint8Array | Float64Array | number[] = fill;
                    if (pixel >= 0) {
                        const start = direction === -1 ? pixel - run + 1 : pixel;
                        const length = (direction === 0 ? 1 : run) * 4;
                        samples = yield* read(start * 4, length);
                    }
                    for (let i = 0; i < run; i++) {
                        const offset = (pixel < 0 || direction === 0 ? 0 : direction === -1 ? run - i - 1 : i) * stride;
                        const alpha = image.hasAlpha ? samples[offset + 3]! / 255 : 1;
                        for (let channel = 0; channel < stride; channel++) if (channel !== 3) sums[(x + i) * stride + channel]! += samples[offset + channel]! * weight * alpha;
                        sums[(x + i) * stride + 3]! += weight * alpha;
                    }
                    x += run;
                }
            }
            // Keep convolution values unrounded until equalization. Explicit
            // unsynchronized selections use per-channel maps; Sync shares an intensity map.
            for (let x = 0; x < count; x++) {
                const alpha = sums[x * stride + 3]!;
                if (image.hasAlpha) for (let channel = 0; channel < stride; channel++) if (channel !== 3) {
                    sums[x * stride + channel]! /= Math.abs(alpha) < 1e-12 ? (alpha < 0 ? -1e-12 : 1e-12) : alpha;
                }
                sums[x * stride + 3] = alpha * 255;
                // Q16-HDRI stores convolution results as float32 quantum samples.
                for (let channel = 0; channel < stride; channel++) sums[x * stride + channel] = Math.fround(sums[x * stride + channel]! * 257) / 257;
            }
            const region = image.region;
            const position = (y * width + left) * 4;
            const samples = pass === 1 || region || writeMask ? yield* read(position, count * 4) : undefined;
            const protection = new Float64Array(count);
            if (writeMask) {
                const maskX = Math.min(left, writeMask.width - 1), maskCount = Math.min(count, writeMask.width - maskX);
                const maskPosition = (Math.min(y, writeMask.height - 1) * writeMask.width + maskX) * 4;
                const bytes = (yield { kind: "read", highDepth: true, image: 1, position: maskPosition, length: maskCount * 4 })!;
                const pixels = new Uint16Array(bytes.slice().buffer);
                for (let x = 0; x < count; x++) {
                    const offset = Math.min(x, maskCount - 1) * 4;
                    protection[x] = (pixels[offset]! * 0.212656 + pixels[offset + 1]! * 0.715158 + pixels[offset + 2]! * 0.072186) / 65535;
                }
            }
            if (region) for (let x = 0; x < count; x++) if (!regionContains(region, left + x, y)) protection[x] = 1;
            // The native cache composites the write mask after convolution, before
            // building the histogram. Keep HDRI values through both mask applications.
            for (let x = 0; x < count; x++) {
                if (protection[x] === 0) continue;
                const sourceAlpha = protection[x]! * (image.hasAlpha ? samples![x * stride + 3]! / 255 : 1);
                const editedAlpha = image.hasAlpha ? sums[x * stride + 3]! / 255 : 1;
                for (let channel = 0; channel < stride; channel++) if (channel !== 3) sums[x * stride + channel] = samples![x * stride + channel]! * sourceAlpha + sums[x * stride + channel]! * editedAlpha * (1 - sourceAlpha);
                sums[x * stride + 3] = samples![x * stride + 3]!;
            }
            if (pass === 0) {
                for (let x = 0; x < count; x++) {
                    if (!sync) {
                        for (let channel = 0; channel < stride; channel++) if (mask[channel]) histograms[channel]![bin(sums[x * stride + channel]!)]!++;
                    } else histograms[0]![bin(magickIntensity(sums[x * stride]!, sums[x * stride + 1]!, sums[x * stride + 2]!, intensity, 255, linear))]!++;
                }
            } else {
                const values = samples!.slice();
                for (let x = 0; x < count; x++) for (let channel = 0; channel < stride; channel++) {
                    if (!mask[channel]) continue;
                    const map = sync ? 0 : channel, black = histograms[map]![0]!, lookup = lookups[map]!;
                    const value = sums[x * stride + channel]!;
                    let equalized = black === width * height ? value : lookup[bin(value)]!;
                    // Equalization writes through the same mask using the convolved source.
                    if (protection[x] !== 0) {
                        const sourceAlpha = protection[x]! * (image.hasAlpha ? sums[x * stride + 3]! / 255 : 1);
                        const editedAlpha = image.hasAlpha ? (black === width * height ? sums[x * stride + 3]! : lookup[bin(sums[x * stride + 3]!)]!) / 255 : 1;
                        equalized = channel === 3 ? value : value * sourceAlpha + equalized * editedAlpha * (1 - sourceAlpha);
                    }
                    values[x * stride + channel] = Math.fround(equalized * 257) / 257;
                }
                let rgba = values;
                if (cmyk) {
                    const inks = new Float64Array(count * 4);
                    rgba = new Float64Array(count * 4);
                    for (let x = 0; x < count; x++) {
                        inks.set([values[x * stride]! / 255, values[x * stride + 1]! / 255, values[x * stride + 2]! / 255, values[x * stride + 4]! / 255], x * 4);
                        for (let channel = 0; channel < 3; channel++) rgba[x * 4 + channel] = (1 - inks[x * 4 + channel]!) * (1 - inks[x * 4 + 3]!) * 255;
                        rgba[x * 4 + 3] = values[x * stride + 3]!;
                    }
                    yield { kind: "write", hue: true, position, data: new Uint8Array(inks.buffer) };
                }
                const data = highDepth ? Uint16Array.from(rgba, value => Math.max(0, Math.min(65535, Math.round(value * 257))))
                    : Uint8Array.from(rgba, value => Math.max(0, Math.min(255, Math.round(value))));
                yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
                if (hue) yield { kind: "write", hue: true, position, data: new Uint8Array(rgba.map(value => value / 255).buffer) };
                yield { kind: "write", evaluate: true, position, data: new Uint8Array(rgba.buffer) };
            }
        }
        if (pass === 0) for (let channel = 0; channel < histograms.length; channel++) {
            if (!sync && !mask[channel]) continue;
            const histogram = histograms[channel]!, lookup = lookups[channel]!;
            let sum = 0;
            const black = histogram[0]!, range = width * height - black;
            for (let i = 0; i < histogram.length; i++) {
                if (i % 4096 === 0) yield;
                sum += histogram[i]!;
                lookup[i] = range === 0 ? 0 : Math.fround(65535 * (sum - black) / range) / 257;
            }
        }
        // Default selection shares the visible intensity map with every meta plane.
        if (pass === 0 && equalization) {
            equalization.histogram = histograms[0]!;
            equalization.lookup = lookups[0]!;
        }
    }
}
