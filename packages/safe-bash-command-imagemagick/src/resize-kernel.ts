import { interpolatePixelSteps } from "./sequence-kernel.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

function sinc(x: number): number {
    return Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
}

function contributions(index: number, source: number, target: number, blur: number, area: boolean, kernel: "lanczos3" | "mitchell", thumbnailFactor = 0) {
    if (thumbnailFactor >= 3) {
        // ThumbnailImage samples to 4x, box-filters to 2x, then applies the final
        // filter. Compose the weights to retain HDRI precision without temporary rasters.
        const sampled = thumbnailFactor >= 5 ? 4 * target : source;
        const filtered = contributions(index, 2 * target, target, blur, false, kernel);
        const boxes = Array.from(filtered.weights, (_, i) => {
            const center = (filtered.first + i + 0.5) * sampled / (2 * target);
            const support = sampled / (4 * target);
            return { first: Math.max(0, Math.floor(center - support + 0.5 + 1e-12)),
                end: Math.min(sampled, Math.floor(center + support + 0.5 + 1e-12)) };
        });
        const sourceIndex = (i: number) => Math.floor((i + 0.5 - 1e-12) * source / sampled);
        const first = sourceIndex(boxes[0]!.first), last = sourceIndex(boxes[boxes.length - 1]!.end - 1);
        const weights = new Float64Array(last - first + 1);
        for (let i = 0; i < boxes.length; i++) {
            const box = boxes[i]!;
            for (let j = box.first; j < box.end; j++) weights[sourceIndex(j) - first]! += filtered.weights[i]! / (box.end - box.first);
        }
        return { first, weights };
    }
    if (area) {
        const start = index * source, end = (index + 1) * source;
        const first = Math.floor(start / target), last = Math.ceil(end / target) - 1;
        const weights = Float64Array.from({ length: last - first + 1 }, (_, i) =>
            (Math.min(end, (first + i + 1) * target) - Math.max(start, (first + i) * target)) / source);
        return { first, weights };
    }
    const scale = Math.max(1, source / target) * blur, center = (index + 0.5) * source / target - 0.5;
    const support = (kernel === "mitchell" ? 2 : 3) * scale;
    const first = Math.max(0, Math.ceil(center - support)), last = Math.min(source - 1, Math.floor(center + support));
    const weights = new Float64Array(last - first + 1);
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
        const distance = (first + i - center) / scale;
        const x = Math.abs(distance);
        weights[i] = kernel === "mitchell"
            ? (x < 1 ? (7 * x * x * x - 12 * x * x + 16 / 3) / 6 : (-7 / 3 * x * x * x + 12 * x * x - 20 * x + 32 / 3) / 6)
            : sinc(distance) * sinc(distance / 3);
        sum += weights[i]!;
    }
    for (let i = 0; i < weights.length; i++) weights[i]! /= sum;
    return { first, weights };
}

type ResizeImage = { width: number; height: number; hasAlpha: boolean };
type ResizeSamples = Generator<ConvolveRequest | { kind: "samples"; position: number; data: Float64Array } | undefined, void, Uint8Array | undefined>;

/** Keep HDRI samples unclamped until all resizing and morph blending is finished. */
function* resizeSamples(image: ResizeImage, width: number, height: number, thumbnail: boolean, scale: boolean, kernel: "lanczos3" | "mitchell", highDepth = false): ResizeSamples {
    const range = highDepth ? 65535 : 255;
    const blur = thumbnail && kernel === "lanczos3" ? 0.9812505644269356 : 1;
    const thumbnailFactor = thumbnail ? Math.floor(Math.min(image.width / width, image.height / height)) : 0;
    for (let left = 0; left < width; left += 256) {
        const count = Math.min(256, width - left), horizontal = Array.from({ length: count }, (_, x) => contributions(left + x, image.width, width, blur, scale, kernel, thumbnailFactor));
        const rows = new Map<number, Float64Array>();
        for (let y = 0; y < height; y++) {
            yield;
            const vertical = contributions(y, image.height, height, blur, scale, kernel, thumbnailFactor), sums = new Float64Array(count * 4);
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
                        const bytes = yield { kind: "read", highDepth, position: (sy * image.width + start) * 4, length: length * 4 };
                        if (!bytes || bytes.length !== length * 4 * (highDepth ? 2 : 1)) throw new Error("Truncated resize pixels");
                        const pixels = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
                        for (let x = 0; x < count; x++) {
                            const contribution = horizontal[x]!;
                            for (let sx = Math.max(start, contribution.first); sx < Math.min(start + length, contribution.first + contribution.weights.length); sx++) {
                                const i = sx - start, weight = contribution.weights[sx - contribution.first]!;
                                const alpha = image.hasAlpha ? pixels[i * 4 + 3]! / range : 1;
                                for (let channel = 0; channel < 3; channel++) row[x * 4 + channel]! += pixels[i * 4 + channel]! * alpha * weight;
                                row[x * 4 + 3]! += alpha * weight;
                            }
                        }
                    }
                    if (rows.size === 64) rows.delete(rows.keys().next().value!);
                    rows.set(sy, row);
                }
                for (let i = 0; i < sums.length; i++) sums[i]! += row[i]! * vertical.weights[k]!;
            }
            for (let x = 0; x < count; x++) {
                const alpha = sums[x * 4 + 3]!;
                for (let channel = 0; channel < 3; channel++) sums[x * 4 + channel] = Math.abs(alpha) < 1e-12 ? 0 : sums[x * 4 + channel]! / alpha;
                sums[x * 4 + 3] = alpha * range;
            }
            yield { kind: "samples", position: (y * width + left) * 4, data: sums };
        }
    }
}

