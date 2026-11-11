import { regionContains, type Region } from "./region.js";
import type { LookupInterpolation } from "./sequence-kernel.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { RgbaColor } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { catromSamples, splineSamples, type VirtualPixelMethod } from "./warp-kernel.js";

/** Native Kuwahara: rank-three blur, minimum luma variance, quadrant-center interpolation. */
export function* kuwaharaPixelSteps(image: { width: number; height: number; alphaBlend?: boolean | undefined; region?: Region | undefined }, geometry: { width?: number; height?: number }, background: RgbaColor, method: VirtualPixelMethod = "edge", channels?: { r: boolean; g: boolean; b: boolean; a: boolean }, interpolation: LookupInterpolation = "bilinear", writeMask?: { width: number; height: number }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, radius = geometry.width ?? 0, sigma = Math.abs(geometry.height ?? 1);
    if (!Number.isFinite(radius) || radius < 0 || radius >= 5000 || !Number.isFinite(sigma)) throw new Error("Kuwahara radius or sigma exceeds limit");
    const quadrant = Math.floor(radius) + 1, mask = channels ? [channels.r, channels.g, channels.b, channels.a] : undefined;
    let half = radius > 0 ? Math.max(1, Math.floor(radius)) : 0;
    if (sigma === 0) half = 0;
    else if (radius === 0) {
        let sum = 1 + 2 * Math.exp(-1 / (2 * sigma * sigma));
        for (half = 2; half < 5000; half++) {
            yield;
            const edge = Math.exp(-half * half / (2 * sigma * sigma));
            sum += 2 * edge;
            if (edge / sum < 1 / 65535) { half--; break; }
        }
    }
    if (half >= 5000) throw new Error("Kuwahara blur radius exceeds limit");
    const weights = new Float64Array(half * 2 + 1);
    let total = 0;
    for (let k = -half; k <= half; k++) {
        let weight = sigma === 0 ? 1 : 0;
        if (sigma > 0) for (let sub = -1; sub <= 1; sub++) weight += Math.exp(-((k * 3 + sub) ** 2) * (1 / (18 * sigma * sigma))) / (Math.sqrt(2 * Math.PI) * sigma * 3);
        weights[k + half] = weight; total += weight;
    }
    for (let k = 0; k < weights.length; k++) weights[k]! /= total;
    const gray = method === "white" ? 255 : method === "gray" ? 128 : 0;
    const fill = (method === "background" || method?.endsWith("-tile")) ? [background.r, background.g, background.b, background.a] : [gray, gray, gray, method === "transparent" ? 0 : 255];
    const maskBlocks = new Map<number, Uint16Array>();
    const blocks = new Map<number, Uint8Array>(), horizontal = new Map<number, number[]>(), blurred = new Map<number, number[]>();
    function* sample(x: number, y: number, stage: number): Generator<ConvolveRequest | undefined, number[], Uint8Array | undefined> {
        if (x < 0 || y < 0 || x >= width || y >= height) {
            const index = virtualPixelIndex(x, y, width, height, method);
            if (index >= 0) {
                x = index % width; y = Math.floor(index / width);
            } else return fill.map(value => value * 257);
        }
        const position = y * width + x;
        if (stage === 0) {
            const start = Math.floor(position / 1024) * 1024;
            let bytes = blocks.get(start);
            if (!bytes) {
                const length = Math.min(1024, width * height - start) * 4;
                bytes = yield { kind: "read", position: start * 4, length };
                if (!bytes || bytes.length !== length) throw new Error("Truncated Kuwahara pixels");
                if (blocks.size >= 64) blocks.delete(blocks.keys().next().value!);
                blocks.set(start, bytes);
            }
            return Array.from(bytes.subarray((position - start) * 4, (position - start + 1) * 4), value => value * 257);
        }
        const cache = stage === 1 ? horizontal : blurred;
        const cached = cache.get(position);
        if (cached) return cached;
        const sums = [0, 0, 0, 0];
        for (let k = -half; k <= half; k++) {
            yield;
            const pixel = yield* sample(x + (stage === 1 ? k : 0), y + (stage === 2 ? k : 0), stage - 1);
            const weight = weights[k + half]!, alpha = image.alphaBlend === false ? 1 : pixel[3]! / 65535;
            for (let c = 0; c < 3; c++) sums[c]! += pixel[c]! * alpha * weight;
            sums[3]! += alpha * weight;
        }
        const original = mask ? yield* sample(x, y, 0) : undefined;
        // Q16-HDRI stores each blur pass as float samples before comparing variance.
        const pixel = sums.map((sum, c) => mask && !mask[c] ? original![c]! : Math.fround(c === 3 ? sum * 65535 : sums[3]! > 0 ? sum / sums[3]! : 0));
        // The native cache applies protection after each blur pass, so the
        // next pass and quadrant variance see the protected pixels.
        let protection = image.region && !regionContains(image.region, x, y) ? 1 : 0;
        if (writeMask) {
            const maskPosition = Math.min(y, writeMask.height - 1) * writeMask.width + Math.min(x, writeMask.width - 1);
            const start = Math.floor(maskPosition / 1024) * 1024;
            let samples = maskBlocks.get(start);
            if (!samples) {
                const length = Math.min(1024, writeMask.width * writeMask.height - start) * 4;
                const bytes = yield { kind: "read", image: 1, highDepth: true, position: start * 4, length };
                if (!bytes || bytes.length !== length * 2) throw new Error("Truncated Kuwahara mask");
                samples = new Uint16Array(bytes.slice().buffer);
                if (maskBlocks.size >= 64) maskBlocks.delete(maskBlocks.keys().next().value!);
                maskBlocks.set(start, samples);
            }
            const offset = (maskPosition - start) * 4;
            protection = Math.max(protection, (0.212656 * samples[offset]! + 0.715158 * samples[offset + 1]! + 0.072186 * samples[offset + 2]!) / 65535);
        }
        if (protection > 0) {
            const source = yield* sample(x, y, stage - 1);
            const sourceAlpha = protection * (image.alphaBlend === false ? 1 : source[3]! / 65535), editedAlpha = image.alphaBlend === false ? 1 : pixel[3]! / 65535;
            for (let c = 0; c < 3; c++) if (!mask || mask[c]) pixel[c] = Math.fround(source[c]! * sourceAlpha + pixel[c]! * editedAlpha * (1 - sourceAlpha));
            pixel[3] = source[3]!;
        }
        if (cache.size >= 4096) cache.delete(cache.keys().next().value!);
        cache.set(position, pixel);
        return pixel;
    }
    for (let start = 0; start < width * height; start += 1024) {
        const count = Math.min(1024, width * height - start), data = new Uint8Array(count * 4);
        for (let i = 0; i < count; i++) {
            yield;
            const x = (start + i) % width, y = Math.floor((start + i) / width);
            let minimum = Infinity, targetX = x, targetY = y;
            for (let q = 0; q < 4; q++) {
                const left = x - (q % 2 === 0 ? quadrant - 1 : 0), top = y - (q < 2 ? quadrant - 1 : 0);
                const mean = [0, 0, 0];
                for (let dy = 0; dy < quadrant; dy++) for (let dx = 0; dx < quadrant; dx++) {
                    yield;
                    const pixel = yield* sample(left + dx, top + dy, 2);
                    for (let c = 0; c < 3; c++) mean[c]! += pixel[c]!;
                }
                for (let c = 0; c < 3; c++) mean[c]! /= quadrant * quadrant;
                const meanLuma = mean[0]! * 0.212656 + mean[1]! * 0.715158 + mean[2]! * 0.072186;
                let variance = 0;
                for (let dy = 0; dy < quadrant; dy++) for (let dx = 0; dx < quadrant; dx++) {
                    yield;
                    const pixel = yield* sample(left + dx, top + dy, 2);
                    const luma = pixel[0]! * 0.212656 + pixel[1]! * 0.715158 + pixel[2]! * 0.072186;
                    variance += (luma - meanLuma) ** 2;
                }
                if (variance < minimum) { minimum = variance; targetX = left; targetY = top; }
            }
            const cx = targetX + quadrant / 2, cy = targetY + quadrant / 2;
            const nearest = interpolation === "nearest", single = nearest || interpolation === "integer";
            const averageSize = interpolation === "average" ? 2 : interpolation === "average9" ? 3 : interpolation === "average16" ? 4 : 0;
            const shift = averageSize > 2 ? 1 : 0, round = nearest || averageSize === 3 ? 0.5 : 0;
            const left = Math.floor(cx + round) - shift, top = Math.floor(cy + round) - shift;
            const fx = cx - left, fy = cy - top, sums = Array<number>(4).fill(0);
            let meshPixels: number[][] | undefined, meshWeights: number[] | undefined;
            if (interpolation === "mesh") {
                meshPixels = [yield* sample(left, top, 2), yield* sample(left + 1, top, 2), yield* sample(left, top + 1, 2), yield* sample(left + 1, top + 1, 2)];
                const luma = meshPixels.map(pixel => 0.212656 * pixel[0]! + 0.715158 * pixel[1]! + 0.072186 * pixel[2]!);
                // Native mesh chooses the diagonal with the smaller luma difference.
                meshWeights = Math.abs(luma[0]! - luma[3]!) < Math.abs(luma[1]! - luma[2]!)
                    ? fx <= fy ? [1 - fy, 0, fy - fx, fx] : [1 - fx, fx - fy, 0, fy]
                    : fx <= 1 - fy ? [1 - fx - fy, fx, fy, 0] : [0, 1 - fy, 1 - fx, fx + fy - 1];
            }
            const interpolationSamples: Iterable<readonly [number, number, number]> = interpolation === "catrom" ? catromSamples(cx, cy)
                : interpolation === "spline" ? splineSamples(cx, cy)
                : Array.from({ length: (single ? 1 : averageSize || 2) ** 2 }, (_, index) => {
                    const size = single ? 1 : averageSize || 2, dx = index % size, dy = Math.floor(index / size);
                    return [left + dx, top + dy, meshWeights?.[index] ?? (single ? 1 : averageSize ? 1 / (size * size) : (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy))] as const;
                });
            for (const [sx, sy, weight] of interpolationSamples) {
                if (weight === 0) continue;
                const pixel = meshPixels?.[(sy - top) * 2 + sx - left] ?? (yield* sample(sx, sy, 2)), alpha = image.alphaBlend === false ? 1 : pixel[3]! / 65535;
                // Mesh divides unassociated colors by alpha; cubic keeps premultiplied colors.
                // Kuwahara centers are integers or halves, where blend and bilinear weights agree.
                const colorWeight = single || interpolation === "mesh" ? 1 : averageSize ? Number(alpha > 0) : alpha;
                for (let c = 0; c < 4; c++) if (c !== 3) sums[c]! += pixel[c]! * (mask && !mask[c] && interpolation !== "blend" ? 1 : colorWeight) * weight;
                sums[3]! += alpha * weight;
            }
            if (interpolation === "bilinear" || interpolation === "background" || interpolation === "blend" || interpolation === "mesh")
                for (let c = 0; c < 4; c++) if (c !== 3 && (!mask || mask[c] || interpolation === "blend")) sums[c] = sums[3]! > 0 ? sums[c]! / sums[3]! : 0;
            for (let c = 0; c < 4; c++) data[i * 4 + c] = Math.max(0, Math.min(255, Math.round(c === 3 ? sums[3]! * 255 : sums[c]! / 257)));
        }
        yield { kind: "write", position: start * 4, data };
    }
}
