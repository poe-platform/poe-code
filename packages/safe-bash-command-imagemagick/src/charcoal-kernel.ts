import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";
import { edgePixelSteps } from "./edge-kernel.js";
import { magickIntensity } from "./intensity.js";
import { regionContains, type Region } from "./region.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

/** Feed the active color planes to the edge filter, retaining alpha from RGBA. */
export function* charcoalEdgePixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "data16" | "hueSamples"> & Partial<Pick<StoredRgbaImage, "storedData16" | "storedHueSamples">>, radius: number, channels: { r: boolean; g: boolean; b: boolean; a: boolean } | undefined, virtualPixel: VirtualPixelMethod = "edge", background?: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const hue = !!image.hueSamples || image.storedHueSamples !== undefined;
    const steps = edgePixelSteps(image, radius, channels, virtualPixel, background);
    let next = steps.next();
    while (!next.done) {
        const request = next.value;
        if (request?.kind === "read" && hue) {
            const bytes = yield { ...request, hue: true };
            if (!bytes || bytes.length !== request.length * 8) throw new Error("Truncated charcoal color planes");
            const planes = new Float64Array(bytes.slice().buffer);
            const rgba = yield request;
            if (!rgba) throw new Error("Truncated charcoal alpha");
            const maximum = request.highDepth ? 65535 : 255;
            const samples = request.highDepth ? new Uint16Array(rgba.slice().buffer) : rgba.slice();
            for (let i = 0; i < samples.length; i++) if (i % 4 !== 3) samples[i] = Math.round(planes[i]! * maximum);
            next = steps.next(new Uint8Array(samples.buffer));
        } else next = steps.next(yield request);
    }
}

