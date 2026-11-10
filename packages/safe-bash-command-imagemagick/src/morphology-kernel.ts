import type { RgbaColor } from "@poe-code/image-ast/portable";
import type { VirtualPixelMethod } from "./warp-kernel.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

export type MorphologyRow = number | readonly number[];

/** Hit-and-miss is the positive difference between minimum foreground and maximum background. */
export function* hitAndMissPixelSteps(image: { width: number; height: number }, foreground: readonly MorphologyRow[], background: readonly MorphologyRow[], channels?: readonly boolean[], method: "hitandmiss" | "thinning" | "thicken" = "hitandmiss"): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image;
    let work = 0;
    for (let y = 0; y < height; y++) {
        yield;
        for (let x = 0; x < width; x++) {
            const position = (y * width + x) * 4;
            const original = yield { kind: "read", position, length: 4 };
            if (!original || original.length !== 4) throw new Error("Truncated morphology pixels");
            const data = original.slice(), minimum = [255, 255, 255, 255], maximum = [0, 0, 0, 0];
            for (const rows of [foreground, background]) {
                const ry = Math.floor(rows.length / 2);
                for (let row = 0; row < rows.length; row++) {
                    const offsets = rows[row]!;
                    if (typeof offsets === "number") throw new Error("Expected explicit hit-and-miss kernel");
                    for (const offset of offsets) {
                        if (++work % 4096 === 0) yield;
                        const sx = Math.max(0, Math.min(width - 1, x + offset));
                        const sy = Math.max(0, Math.min(height - 1, y + row - ry));
                        const bytes = yield { kind: "read", position: (sy * width + sx) * 4, length: 4 };
                        if (!bytes || bytes.length !== 4) throw new Error("Truncated morphology pixels");
                        for (let c = 0; c < 4; c++) {
                            if (rows === foreground) minimum[c] = Math.min(minimum[c]!, bytes[c]!);
                            else maximum[c] = Math.max(maximum[c]!, bytes[c]!);
                        }
                    }
                }
            }
            for (let c = 0; c < 4; c++)
                if (channels ? channels[c] : c < 3) {
                    const match = Math.max(0, minimum[c]! - maximum[c]!);
                    data[c] = method === "thinning" ? Math.max(0, original[c]! - match)
                        : method === "thicken" ? Math.min(255, original[c]! + match) : match;
                }
            yield { kind: "write", position, data };
        }
    }
}

