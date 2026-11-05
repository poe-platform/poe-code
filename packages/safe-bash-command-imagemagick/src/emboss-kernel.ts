import type { ConvolveRequest } from "./convolve-kernel.js";

/** Native emboss diagonal Gaussian convolution followed by synchronized equalization. */
export function* embossPixelSteps(image: { width: number; height: number }, geometry: { width?: number; height?: number }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
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
    const histogram = new Float64Array(65536), lookup = new Uint8Array(65536);
    const bin = (value: number): number => Math.max(0, Math.min(65535, Math.round(value * 257)));
    // Recompute bounded spans for the second pass, retaining floating point values
    // until equalization instead of rounding the convolution to eight bits.
    for (let pass = 0; pass < 2; pass++) {
        for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 1024) {
            yield;
            const count = Math.min(1024, width - left), sums = new Float64Array(count * 3);
            for (let k = -half; k <= half; k++) {
                yield;
                const weight = weights[k + half]!;
                if (weight === 0) continue;
                const sy = Math.max(0, Math.min(height - 1, y + k));
                const first = Math.max(0, Math.min(width - 1, left - k));
                const last = Math.max(0, Math.min(width - 1, left + count - 1 - k));
                const length = (last - first + 1) * 4;
                const bytes = yield { kind: "read", position: (sy * width + first) * 4, length };
                if (!bytes || bytes.length !== length) throw new Error("Truncated emboss pixels");
                for (let x = 0; x < count; x++) {
                    const offset = (Math.max(0, Math.min(width - 1, left + x - k)) - first) * 4;
                    for (let channel = 0; channel < 3; channel++) sums[x * 3 + channel]! += bytes[offset + channel]! * weight;
                }
            }
            if (pass === 0) {
                for (let x = 0; x < count; x++) histogram[bin(sums[x * 3]! * 0.212656 + sums[x * 3 + 1]! * 0.715158 + sums[x * 3 + 2]! * 0.072186)]!++;
            } else {
                const position = (y * width + left) * 4;
                const bytes = yield { kind: "read", position, length: count * 4 };
                if (!bytes || bytes.length !== count * 4) throw new Error("Truncated emboss pixels");
                const data = new Uint8Array(bytes), black = histogram[0]!;
                for (let x = 0; x < count; x++) for (let channel = 0; channel < 3; channel++) {
                    const value = sums[x * 3 + channel]!;
                    data[x * 4 + channel] = black === width * height ? Math.max(0, Math.min(255, Math.round(value))) : lookup[bin(value)]!;
                }
                yield { kind: "write", position, data };
            }
        }
        if (pass === 0) {
            let sum = 0;
            const black = histogram[0]!, range = width * height - black;
            for (let i = 0; i < histogram.length; i++) {
                if (i % 4096 === 0) yield;
                sum += histogram[i]!;
                lookup[i] = range === 0 ? 0 : Math.round(255 * (sum - black) / range);
            }
        }
    }
}
