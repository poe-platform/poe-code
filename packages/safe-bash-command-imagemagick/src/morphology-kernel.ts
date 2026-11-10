import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
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
export function* morphologyPixelSteps(image: Pick<RgbaImage, "width" | "height" | "data16"> & Partial<Pick<RgbaImage, "hasAlpha"> & Pick<StoredRgbaImage, "storedData16">>, rows: readonly MorphologyRow[], mode: "min" | "max" | "median" | "mean" | "mode" | "rms" | "standarddeviation" | "contrast" | "nonpeak", channels?: readonly boolean[], virtualPixel: VirtualPixelMethod = "edge", background?: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, highDepth = virtualPixel === "gray" || !!(image.data16 || image.storedData16);
    const outputHighDepth = highDepth || mode === "mean" || mode === "rms" || mode === "standarddeviation" || mode === "contrast";
    const scale = highDepth ? 257 : 1, bins = highDepth ? 65536 : 256, maximumSample = bins - 1;
    const histogram = new Float64Array(4 * bins), groups = highDepth ? new Float64Array(4 * 256) : undefined;
    // Skip empty high-byte groups instead of scanning all 65,536 bins for each pixel.
    function nextValue(channel: number, value: number, direction: 1 | -1): number {
        while (value >= 0 && value < bins) {
            if (groups && groups[channel * 256 + (value >>> 8)] === 0)
                value = direction === 1 ? (value | 255) + 1 : (value & ~255) - 1;
            else if (histogram[channel * bins + value] !== 0) break;
            else value += direction;
        }
        return value;
    }
    // ImageMagick's gray virtual pixel is the Q16 midpoint, quantum 32768.
    const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 32768 / 257 : 0;
    const fill = ((virtualPixel === "background" || virtualPixel.endsWith("-tile")) && background
        ? [background.r, background.g, background.b, background.a]
        : [gray, gray, gray, virtualPixel === "transparent" ? 0 : 255]).map(value => Math.round(value * scale));
    const ry = Math.floor(rows.length / 2);
    const samples = rows.reduce<number>((total, radius) => total + (typeof radius === "number" ? radius * 2 + 1 : radius.length), 0);
    const rank = Math.floor(samples / 2), sums = new Float64Array(4), squaredSums = new Float64Array(4);
    let work = 0;
    for (let y = 0; y < height; y++) {
        yield;
        histogram.fill(0);
        groups?.fill(0);
        sums.fill(0);
        squaredSums.fill(0);
        for (let left = 0; left < width; left += 1024) {
            const count = Math.min(1024, width - left);
            const data = outputHighDepth ? new Uint16Array(count * 4) : new Uint8Array(count * 4);
            if (channels) {
                const original = yield { kind: "read", highDepth, position: (y * width + left) * 4, length: data.length };
                if (!original || original.length !== data.length * (highDepth ? 2 : 1)) throw new Error("Truncated morphology pixels");
                data.set(highDepth ? new Uint16Array(original.buffer, original.byteOffset, data.length)
                    : outputHighDepth ? Uint16Array.from(original, value => value * 257) : original);
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
                            const bytes = pixel < 0 ? undefined : yield { kind: "read", highDepth, position: pixel * 4, length: 4 };
                            if (pixel >= 0 && (!bytes || bytes.length !== (highDepth ? 8 : 4))) throw new Error("Truncated morphology pixels");
                            const values = bytes ? highDepth ? new Uint16Array(bytes.buffer, bytes.byteOffset, 4) : bytes : fill;
                            for (let c = 0; c < 4; c++) {
                                if (channels && !channels[c]) continue;
                                if (mode === "standarddeviation") {
                                    sums[c]! += delta * values[c]!;
                                    squaredSums[c]! += delta * values[c]! * values[c]!;
                                } else if (mode === "rms") sums[c]! += delta * values[c]! * values[c]!;
                                else if (mode === "mean") sums[c]! += delta * values[c]!;
                                else {
                                    histogram[c * bins + values[c]!]! += delta;
                                    if (groups) groups[c * 256 + (values[c]! >>> 8)]! += delta;
                                }
                            }
                        }
                    }
                }
                for (let c = 0; c < 4; c++) {
                    if (channels && !channels[c]) continue;
                    let value = 0, seen = 0;
                    if (mode === "standarddeviation") {
                        const mean = sums[c]! / samples;
                        value = Math.sqrt(Math.max(0, squaredSums[c]! / samples - mean * mean));
                    } else if (mode === "rms") {
                        value = Math.sqrt(sums[c]! / samples);
                    } else if (mode === "mean") {
                        value = sums[c]! / samples;
                    } else if (mode === "mode") {
                        // Ascending traversal preserves the lowest value when frequencies tie.
                        for (let candidate = nextValue(c, 0, 1); candidate < bins; candidate = nextValue(c, candidate + 1, 1)) {
                            if (++work % 4096 === 0) yield;
                            const frequency = histogram[c * bins + candidate]!;
                            if (frequency > seen) { seen = frequency; value = candidate; }
                        }
                    } else if (mode === "contrast") {
                        const minimum = nextValue(c, 0, 1), maximum = nextValue(c, maximumSample, -1);
                        // Native Contrast scales the min/max ratio to the quantum range.
                        value = c === 3 && image.hasAlpha === false ? maximumSample
                            : maximum + minimum === 0 ? 0 : maximumSample * (maximum - minimum) / (maximum + minimum);
                    } else if (mode === "median" || mode === "nonpeak") {
                        for (value = nextValue(c, 0, 1); value < maximumSample; value = nextValue(c, value + 1, 1)) {
                            if (++work % 4096 === 0) yield;
                            seen += histogram[c * bins + value]!;
                            if (seen > rank) break;
                        }
                        if (mode === "nonpeak") {
                            const previous = nextValue(c, value - 1, -1), next = nextValue(c, value + 1, 1);
                            // Move an extreme median to the adjacent distinct value, if any.
                            if (previous < 0 && next < bins) value = next;
                            else if (previous >= 0 && next === bins) value = previous;
                        }
                    } else if (mode === "max") {
                        value = nextValue(c, maximumSample, -1);
                    } else {
                        value = nextValue(c, 0, 1);
                    }
                    // Q16-HDRI stores float quantum samples before rounding to 16-bit output.
                    data[local * 4 + c] = outputHighDepth ? Math.round(Math.fround(value * 257 / scale)) : value;
                }
            }
            yield { kind: "write", highDepth: outputHighDepth, position: (y * width + left) * 4, data: new Uint8Array(data.buffer) };
        }
    }
}