/** Four-channel sliding histograms; rows gives (width - 1) / 2 at each vertical offset; half-integers allow even windows. Arrays specify sparse horizontal offsets. */
export function* morphologyPixelSteps(image: { width: number; height: number; hasAlpha?: boolean }, rows: readonly MorphologyRow[], mode: "min" | "max" | "median" | "mean" | "mode" | "rms" | "standarddeviation" | "contrast" | "nonpeak", channels?: readonly boolean[], virtualPixel: VirtualPixelMethod = "edge", background?: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const highDepth = mode === "mean" || mode === "rms" || mode === "standarddeviation";
    const { width, height } = image, histogram = new Float64Array(4 * 256);
    const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 128 : 0;
    const fill = new Uint8Array((virtualPixel === "background" || virtualPixel.endsWith("-tile")) && background
        ? [background.r, background.g, background.b, background.a]
        : [gray, gray, gray, virtualPixel === "transparent" ? 0 : 255]);
    const ry = Math.floor(rows.length / 2);
    const samples = rows.reduce<number>((total, radius) => total + (typeof radius === "number" ? radius * 2 + 1 : radius.length), 0);
    const rank = Math.floor(samples / 2), sums = new Float64Array(4), squaredSums = new Float64Array(4);
    let work = 0;
    for (let y = 0; y < height; y++) {
        yield;
        histogram.fill(0);
        sums.fill(0);
        squaredSums.fill(0);
        for (let left = 0; left < width; left += 1024) {
            const count = Math.min(1024, width - left);
            const data = highDepth ? new Uint16Array(count * 4) : new Uint8Array(count * 4);
            if (channels) {
                const original = yield { kind: "read", position: (y * width + left) * 4, length: data.length };
                if (!original || original.length !== data.length) throw new Error("Truncated morphology pixels");
                data.set(highDepth ? Uint16Array.from(original, value => value * 257) : original);
            }
            for (let local = 0; local < count; local++) {
                const x = left + local;
                for (let phase = 0; phase < (x === 0 ? 1 : 2); phase++) {
                    const delta = x === 0 || phase === 1 ? 1 : -1;
                    for (let row = 0; row < rows.length; row++) {
                        const offsets = rows[row]!;
                        const rx = typeof offsets === "number" ? offsets : 0, before = Math.ceil(rx), after = Math.floor(rx);
                        const first = x === 0 ? -before : phase === 0 ? x - before - 1 : x + after;
                        const last = x === 0 ? after : first;
                        const count = typeof offsets === "number" ? last - first + 1 : offsets.length;
                        for (let sample = 0; sample < count; sample++) {
                            const column = typeof offsets === "number" ? first + sample : x + offsets[sample]! - (phase === 0 && x > 0 ? 1 : 0);
                            if (++work % 4096 === 0) yield;
                            const pixel = virtualPixelIndex(column, y + row - ry, width, height, virtualPixel);
                            const bytes = pixel < 0 ? fill : yield { kind: "read", position: pixel * 4, length: 4 };
                            if (!bytes || bytes.length !== 4) throw new Error("Truncated morphology pixels");
                            for (let c = 0; c < 4; c++) {
                                if (channels && !channels[c]) continue;
                                if (mode === "standarddeviation") {
                                    sums[c]! += delta * bytes[c]!;
                                    squaredSums[c]! += delta * bytes[c]! * bytes[c]!;
                                } else if (mode === "rms") sums[c]! += delta * bytes[c]! * bytes[c]!;
                                else if (mode === "mean") sums[c]! += delta * bytes[c]!;
                                else histogram[c * 256 + bytes[c]!]! += delta;
                            }
                        }
                    }
                }
                for (let c = 0; c < 4; c++) {
                    if (channels && !channels[c]) continue;
                    let value = mode === "max" ? 255 : 0, seen = 0;
                    if (mode === "standarddeviation") {
                        const mean = sums[c]! / samples;
                        value = Math.sqrt(Math.max(0, squaredSums[c]! / samples - mean * mean));
                    } else if (mode === "rms") {
                        value = Math.sqrt(sums[c]! / samples);
                    } else if (mode === "mean") {
                        value = sums[c]! / samples;
                    } else if (mode === "mode") {
                        // Ascending traversal preserves the lowest value when frequencies tie.
                        for (let candidate = 0; candidate < 256; candidate++) {
                            const frequency = histogram[c * 256 + candidate]!;
                            if (frequency > seen) { seen = frequency; value = candidate; }
                        }
                    } else if (mode === "contrast") {
                        let minimum = 0, maximum = 255;
                        while (minimum < 255 && histogram[c * 256 + minimum] === 0) minimum++;
                        while (maximum > 0 && histogram[c * 256 + maximum] === 0) maximum--;
                        // ImageMagick 7.1.2-32 uses an unscaled Q16 ratio; convert to bytes.
                        value = c === 3 && image.hasAlpha === false ? 255
                            : maximum + minimum === 0 ? 0 : Math.round((maximum - minimum) / (maximum + minimum) / 257);
                    } else if (mode === "median" || mode === "nonpeak") {
                        for (; value < 255; value++) { seen += histogram[c * 256 + value]!; if (seen > rank) break; }
                        if (mode === "nonpeak") {
                            let previous = value - 1, next = value + 1;
                            while (previous >= 0 && histogram[c * 256 + previous] === 0) previous--;
                            while (next < 256 && histogram[c * 256 + next] === 0) next++;
                            // Move an extreme median to the adjacent distinct value, if any.
                            if (previous < 0 && next < 256) value = next;
                            else if (previous >= 0 && next === 256) value = previous;
                        }
                    } else if (mode === "max") {
                        while (value > 0 && histogram[c * 256 + value] === 0) value--;
                    } else {
                        while (value < 255 && histogram[c * 256 + value] === 0) value++;
                    }
                    // Q16-HDRI stores float quantum samples before rounding to 16-bit output.
                    data[local * 4 + c] = highDepth ? Math.round(Math.fround(value * 257)) : value;
                }
            }
            yield { kind: "write", highDepth, position: (y * width + left) * 4, data: new Uint8Array(data.buffer) };
        }
    }
}
