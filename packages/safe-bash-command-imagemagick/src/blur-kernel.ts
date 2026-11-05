import type { ConvolveRequest } from "./convolve-kernel.js";

/** Native sampled Gaussian or rank-three blur, with bounded row caching. */
export function* blurPixelSteps(image: { width: number; height: number }, geometry: { width?: number; height?: number }, gaussian: boolean): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
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
                if (edge / (gaussian ? sum * sum : sum) < 1 / 65535) { half--; break; }
            }
        }
    }
    if (!Number.isFinite(half) || half >= 5000) throw new Error("Blur radius exceeds 5000");
    const weights = new Float64Array(half * 2 + 1);
    let total = 0;
    for (let k = -half; k <= half; k++) {
        let weight = sigma === 0 ? 1 : 0;
        if (sigma > 0) for (let sub = gaussian ? 0 : -1; sub <= (gaussian ? 0 : 1); sub++) weight += Math.exp(-((k + sub / 3) ** 2) / (2 * sigma * sigma));
        weights[k + half] = weight; total += weight;
    }
    for (let k = 0; k < weights.length; k++) weights[k]! /= total;
    for (let left = 0; left < width; left += 1024) {
        const count = Math.min(1024, width - left), rows = new Map<number, Float64Array>();
        for (let y = 0; y < height; y++) {
            yield;
            const sums = new Float64Array(count * 4);
            for (let ky = -half; ky <= half; ky++) {
                yield;
                const sy = Math.max(0, Math.min(height - 1, y + ky));
                let row = rows.get(sy);
                if (!row) {
                    const first = Math.max(0, left - half), last = Math.min(width - 1, left + count - 1 + half), length = (last - first + 1) * 4;
                    const bytes = yield { kind: "read", position: (sy * width + first) * 4, length };
                    if (!bytes || bytes.length !== length) throw new Error("Truncated blur pixels");
                    row = new Float64Array(count * 4);
                    for (let x = 0; x < count; x++) {
                        if (x % 32 === 0) yield;
                        for (let k = -half; k <= half; k++) {
                            const offset = (Math.max(0, Math.min(width - 1, left + x + k)) - first) * 4;
                            const alpha = bytes[offset + 3]! / 255, weight = weights[k + half]!;
                            for (let c = 0; c < 3; c++) row[x * 4 + c]! += bytes[offset + c]! * alpha * weight;
                            row[x * 4 + 3]! += alpha * weight;
                        }
                    }
                    if (rows.size >= 32) rows.delete(rows.keys().next().value!);
                    rows.set(sy, row);
                }
                for (let i = 0; i < sums.length; i++) sums[i]! += row[i]! * weights[ky + half]!;
            }
            const data = new Uint8Array(count * 4);
            for (let x = 0; x < count; x++) {
                const alpha = sums[x * 4 + 3]!;
                for (let c = 0; c < 3; c++) data[x * 4 + c] = alpha > 0 ? Math.round(sums[x * 4 + c]! / alpha) : 0;
                data[x * 4 + 3] = Math.round(alpha * 255);
            }
            yield { kind: "write", position: (y * width + left) * 4, data };
        }
    }
}