/** Blur clamped edges, normalize, negate and grayscale without rounding intermediate pixels. */
export function* charcoalPixelSteps(image: Pick<RgbaImage, "width" | "height" | "data16"> & Partial<Pick<StoredRgbaImage, "storedData16">> & { magickColorspace?: string; region?: Region | undefined }, geometry: { width?: number; height?: number }, writeMask: Pick<RgbaImage, "width" | "height"> | undefined, channels: { r: boolean; g: boolean; b: boolean; a: boolean } | undefined, virtualPixel: VirtualPixelMethod = "edge", background?: RgbaColor, intensity = "rec709luma"): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const highDepth = !!(image.data16 || image.storedData16);
    const { width, height } = image, radius = geometry.width ?? 0, sigma = Math.abs(geometry.height ?? 1);
    const mask = channels ? [channels.r, channels.g, channels.b] : [true, true, true];
    let half = 0;
    if (sigma > 0) {
        if (radius > 0) half = radius >= 1 ? Math.floor(radius) : Math.ceil(radius);
        else {
            let sum = 1 + 2 * Math.exp(-1 / (2 * sigma * sigma));
            for (half = 2; half < 5000; half++) {
                yield;
                const edge = Math.exp(-half * half / (2 * sigma * sigma));
                sum += 2 * edge;
                if (edge / sum < 1 / 65535) { half--; break; }
            }
        }
    }
    if (!Number.isFinite(half) || half >= 5000) throw new Error("Charcoal blur radius exceeds 5000");
    const weights = new Float64Array(half * 2 + 1);
    let total = 0;
    for (let k = -half; k <= half; k++) {
        let weight = sigma === 0 ? 1 : 0;
        if (sigma > 0) for (let sub = -1; sub <= 1; sub++) weight += Math.exp(-((k + sub / 3) ** 2) / (2 * sigma * sigma));
        weights[k + half] = weight; total += weight;
    }
    for (let k = 0; k < weights.length; k++) weights[k]! /= total;
    const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 127.5 : 0;
    const fill = (virtualPixel === "background" || virtualPixel.endsWith("-tile")) && background
        ? [background.r, background.g, background.b] : [gray, gray, gray];
    function* protections(left: number, y: number, count: number): Generator<ConvolveRequest | undefined, Float64Array, Uint8Array | undefined> {
        const result = new Float64Array(count);
        const bytes = writeMask ? (yield { kind: "read", image: 1, position: (y * width + left) * 4, length: count * 4 })! : undefined;
        for (let x = 0; x < count; x++) result[x] = image.region && !regionContains(image.region, left + x, y) ? 1
            : bytes ? (bytes[x * 4]! * 0.212656 + bytes[x * 4 + 1]! * 0.715158 + bytes[x * 4 + 2]! * 0.072186) / 255 : 0;
        return result;
    }
    const histograms = Array.from({ length: channels ? 3 : 1 }, () => new Float64Array(65536));
    const lows = histograms.map(() => 0), highs = histograms.map(() => 65535);
    for (let pass = 0; pass < 2; pass++) {
        for (let left = 0; left < width; left += 1024) {
            const count = Math.min(1024, width - left), rows = new Map<number, Float64Array>();
            for (let y = 0; y < height; y++) {
                yield;
                const sums = new Float64Array(count * 3);
                let original: Float64Array | undefined;
                for (let ky = -half; ky <= half; ky++) {
                    yield;
                    const pixel = virtualPixelIndex(left, y + ky, width, height, virtualPixel);
                    const sy = pixel < 0 ? -1 : Math.floor(pixel / width);
                    let row = rows.get(sy);
                    if (!row) {
                        row = new Float64Array(count * 3);
                        if (sy < 0) {
                            // The vertical pass samples the horizontal result: outside rows
                            // use the constant directly, without another horizontal blur.
                            for (let x = 0; x < count; x++) row.set(fill, x * 3);
                        } else {
                            const first = left - half, length = count + 2 * half;
                            const samples = new Float64Array(length * 3);
                            const map = (x: number) => virtualPixelIndex(first + x, sy, width, height, virtualPixel);
                            for (let x = 0; x < length;) {
                                yield;
                                const source = map(x);
                                if (source < 0) { samples.set(fill, x * 3); x++; continue; }
                                const direction = map(x + 1) - source;
                                let run = 1;
                                if (direction >= -1 && direction <= 1) {
                                    while (x + run < length && map(x + run) === source + run * direction && source + run * direction >= 0) run++;
                                }
                                const start = direction === -1 ? source - run + 1 : source;
                                const readLength = (direction === 0 ? 1 : run) * 4;
                                const working = yield { kind: "read", evaluate: true, position: start * 4, length: readLength };
                                const bytes = working?.length ? undefined : yield { kind: "read", highDepth, position: start * 4, length: readLength };
                                if (!working?.length && (!bytes || bytes.length !== readLength * (highDepth ? 2 : 1))) throw new Error("Truncated charcoal pixels");
                                const values = working?.length ? Float64Array.from(new Float64Array(working.slice().buffer), value => Math.max(0, Math.min(255, value)))
                                    : highDepth ? Float64Array.from(new Uint16Array(bytes!.slice().buffer), value => value / 257) : bytes!;
                                for (let i = 0; i < run; i++) {
                                    const offset = (direction === 0 ? 0 : direction === -1 ? run - i - 1 : i) * 4;
                                    for (let c = 0; c < 3; c++) samples[(x + i) * 3 + c] = values[offset + c]!;
                                }
                                x += run;
                            }
                            for (let x = 0; x < count; x++) {
                                if (x % 32 === 0) yield;
                                for (let k = -half; k <= half; k++) {
                                    const offset = (x + k + half) * 3;
                                    for (let c = 0; c < 3; c++) if (mask[c]) row[x * 3 + c]! += samples[offset + c]! * weights[k + half]!;
                                }
                            }
                            // Each blur pass writes through the mask before the next pass reads it.
                            const protection = yield* protections(left, sy, count);
                            for (let x = 0; x < count; x++) for (let c = 0; c < 3; c++) row[x * 3 + c] = row[x * 3 + c]! * (1 - protection[x]!) + samples[(x + half) * 3 + c]! * protection[x]!;
                        }
                        if (rows.size >= 32) rows.delete(rows.keys().next().value!);
                        rows.set(sy, row);
                    }
                    if (ky === 0) original = row;
                    for (let i = 0; i < sums.length; i++) sums[i]! += row[i]! * weights[ky + half]!;
                }
                const protection = yield* protections(left, y, count);
                for (let x = 0; x < count; x++) for (let c = 0; c < 3; c++) sums[x * 3 + c] = sums[x * 3 + c]! * (1 - protection[x]!) + original![x * 3 + c]! * protection[x]!;
                if (channels && mask.some(selected => !selected)) {
                    const bytes = yield { kind: "read", highDepth, position: (y * width + left) * 4, length: count * 4 };
                    if (!bytes || bytes.length !== count * 4 * (highDepth ? 2 : 1)) throw new Error("Truncated charcoal pixels");
                    const values = highDepth ? new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2) : bytes;
                    for (let x = 0; x < count; x++) for (let c = 0; c < 3; c++) if (!mask[c]) sums[x * 3 + c] = values[x * 4 + c]! / (highDepth ? 257 : 1);
                }
                if (pass === 0) {
                    for (let x = 0; x < count; x++) {
                        if (channels) {
                            for (let c = 0; c < 3; c++) if (mask[c]) histograms[c]![Math.max(0, Math.min(65535, Math.round(257 * sums[x * 3 + c]!)))]!++;
                        } else histograms[0]![Math.max(0, Math.min(65535, Math.round(257 * magickIntensity(sums[x * 3]!, sums[x * 3 + 1]!, sums[x * 3 + 2]!, intensity, 255, image.magickColorspace === "RGB"))))]!++;
                    }
                } else {
                    const data = new Uint16Array(count * 4);
                    for (let x = 0; x < count; x++) {
                        const negated = new Float64Array(3);
                        for (let c = 0; c < 3; c++) {
                            const low = lows[channels ? c : 0]!, high = highs[channels ? c : 0]!;
                            // Normalize indexes a Q16 lookup table before the final grayscale conversion.
                            const value = mask[c] && high > low ? Math.max(0, Math.min(255, (Math.round(sums[x * 3 + c]! * 257) - low) / (high - low) * 255)) : sums[x * 3 + c]!;
                            const normalized = value * (1 - protection[x]!) + sums[x * 3 + c]! * protection[x]!;
                            negated[c] = mask[c] ? (255 - normalized) * (1 - protection[x]!) + normalized * protection[x]! : normalized;
                        }
                        // Grayscale collapses the color planes even where the mask protects the red sample.
                        const gray = magickIntensity(negated[0]!, negated[1]!, negated[2]!, intensity, 255, image.magickColorspace === "RGB") * (1 - protection[x]!) + negated[0]! * protection[x]!;
                        data.fill(Math.min(65535, Math.round(gray * 257 * (intensity === "ms" ? 65535 : 1))), x * 4, x * 4 + 3); data[x * 4 + 3] = 65535;
                    }
                    yield { kind: "write", highDepth: true, position: (y * width + left) * 4, data: new Uint8Array(data.buffer) };
                }
            }
        }
        if (pass === 0) for (let c = 0; c < histograms.length; c++) {
            if (channels && !mask[c]) continue;
            const histogram = histograms[c]!;
            let low = 0, high = 65535;
            let sum = 0;
            for (; low < 65535; low++) { sum += histogram[low]!; if (sum > width * height * 0.02) break; }
            sum = 0;
            for (; high > 0; high--) { sum += histogram[high]!; if (sum > width * height * 0.01) break; }
            lows[c] = low; highs[c] = high;
        }
    }
}
