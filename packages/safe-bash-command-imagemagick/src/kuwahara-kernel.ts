import type { LookupInterpolation } from "./sequence-kernel.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { RgbaColor } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";

/** Native Kuwahara: rank-three blur, minimum luma variance, quadrant-center interpolation. */
export function* kuwaharaPixelSteps(image: { width: number; height: number }, geometry: { width?: number; height?: number }, background: RgbaColor, method: VirtualPixelMethod = "edge", channels?: { r: boolean; g: boolean; b: boolean; a: boolean }, interpolation: LookupInterpolation = "bilinear"): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    if (interpolation === "average9" || interpolation === "average16" || interpolation === "blend" || interpolation === "mesh" || interpolation === "catrom" || interpolation === "spline") throw new Error(`Unsupported Kuwahara interpolation: ${interpolation}`);
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
            const weight = weights[k + half]!, alpha = pixel[3]! / 65535;
            for (let c = 0; c < 3; c++) sums[c]! += pixel[c]! * alpha * weight;
            sums[3]! += alpha * weight;
        }
        const original = mask ? yield* sample(x, y, 0) : undefined;
        // Q16-HDRI stores each blur pass as float samples before comparing variance.
        const pixel = sums.map((sum, c) => mask && !mask[c] ? original![c]! : Math.fround(c === 3 ? sum * 65535 : sums[3]! > 0 ? sum / sums[3]! : 0));
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
            const left = Math.floor(cx + (nearest ? 0.5 : 0)), top = Math.floor(cy + (nearest ? 0.5 : 0));
            const fx = cx - left, fy = cy - top, sums = [0, 0, 0, 0];
            for (let dy = 0; dy < (single ? 1 : 2); dy++) for (let dx = 0; dx < (single ? 1 : 2); dx++) {
                const weight = single ? 1 : interpolation === "average" ? 0.25 : (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
                if (weight === 0) continue;
                const pixel = yield* sample(left + dx, top + dy, 2), alpha = pixel[3]! / 65535;
                const colorWeight = single ? 1 : interpolation === "average" ? Number(alpha > 0) : alpha;
                for (let c = 0; c < 3; c++) sums[c]! += pixel[c]! * (mask && !mask[c] ? 1 : colorWeight) * weight;
                sums[3]! += alpha * weight;
            }
            if (interpolation === "bilinear" || interpolation === "background") for (let c = 0; c < 3; c++) if (!mask || mask[c]) sums[c] = sums[3]! > 0 ? sums[c]! / sums[3]! : 0;
            for (let c = 0; c < 4; c++) data[i * 4 + c] = Math.max(0, Math.min(255, Math.round(c === 3 ? sums[3]! * 255 : sums[c]! / 257)));
        }
        yield { kind: "write", position: start * 4, data };
    }
}
