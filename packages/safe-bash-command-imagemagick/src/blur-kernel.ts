import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
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
export function* blurPixelSteps(image: Pick<RgbaImage, "space" | "hueSamples"> & Partial<Pick<StoredRgbaImage, "storedHueSamples">> & { width: number; height: number; virtualPixel?: VirtualPixelMethod | undefined; region?: Region | undefined; evaluateSamples?: Float64Array | undefined; storedEvaluateSamples?: number | undefined }, geometry: { width?: number; height?: number }, gaussian: boolean, channels?: { r: boolean; g: boolean; b: boolean; a: boolean; k?: boolean }, unsharp?: { amount: number; threshold: number }, writeMask?: { width: number; height: number }, background?: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, radius = geometry.width ?? 0, sigma = Math.abs(geometry.height ?? 1);
    const virtualPixel = image.virtualPixel ?? "edge";
    // Filter active working samples; CMYK needs black in addition to color and alpha.
    const cmyk = image.space === "cmyk", stride = cmyk ? 5 : 4;
    const hue = !cmyk && (!!image.hueSamples || image.storedHueSamples !== undefined);
    const sourceEvaluate = !!image.evaluateSamples || image.storedEvaluateSamples !== undefined;
    const evaluate = hue || cmyk || sourceEvaluate;
    function* readSamples(position: number, length: number): Generator<ConvolveRequest, Uint8Array | Float64Array, Uint8Array | undefined> {
        const bytes = yield { kind: "read", hue, evaluate: !hue && sourceEvaluate, highDepth: cmyk, position, length };
        if (!bytes || bytes.length !== length * (hue || sourceEvaluate ? 8 : cmyk ? 2 : 1)) throw new Error("Truncated blur pixels");
        const samples = hue || sourceEvaluate ? new Float64Array(bytes.slice().buffer)
            : cmyk ? Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257) : bytes;
        if (hue) return (samples as Float64Array).map(value => value * 255);
        if (!cmyk) return samples;
        const inkBytes = yield { kind: "read", hue: true, position, length };
        if (!inkBytes || inkBytes.length !== length * 8) throw new Error("Truncated blur inks");
        const inks = new Float64Array(inkBytes.slice().buffer), working = new Float64Array(length / 4 * stride);
        for (let i = 0; i < length / 4; i++) working.set([inks[i * 4]! * 255, inks[i * 4 + 1]! * 255, inks[i * 4 + 2]! * 255, samples[i * 4 + 3]!, inks[i * 4 + 3]! * 255], i * stride);
        return working;
    }
    const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 127.5 : 0;
    const fill = (virtualPixel === "background" || virtualPixel.endsWith("-tile")) && background
        ? [background.r, background.g, background.b, background.a] : [gray, gray, gray, virtualPixel === "transparent" ? 0 : 255];
    if (cmyk) fill.push(gray);
    const blocks = new Map<number, Uint8Array | Float64Array>();
    function* sample(index: number): Generator<ConvolveRequest, ArrayLike<number>, Uint8Array | undefined> {
        if (index < 0) return fill;
        const start = Math.floor(index / 1024) * 1024;
        let data = blocks.get(start);
        if (!data) {
            const length = Math.min(1024, width * height - start) * 4;
            data = yield* readSamples(start * 4, length);
            if (blocks.size >= 16) blocks.delete(blocks.keys().next().value!);
            blocks.set(start, data);
        }
        return data.subarray((index - start) * stride, (index - start + 1) * stride);
    }
    const region = !gaussian ? image.region : undefined;
    const mask = channels ? [channels.r, channels.g, channels.b, channels.a, ...(cmyk ? [channels.k] : [])] : undefined;
    // Gray has one logical color channel, stored in all three RGB components.
    if (unsharp && mask && (image.space === "b-w" || image.space === "grey16")) mask[1] = mask[2] = mask[0];
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
            const sums = new Float64Array(count * stride);
            for (let ky = -half; ky <= half; ky++) {
                yield;
                const sy = virtualPixelIndex(0, y + ky, 1, height, virtualPixel);
                if (sy < 0) {
                    for (let x = 0; x < count; x++) {
                        for (let c = 0; c < stride; c++) if (c !== 3) sums[x * stride + c]! += fill[c]! * fill[3]! / 255 * weights[ky + half]!;
                        sums[x * stride + 3]! += fill[3]! / 255 * weights[ky + half]!;
                    }
                    continue;
                }
                let row = rows.get(sy);
                if (!row) {
                    const first = Math.max(0, left - half), last = Math.min(width - 1, left + count - 1 + half), length = (last - first + 1) * 4;
                    const samples = yield* readSamples((sy * width + first) * 4, length);
                    const maskX = writeMask ? Math.min(left, writeMask.width - 1) : 0;
                    const maskCount = writeMask ? Math.min(count, writeMask.width - maskX) : 0;
                    const protection = writeMask ? yield { kind: "read", image: 1, position: (Math.min(sy, writeMask.height - 1) * writeMask.width + maskX) * 4, length: maskCount * 4 } : undefined;
                    if (writeMask && (!protection || protection.length !== maskCount * 4)) throw new Error("Truncated blur mask pixels");
                    row = new Float64Array(count * stride);
                    for (let x = 0; x < count; x++) {
                        if (x % 32 === 0) yield;
                        for (let k = -half; k <= half; k++) {
                            const index = virtualPixelIndex(left + x + k, sy, width, height, virtualPixel);
                            const offset = (index - sy * width - first) * stride;
                            const pixel = index >= 0 && offset >= 0 && offset + stride <= samples.length
                                ? samples.subarray(offset, offset + stride) : yield* sample(index);
                            const alpha = pixel[3]! / 255, weight = weights[k + half]!;
                            for (let c = 0; c < stride; c++) if (c !== 3) row[x * stride + c]! += pixel[c]! * alpha * weight;
                            row[x * stride + 3]! += alpha * weight;
                        }
                        const maskOffset = Math.min(x, maskCount - 1) * 4;
                        const protectedAmount = region && !regionContains(region, left + x, sy) ? 1 : protection
                            ? (0.212656 * protection[maskOffset]! + 0.715158 * protection[maskOffset + 1]! + 0.072186 * protection[maskOffset + 2]!) / 255 : 0;
                        if (protectedAmount > 0) {
                            const offset = (left + x - first) * stride, alpha = samples[offset + 3]! / 255;
                            // Native clips each separable pass before the next one reads it.
                            for (let c = 0; c < stride; c++) if (c !== 3) row[x * stride + c] = (samples[offset + c]! * alpha * protectedAmount + row[x * stride + c]! * (1 - alpha * protectedAmount)) * alpha;
                            row[x * stride + 3] = alpha;
                        }
                    }
                    // Q16-HDRI stores float quantum samples between separable passes.
                    if (evaluate && !gaussian) for (let i = 0; i < row.length; i++) row[i] = Math.fround(row[i]! * (i % stride === 3 ? 65535 : 257)) / (i % stride === 3 ? 65535 : 257);
                    if (rows.size >= 32) rows.delete(rows.keys().next().value!);
                    rows.set(sy, row);
                }
                for (let i = 0; i < sums.length; i++) sums[i]! += row[i]! * weights[ky + half]!;
            }
            const data = evaluate ? new Float64Array(count * stride) : new Uint8Array(count * 4);
            const original = region || unsharp || mask?.some(active => !active)
                ? yield* readSamples((y * width + left) * 4, count * 4) : undefined;
            for (let x = 0; x < count; x++) {
                const alpha = sums[x * stride + 3]!;
                for (let c = 0; c < stride; c++) {
                    const index = x * stride + c;
                    let value = c === 3 ? alpha * 255 : alpha > 0 ? sums[index]! / alpha : 0;
                    if (region && !regionContains(region, left + x, y)) {
                        const sourceAlpha = original![x * stride + 3]! / 255;
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
                for (let i = 0; i < data.length; i++) if (!mask[i % stride]) data[i] = original![i]!;
            }
            const rgba = cmyk ? new Float64Array(count * 4) : data;
            if (cmyk) {
                const inks = new Float64Array(count * 4);
                for (let i = 0; i < count; i++) {
                    inks.set([data[i * stride]! / 255, data[i * stride + 1]! / 255, data[i * stride + 2]! / 255, data[i * stride + 4]! / 255], i * 4);
                    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = (1 - inks[i * 4 + c]!) * (1 - inks[i * 4 + 3]!) * 255;
                    rgba[i * 4 + 3] = data[i * stride + 3]!;
                }
                yield { kind: "write", hue: true, position: (y * width + left) * 4, data: new Uint8Array(inks.buffer) };
            }
            yield { kind: "write", evaluate, position: (y * width + left) * 4, data: new Uint8Array(rgba.buffer) };
            if (evaluate) {
                const bounded = Uint16Array.from(rgba, value => Math.round(Math.max(0, Math.min(65535, value * 257))));
                yield { kind: "write", highDepth: true, position: (y * width + left) * 4, data: new Uint8Array(bounded.buffer) };
            }
            if (hue) yield { kind: "write", hue: true, position: (y * width + left) * 4, data: new Uint8Array((data as Float64Array).map(value => value / 255).buffer) };
        }
    }
}
