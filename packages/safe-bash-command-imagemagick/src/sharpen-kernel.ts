import type { RgbaColor } from "@poe-code/image-ast/portable";
import type { VirtualPixelMethod } from "./warp-kernel.js";
import type { Region } from "./region.js";
import { convolvePixelSteps, type ConvolveRequest } from "./convolve-kernel.js";

/** ImageMagick's normalized negative Gaussian with a doubled center. */
export function* sharpenPixelSteps(image: { width: number; height: number; hasAlpha: boolean; region?: Region | undefined }, geometry: { width?: number; height?: number }, channels?: { r: boolean; g: boolean; b: boolean; a: boolean }, virtualPixel?: VirtualPixelMethod, background?: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const radius = geometry.width ?? 0, sigma = Math.max(1e-12, Math.abs(geometry.height ?? 1));
    let half = Math.max(1, Math.ceil(radius));
    if (radius <= 0) {
        let sum = 1 + 2 * Math.exp(-1 / (2 * sigma * sigma));
        for (half = 2; half < 5000; half++) {
            yield;
            const edge = Math.exp(-half * half / (2 * sigma * sigma));
            sum += 2 * edge;
            if (edge / (sum * sum) < 1 / 65535) { half--; break; }
        }
    }
    if (!Number.isFinite(half) || half >= 5000) throw new Error("Sharpen radius exceeds 5000");
    const kernel: number[] = [];
    let sum = 0;
    for (let y = -half; y <= half; y++) {
        yield;
        for (let x = -half; x <= half; x++) {
            const weight = -Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
            kernel.push(weight);
            sum += weight;
        }
    }
    kernel[Math.floor(kernel.length / 2)] = -2 * sum;
    const scale = 1 - sum;
    for (let i = 0; i < kernel.length; i++) kernel[i]! /= scale;
    yield* convolvePixelSteps(image, { weights: kernel, width: 2 * half + 1, height: 2 * half + 1, x: half, y: half }, 0, image.region, channels, virtualPixel, background);
}
