import type { ConvolveRequest } from "./convolve-kernel.js";

function sinc(x: number): number {
    return Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
}

function contributions(index: number, source: number, target: number, blur: number) {
    const scale = Math.max(1, source / target) * blur, center = (index + 0.5) * source / target - 0.5;
    const first = Math.max(0, Math.ceil(center - 3 * scale)), last = Math.min(source - 1, Math.floor(center + 3 * scale));
    const weights = new Float64Array(last - first + 1);
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
        const distance = (first + i - center) / scale;
        weights[i] = sinc(distance) * sinc(distance / 3);
        sum += weights[i]!;
    }
    for (let i = 0; i < weights.length; i++) weights[i]! /= sum;
    return { first, weights };
}

/** ImageMagick Lanczos: truncate support at edges and retain floating point between passes. */
export function* resizePixelSteps(image: { width: number; height: number; hasAlpha: boolean }, width: number, height: number, thumbnail: boolean): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const blur = thumbnail ? 0.9812505644269356 : 1;
    for (let left = 0; left < width; left += 256) {
        const count = Math.min(256, width - left), horizontal = Array.from({ length: count }, (_, x) => contributions(left + x, image.width, width, blur));
        const rows = new Map<number, Float64Array>();
        for (let y = 0; y < height; y++) {
            yield;
            const vertical = contributions(y, image.height, height, blur), sums = new Float64Array(count * 4);
            for (let k = 0; k < vertical.weights.length; k++) {
                const sy = vertical.first + k;
                let row = rows.get(sy);
                if (!row) {
                    yield;
                    row = new Float64Array(count * 4);
                    const first = horizontal[0]!.first, last = horizontal[count - 1]!;
                    const end = last.first + last.weights.length;
                    for (let start = first; start < end; start += 1024) {
                        if (start > first) yield;
                        const length = Math.min(1024, end - start);
                        const bytes = yield { kind: "read", position: (sy * image.width + start) * 4, length: length * 4 };
                        if (!bytes || bytes.length !== length * 4) throw new Error("Truncated resize pixels");
                        for (let x = 0; x < count; x++) {
                            const contribution = horizontal[x]!;
                            for (let sx = Math.max(start, contribution.first); sx < Math.min(start + length, contribution.first + contribution.weights.length); sx++) {
                                const i = sx - start, weight = contribution.weights[sx - contribution.first]!;
                                const alpha = image.hasAlpha ? bytes[i * 4 + 3]! / 255 : 1;
                                for (let channel = 0; channel < 3; channel++) row[x * 4 + channel]! += bytes[i * 4 + channel]! * alpha * weight;
                                row[x * 4 + 3]! += alpha * weight;
                            }
                        }
                    }
                    if (rows.size === 64) rows.delete(rows.keys().next().value!);
                    rows.set(sy, row);
                }
                for (let i = 0; i < sums.length; i++) sums[i]! += row[i]! * vertical.weights[k]!;
            }
            const data = new Uint8Array(count * 4);
            for (let x = 0; x < count; x++) {
                const alpha = sums[x * 4 + 3]!;
                for (let channel = 0; channel < 3; channel++) data[x * 4 + channel] = Math.round(Math.max(0, Math.min(255, Math.abs(alpha) < 1e-12 ? 0 : sums[x * 4 + channel]! / alpha)));
                data[x * 4 + 3] = Math.round(Math.max(0, Math.min(255, alpha * 255)));
            }
            yield { kind: "write", position: (y * width + left) * 4, data };
        }
    }
}
