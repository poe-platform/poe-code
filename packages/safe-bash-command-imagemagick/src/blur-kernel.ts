import type { RgbaColor } from "@poe-code/image-ast/portable";
import { regionContains, type Region } from "./region.js";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";

export function parseUnsharpGeometry(raw: string): { width: number; height: number; amount: number; threshold: number } {
    raw = [...raw].filter(character => !"()!%<>^@#".includes(character)).join("");
    const parts: string[] = [];
    let start = 0;
    let hasSigma = false;
    for (let i = 0; i < raw.length; i++) {
        const separator = raw[i] === "x" || raw[i] === "X" || raw[i] === "," || raw[i] === "/";
        if (separator ||
            i > start && (raw[i] === "+" || raw[i] === "-") && raw[i - 1] !== "e" && raw[i - 1] !== "E") {
            parts.push(raw.slice(start, i));
            start = separator ? i + 1 : i;
            hasSigma ||= separator;
        }
    }
    parts.push(raw.slice(start));
    if (!hasSigma) parts.splice(1, 0, "1");
    const [width = 0, height = 1, amount = 1, threshold = 0.05] = parts.map(part => Number(part));
    if (![width, height, amount, threshold].every(Number.isFinite)) throw new Error("Invalid unsharp geometry");
    return { width, height, amount, threshold };
}

