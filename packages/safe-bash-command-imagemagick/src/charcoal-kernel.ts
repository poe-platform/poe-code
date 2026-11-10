import type { RgbaColor } from "@poe-code/image-ast/portable";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

/** Blur with virtual pixels, normalize, negate and grayscale without rounding intermediate pixels. */
export function* charcoalPixelSteps(image: { width: number; height: number }, geometry: { width?: number; height?: number }, virtualPixel: VirtualPixelMethod = "edge", background?: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, radius = geometry.width ?? 0, sigma = Math.abs(geometry.height ?? 1);
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
    const histogram = new Float64Array(65536);
    let low = 0, high = 65535;
    for (let pass = 0; pass < 2; pass++) {
        for (let left = 0; left < width; left += 1024) {
            const count = Math.min(1024, width - left), rows = new Map<number, Float64Array>();
            for (let y = 0; y < height; y++) {
                yield;
                const sums = new Float64Array(count * 3);
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
                                const bytes = yield { kind: "read", position: start * 4, length: readLength };
                                if (!bytes || bytes.length !== readLength) throw new Error("Truncated charcoal pixels");
                                for (let i = 0; i < run; i++) {
                                    const offset = (direction === 0 ? 0 : direction === -1 ? run - i - 1 : i) * 4;
                                    for (let c = 0; c < 3; c++) samples[(x + i) * 3 + c] = bytes[offset + c]!;
                                }
                                x += run;
                            }
                            for (let x = 0; x < count; x++) {
                                if (x % 32 === 0) yield;
                                for (let k = -half; k <= half; k++) {
                                    const offset = (x + k + half) * 3;
                                    for (let c = 0; c < 3; c++) row[x * 3 + c]! += samples[offset + c]! * weights[k + half]!;
                                }
                            }
                        }
                        if (rows.size >= 32) rows.delete(rows.keys().next().value!);
                        rows.set(sy, row);
                    }
                    for (let i = 0; i < sums.length; i++) sums[i]! += row[i]! * weights[ky + half]!;
                }
                if (pass === 0) {
                    for (let x = 0; x < count; x++) histogram[Math.max(0, Math.min(65535, Math.round(257 * (sums[x * 3]! * 0.212656 + sums[x * 3 + 1]! * 0.715158 + sums[x * 3 + 2]! * 0.072186))))]!++;
                } else {
                    const data = new Uint8Array(count * 4);
                    for (let x = 0; x < count; x++) {
                        let gray = 0;
                        for (let c = 0; c < 3; c++) {
                            const value = high > low ? Math.max(0, Math.min(255, (sums[x * 3 + c]! * 257 - low) / (high - low) * 255)) : sums[x * 3 + c]!;
                            gray += (255 - value) * [0.212656, 0.715158, 0.072186][c]!;
                        }
                        data.fill(Math.round(gray), x * 4, x * 4 + 3); data[x * 4 + 3] = 255;
                    }
                    yield { kind: "write", position: (y * width + left) * 4, data };
                }
            }
        }
        if (pass === 0) {
            let sum = 0;
            for (; low < 65535; low++) { sum += histogram[low]!; if (sum > width * height * 0.02) break; }
            sum = 0;
            for (; high > 0; high--) { sum += histogram[high]!; if (sum > width * height * 0.01) break; }
        }
    }
}