export function* resizePixelSteps(image: ResizeImage, width: number, height: number, thumbnail: boolean, scale = false, kernel: "lanczos3" | "mitchell" = "lanczos3"): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const samples = resizeSamples(image, width, height, thumbnail, scale, kernel);
    let next = samples.next();
    while (!next.done) {
        const request = next.value;
        if (request?.kind !== "samples") { next = samples.next(yield request); continue; }
        const data = Uint8Array.from(request.data, (sample, index) => {
            const value = Math.max(0, Math.min(255, sample));
            // Match the Q16-HDRI float quantum conversion at half-byte ties.
            return thumbnail && index % 4 !== 3 ? Math.floor(Math.fround(Math.fround(Math.fround(value * 257) / 257) + 0.5)) : Math.round(value);
        });
        yield { kind: "write", position: request.position, data };
        next = samples.next();
    }
}

export function* morphPixelSteps(a: ResizeImage, b: ResizeImage, width: number, height: number, fraction: number, channels?: readonly boolean[], highDepth = false): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    // ImageMagick retains the first image's alpha unless both alpha channels are active.
    const blendAlpha = a.hasAlpha && b.hasAlpha;
    if (a.width === width && a.height === height && b.width === width && b.height === height) {
        yield* interpolatePixelSteps(width * height * 4, fraction, blendAlpha, channels, highDepth);
        return;
    }
    const sources = [a, b].map(image => resizeSamples(image, width, height, false,
        image.width === width && image.height === height,
        image.hasAlpha || width * height > image.width * image.height ? "mitchell" : "lanczos3", highDepth));
    while (true) {
        let blended: Float64Array | undefined, position = 0;
        for (let image = 0; image < sources.length; image++) {
            const source = sources[image]!;
            let next = source.next();
            while (!next.done && next.value?.kind !== "samples") {
                const request = next.value;
                next = source.next(yield request?.kind === "read" ? { ...request, image } : request);
            }
            if (next.done) return;
            const samples = next.value!;
            if (samples.kind !== "samples") return;
            position = samples.position;
            if (!blended) blended = Float64Array.from(samples.data, (value, i) => i % 4 === 3 && !blendAlpha ? value : value * (1 - fraction));
            else for (let i = 0; i < blended.length; i++) {
                if (i % 4 === 3 && !blendAlpha) continue;
                if (channels && !channels[i % 4]) blended[i] = samples.data[i]!;
                else blended[i]! += samples.data[i]! * fraction;
            }
        }
        const range = highDepth ? 65535 : 255;
        const rounded = blended!.map(value => Math.round(Math.max(0, Math.min(range, value))));
        const data = highDepth ? Uint16Array.from(rounded) : Uint8Array.from(rounded);
        yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
    }
}

/** Point filtering selects the source pixel containing the destination pixel center. */
export function* pointResizePixelSteps(image: { width: number; height: number }, width: number, height: number, sample = false, pixelBytes = 4): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    // SampleImage uses 0.5 - MagickEpsilon to select the preceding pixel at ties.
    const offset = sample ? 0.5 - 1e-12 : 0.5;
    let start = -1;
    let pixels: Uint8Array = new Uint8Array(0);
    for (let y = 0; y < height; y++) {
        const sy = Math.min(image.height - 1, Math.floor((y + offset) * image.height / height));
        for (let left = 0; left < width; left += 1024) {
            yield;
            const count = Math.min(1024, width - left), data = new Uint8Array(count * pixelBytes);
            for (let x = 0; x < count; x++) {
                const sx = Math.min(image.width - 1, Math.floor((left + x + offset) * image.width / width));
                const position = (sy * image.width + sx) * pixelBytes;
                if (position < start || position >= start + pixels.length) {
                    start = position;
                    const length = Math.min(1024, image.width - sx) * pixelBytes;
                    const bytes = yield { kind: "read", position, length };
                    if (!bytes || bytes.length !== length) throw new Error("Truncated resize pixels");
                    pixels = bytes;
                }
                data.set(pixels.subarray(position - start, position - start + pixelBytes), x * pixelBytes);
            }
            yield { kind: "write", position: (y * width + left) * pixelBytes, data };
        }
    }
}