/** Native sampled Gaussian or rank-three blur, with bounded row caching. */
export function* blurPixelSteps(image: { width: number; height: number; virtualPixel?: VirtualPixelMethod | undefined; region?: Region | undefined; evaluateSamples?: Float64Array | undefined; storedEvaluateSamples?: number | undefined }, geometry: { width?: number; height?: number }, gaussian: boolean, channels?: { r: boolean; g: boolean; b: boolean; a: boolean }, unsharp?: { amount: number; threshold: number }, writeMask?: { width: number; height: number }, background?: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, radius = geometry.width ?? 0, sigma = Math.abs(geometry.height ?? 1);
    const virtualPixel = unsharp ? image.virtualPixel ?? "edge" : "edge";
    const evaluate = !!image.evaluateSamples || image.storedEvaluateSamples !== undefined;
    const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 127.5 : 0;
    const fill = (virtualPixel === "background" || virtualPixel.endsWith("-tile")) && background
        ? [background.r, background.g, background.b, background.a] : [gray, gray, gray, virtualPixel === "transparent" ? 0 : 255];
    const blocks = new Map<number, Uint8Array | Float64Array>();
    function* sample(index: number): Generator<ConvolveRequest, ArrayLike<number>, Uint8Array | undefined> {
        if (index < 0) return fill;
        const start = Math.floor(index / 1024) * 1024;
        let data = blocks.get(start);
        if (!data) {
            const length = Math.min(1024, width * height - start) * 4;
            const bytes = yield { kind: "read", evaluate, position: start * 4, length };
            if (!bytes || bytes.length !== length * (evaluate ? 8 : 1)) throw new Error("Truncated blur pixels");
            data = evaluate ? new Float64Array(bytes.slice().buffer) : bytes;
            if (blocks.size >= 16) blocks.delete(blocks.keys().next().value!);
            blocks.set(start, data);
        }
        return data.subarray((index - start) * 4, (index - start) * 4 + 4);
    }
    const region = !gaussian ? image.region : undefined;
    const mask = channels ? [channels.r, channels.g, channels.b, channels.a] : undefined;
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
                const sy = virtualPixelIndex(0, y + ky, 1, height, virtualPixel);
                if (sy < 0) {
                    for (let x = 0; x < count; x++) {
                        for (let c = 0; c < 3; c++) sums[x * 4 + c]! += fill[c]! * fill[3]! / 255 * weights[ky + half]!;
                        sums[x * 4 + 3]! += fill[3]! / 255 * weights[ky + half]!;
                    }
                    continue;
                }
                let row = rows.get(sy);
                if (!row) {
                    const first = Math.max(0, left - half), last = Math.min(width - 1, left + count - 1 + half), length = (last - first + 1) * 4;
                    const bytes = yield { kind: "read", evaluate, position: (sy * width + first) * 4, length };
                    if (!bytes || bytes.length !== length * (evaluate ? 8 : 1)) throw new Error("Truncated blur pixels");
                    const samples = evaluate ? new Float64Array(bytes.slice().buffer) : bytes;
                    const maskX = writeMask ? Math.min(left, writeMask.width - 1) : 0;
                    const maskCount = writeMask ? Math.min(count, writeMask.width - maskX) : 0;
                    const protection = writeMask ? yield { kind: "read", image: 1, position: (Math.min(sy, writeMask.height - 1) * writeMask.width + maskX) * 4, length: maskCount * 4 } : undefined;
                    if (writeMask && (!protection || protection.length !== maskCount * 4)) throw new Error("Truncated blur mask pixels");
                    row = new Float64Array(count * 4);
                    for (let x = 0; x < count; x++) {
                        if (x % 32 === 0) yield;
                        for (let k = -half; k <= half; k++) {
                            const index = virtualPixelIndex(left + x + k, sy, width, height, virtualPixel);
                            const offset = (index - sy * width - first) * 4;
                            const pixel = index >= 0 && offset >= 0 && offset + 4 <= samples.length
                                ? samples.subarray(offset, offset + 4) : yield* sample(index);
                            const alpha = pixel[3]! / 255, weight = weights[k + half]!;
                            for (let c = 0; c < 3; c++) row[x * 4 + c]! += pixel[c]! * alpha * weight;
                            row[x * 4 + 3]! += alpha * weight;
                        }
                        const maskOffset = Math.min(x, maskCount - 1) * 4;
                        const protectedAmount = region && !regionContains(region, left + x, sy) ? 1 : protection
                            ? (0.212656 * protection[maskOffset]! + 0.715158 * protection[maskOffset + 1]! + 0.072186 * protection[maskOffset + 2]!) / 255 : 0;
                        if (protectedAmount > 0) {
                            const offset = (left + x - first) * 4, alpha = samples[offset + 3]! / 255;
                            // Native clips each separable pass before the next one reads it.
                            for (let c = 0; c < 3; c++) row[x * 4 + c] = (samples[offset + c]! * alpha * protectedAmount + row[x * 4 + c]! * (1 - alpha * protectedAmount)) * alpha;
                            row[x * 4 + 3] = alpha;
                        }
                    }
                    // Q16-HDRI stores float quantum samples between separable passes.
                    if (evaluate && !gaussian) for (let i = 0; i < row.length; i++) row[i] = Math.fround(row[i]! * (i % 4 === 3 ? 65535 : 257)) / (i % 4 === 3 ? 65535 : 257);
                    if (rows.size >= 32) rows.delete(rows.keys().next().value!);
                    rows.set(sy, row);
                }
                for (let i = 0; i < sums.length; i++) sums[i]! += row[i]! * weights[ky + half]!;
            }
            const data = evaluate ? new Float64Array(count * 4) : new Uint8Array(count * 4);
            const originalBytes = region || unsharp || mask?.some(active => !active)
                ? yield { kind: "read" as const, evaluate, position: (y * width + left) * 4, length: data.length }
                : undefined;
            if ((region || unsharp || mask?.some(active => !active)) && (!originalBytes || originalBytes.length !== data.length * (evaluate ? 8 : 1))) throw new Error("Truncated blur pixels");
            const original = originalBytes && (evaluate ? new Float64Array(originalBytes.slice().buffer) : originalBytes);
            for (let x = 0; x < count; x++) {
                const alpha = sums[x * 4 + 3]!;
                for (let c = 0; c < 4; c++) {
                    const index = x * 4 + c;
                    let value = c === 3 ? alpha * 255 : alpha > 0 ? sums[index]! / alpha : 0;
                    if (region && !regionContains(region, left + x, y)) {
                        const sourceAlpha = original![x * 4 + 3]! / 255;
                        value = c === 3 ? original![index]! : original![index]! * sourceAlpha + sums[index]! * (1 - sourceAlpha);
                    }
                    if (evaluate) value = Math.fround(value * 257) / 257;
                    if (unsharp) {
                        const source = original![index]!, difference = source - value;
                        value = Math.abs(2 * difference) < 255 * unsharp.threshold ? source : source + unsharp.amount * difference;
                    }
                    data[index] = evaluate ? Math.fround(value * 257) / 257 : Math.max(0, Math.min(255, Math.round(value)));
                }
            }
            if (mask && mask.some(active => !active)) {
                for (let i = 0; i < data.length; i++) if (!mask[i % 4]) data[i] = original![i]!;
            }
            yield { kind: "write", evaluate, position: (y * width + left) * 4, data: new Uint8Array(data.buffer) };
            if (evaluate) {
                const bounded = Uint16Array.from(data, value => Math.round(Math.max(0, Math.min(65535, value * 257))));
                yield { kind: "write", highDepth: true, position: (y * width + left) * 4, data: new Uint8Array(bounded.buffer) };
            }
        }
    }
}
