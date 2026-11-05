import type { ConvolveRequest } from "./convolve-kernel.js";

function sinc(x: number): number {
    return Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
}

function contributions(index: number, source: number, target: number, blur: number, area: boolean) {
    if (area) {
        const start = index * source, end = (index + 1) * source;
        const first = Math.floor(start / target), last = Math.ceil(end / target) - 1;
        const weights = Float64Array.from({ length: last - first + 1 }, (_, i) =>
            (Math.min(end, (first + i + 1) * target) - Math.max(start, (first + i) * target)) / source);
        return { first, weights };
    }

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

/** ImageMagick area scaling or Lanczos filtering, retaining floating point between passes. */
export function* resizePixelSteps(image: { width: number; height: number; hasAlpha: boolean }, width: number, height: number, thumbnail: boolean, scale = false): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const blur = thumbnail ? 0.9812505644269356 : 1;
    for (let left = 0; left < width; left += 256) {
        const count = Math.min(256, width - left), horizontal = Array.from({ length: count }, (_, x) => contributions(left + x, image.width, width, blur, scale));
        const rows = new Map<number, Float64Array>();
        for (let y = 0; y < height; y++) {
            yield;
            const vertical = contributions(y, image.height, height, blur, scale), sums = new Float64Array(count * 4);
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

/** Point filtering selects the source pixel containing the destination pixel center. */
export function* pointResizePixelSteps(image: { width: number; height: number }, width: number, height: number, sample = false): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    // SampleImage uses 0.5 - MagickEpsilon to select the preceding pixel at ties.
    const offset = sample ? 0.5 - 1e-12 : 0.5;
    let start = -1;
    let pixels: Uint8Array = new Uint8Array(0);
    for (let y = 0; y < height; y++) {
        const sy = Math.min(image.height - 1, Math.floor((y + offset) * image.height / height));
        for (let left = 0; left < width; left += 1024) {
            yield;
            const count = Math.min(1024, width - left), data = new Uint8Array(count * 4);
            for (let x = 0; x < count; x++) {
                const sx = Math.min(image.width - 1, Math.floor((left + x + offset) * image.width / width));
                const position = (sy * image.width + sx) * 4;
                if (position < start || position >= start + pixels.length) {
                    start = position;
                    const length = Math.min(1024, image.width - sx) * 4;
                    const bytes = yield { kind: "read", position, length };
                    if (!bytes || bytes.length !== length) throw new Error("Truncated resize pixels");
                    pixels = bytes;
                }
                data.set(pixels.subarray(position - start, position - start + 4), x * 4);
            }
            yield { kind: "write", position: (y * width + left) * 4, data };
        }
    }
}
