import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { magickIntensity } from "./intensity.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";

/** Gaussian averaging includes only neighbors strictly inside the contrast threshold. */
export function* selectiveBlurPixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "evaluateSamples"> & Partial<Pick<StoredRgbaImage, "storedEvaluateSamples">> & { magickColorspace?: string | undefined }, geometry: { width?: number; height?: number; x: number; isPercent: boolean }, background: RgbaColor, method: VirtualPixelMethod = "edge", channels?: { r: boolean; g: boolean; b: boolean; a: boolean }, intensity = "rec709luma"): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const radius = geometry.width ?? 0, sigma = Math.max(1e-12, Math.abs(geometry.height ?? 1));
    const threshold = geometry.x * (geometry.isPercent ? 65535 / 100 : 1);
    if ((geometry.width === undefined && geometry.height === undefined) || ![radius, sigma, threshold].every(Number.isFinite)) throw new Error("Invalid selective-blur geometry");
    let half = radius > 1e-12 ? Math.ceil(radius) : 1;
    if (radius <= 1e-12 && sigma > 1e-12) {
        let total = 1 + 2 * Math.exp(-1 / (2 * sigma * sigma));
        for (half = 2; half <= 500; half++) {
            yield;
            const edge = Math.exp(-half * half / (2 * sigma * sigma));
            total += 2 * edge;
            if (edge / total < 1 / 65535) { half--; break; }
        }
    }
    if (half > 500) throw new Error("Selective blur radius exceeds 500");
    const size = half * 2 + 1, weights = new Float64Array(size * size);
    for (let y = -half; y <= half; y++) {
        yield;
        for (let x = -half; x <= half; x++) weights[(y + half) * size + x + half] = Math.exp(-(x * x + y * y) / (2 * sigma * sigma)) / (2 * Math.PI * sigma * sigma);
    }
    const { width, height } = image, evaluate = !!image.evaluateSamples || image.storedEvaluateSamples !== undefined;
    const blocks = new Map<number, Float64Array>();
    const gray = method === "white" ? 255 : method === "gray" ? 127.5 : 0;
    const fill = (method === "background" || method.endsWith("-tile") ? [background.r, background.g, background.b, background.a] : [gray, gray, gray, method === "transparent" ? 0 : 255]).map(value => value * 257);
    function* sample(x: number, y: number): Generator<ConvolveRequest, ArrayLike<number>, Uint8Array | undefined> {
        const index = virtualPixelIndex(x, y, width, height, method);
        if (index < 0) return fill;
        const start = Math.floor(index / 1024) * 1024;
        let data = blocks.get(start);
        if (!data) {
            const length = Math.min(1024, width * height - start) * 4;
            const bytes = yield { kind: "read", evaluate, highDepth: true, position: start * 4, length };
            if (!bytes || bytes.length !== length * (evaluate ? 8 : 2)) throw new Error("Truncated selective blur pixels");
            data = evaluate ? new Float64Array(bytes.slice().buffer).map(value => value * 257) : Float64Array.from(new Uint16Array(bytes.slice().buffer));
            if (blocks.size >= 16) blocks.delete(blocks.keys().next().value!);
            blocks.set(start, data);
        }
        return data.subarray((index - start) * 4, (index - start) * 4 + 4);
    }
    const selected = channels ? [channels.r, channels.g, channels.b, channels.a] : [true, true, true, true];
    const luma = (pixel: ArrayLike<number>, mode: string): number => magickIntensity(pixel[0]!, pixel[1]!, pixel[2]!, mode, 65535, image.magickColorspace === "RGB" || image.magickColorspace === "scRGB");
    let work = 0;
    for (let start = 0; start < width * height; start += 1024) {
        const count = Math.min(1024, width * height - start), output = new Float64Array(count * 4);
        for (let i = 0; i < count; i++) {
            yield;
            const x = (start + i) % width, y = Math.floor((start + i) / width), center = yield* sample(x, y), centerLuma = luma(center, intensity);
            const sums = [0, 0, 0, 0], totals = [0, 0, 0, 0];
            for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) {
                if (work++ % 1024 === 0) yield;
                const pixel = yield* sample(x + dx, y + dy), weight = weights[(dy + half) * size + dx + half]!;
                const contrast = luma(pixel, intensity) - centerLuma;
                // Native non-blending channels compare against a float GRAY conversion.
                const grayContrast = Math.fround(luma(pixel, "rec709luma")) - centerLuma;
                for (let c = 0; c < 4; c++) {
                    const blend = image.hasAlpha && c < 3;
                    if (!selected[c] || Math.abs(blend ? contrast : grayContrast) >= threshold) continue;
                    const amount = weight * (blend ? pixel[3]! / 65535 : 1);
                    sums[c]! += amount * pixel[c]!;
                    totals[c]! += amount;
                }
            }
            for (let c = 0; c < 4; c++) output[i * 4 + c] = Math.fround(Math.abs(totals[c]!) < 1e-12 ? center[c]! : sums[c]! / totals[c]!) / 257;
        }
        yield { kind: "write", evaluate: true, position: start * 4, data: new Uint8Array(output.buffer) };
        const bounded = Uint16Array.from(output, value => Math.round(Math.max(0, Math.min(65535, value * 257))));
        yield { kind: "write", highDepth: true, position: start * 4, data: new Uint8Array(bounded.buffer) };
        yield { kind: "write", position: start * 4, data: Uint8Array.from(output, value => Math.round(Math.max(0, Math.min(255, value)))) };
    }
}
