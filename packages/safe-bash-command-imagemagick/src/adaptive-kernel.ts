import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import { convolvePixelSteps, type ConvolveRequest } from "./convolve-kernel.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";

type Image = Pick<RgbaImage, "width" | "height" | "hasAlpha"> & Partial<Pick<RgbaImage, "space" | "hueSamples"> & Pick<StoredRgbaImage, "storedHueSamples">>;

/** Edge detection and auto-leveling, retaining HDRI values between operations. */
export function* adaptiveEdgePixelSteps(image: Image, radius: number, virtualPixel: VirtualPixelMethod = "edge", background?: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const half = radius > 0 ? Math.ceil(radius) : 2;
    if (!Number.isFinite(half) || half >= 5000) throw new Error("Adaptive filter radius exceeds 5000");
    const width = half * 2 + 1, weights = Array<number>(width * width).fill(-1);
    weights[Math.floor(weights.length / 2)] = weights.length - 1;
    let low = Infinity, high = -Infinity;
    // Recompute the convolution after finding its range, without retaining a whole image.
    for (let pass = 0; pass < 2; pass++) {
        const steps = convolvePixelSteps(image, { weights, width, height: width, x: half, y: half }, 0, undefined, undefined, virtualPixel, background);
        let next = steps.next();
        while (!next.done) {
            const request = next.value;
            if (request?.kind === "read") {
                let bytes = yield request;
                if (request.evaluate && !bytes?.length) {
                    const source = yield { ...request, evaluate: false, highDepth: true };
                    if (!source || source.length !== request.length * 2) throw new Error("Truncated adaptive filter pixels");
                    bytes = new Uint8Array(Float64Array.from(new Uint16Array(source.slice().buffer), value => value / 257).buffer);
                }
                next = steps.next(bytes);
            } else {
                if (request?.kind === "write" && request.evaluate) {
                    const samples = new Float64Array(request.data.slice().buffer);
                    for (let i = 0; i < samples.length; i++) {
                        if (i % 4 === 3 && !image.hasAlpha) continue;
                        if (pass === 0) { low = Math.min(low, samples[i]!); high = Math.max(high, samples[i]!); }
                        else if (high > low) samples[i] = Math.fround(65535 * (samples[i]! - low) / (high - low)) / 257;
                    }
                    if (pass === 1) {
                        yield { ...request, data: new Uint8Array(samples.buffer) };
                        if (image.space !== "cmyk" && (image.hueSamples || image.storedHueSamples !== undefined))
                            yield { kind: "write", hue: true, position: request.position, data: new Uint8Array(samples.map(value => value / 255).buffer) };
                        yield { kind: "write", highDepth: true, position: request.position, data: new Uint8Array(Uint16Array.from(samples, value => Math.max(0, Math.min(65535, Math.round(value * 257)))).buffer) };
                    }
                } else if (!request) yield;
                next = steps.next();
            }
        }
    }
}

/** Select a blur or sharpening radius from the leveled, blurred edge intensity at each pixel. */
export function* adaptivePixelSteps(image: Image & Partial<Pick<RgbaImage, "evaluateSamples">> & Partial<Pick<StoredRgbaImage, "storedEvaluateSamples">>, geometry: { width?: number; height?: number }, sharpen: boolean, virtualPixel: VirtualPixelMethod = "edge", background?: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, radius = geometry.width ?? 0, sigma = geometry.height ?? 1;
    let half = radius > 0 ? Math.ceil(radius) : 1;
    if (radius <= 0) {
        let sum = 1 + 2 * Math.exp(-1 / (2 * sigma * sigma));
        for (half = 2; half < 5000; half++) {
            yield;
            const edge = Math.exp(-half * half / (2 * sigma * sigma));
            sum += 2 * edge;
            if (edge / (sum * sum) < 1 / 65535) { half--; break; }
        }
    }
    if (!Number.isFinite(half) || half >= 5000) throw new Error("Adaptive filter radius exceeds 5000");
    const kernels: Float64Array[] = [];
    for (let h = 0; h <= half; h++) {
        yield;
        const kernel = new Float64Array((h * 2 + 1) ** 2);
        let sum = 0, i = 0;
        for (let y = -h; y <= h; y++) {
            yield;
            for (let x = -h; x <= h; x++) {
                const weight = (sharpen ? -1 : 1) * Math.exp(-(x * x + y * y) / (2 * sigma * sigma)) / (2 * Math.PI * sigma * sigma);
                kernel[i++] = weight; sum += weight;
            }
        }
        const center = (kernel.length - 1) / 2;
        kernel[center] = sigma < 1e-12 ? 1 : sharpen ? -2 * sum : kernel[center]! + (1 - sum);
        kernels.push(kernel);
    }
    let low = Infinity, high = -Infinity;
    for (let position = 0; position < width * height * 4; position += 2048) {
        const length = Math.min(2048, width * height * 4 - position);
        const bytes = yield { kind: "read", image: 1, evaluate: true, position, length };
        if (!bytes || bytes.length !== length * 8) throw new Error("Truncated adaptive filter edges");
        const samples = new Float64Array(bytes.slice().buffer);
        for (let i = 0; i < samples.length; i++) if (i % 4 !== 3 || image.hasAlpha) {
            low = Math.min(low, samples[i]!); high = Math.max(high, samples[i]!);
        }
    }
    const hue = image.space !== "cmyk" && (!!image.hueSamples || image.storedHueSamples !== undefined);
    const evaluate = !!image.evaluateSamples || image.storedEvaluateSamples !== undefined;
    const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 127.5 : 0;
    const fill = virtualPixel === "background" || virtualPixel.endsWith("-tile")
        ? [background?.r ?? 255, background?.g ?? 255, background?.b ?? 255, background?.a ?? 255]
        : [gray, gray, gray, virtualPixel === "transparent" ? 0 : 255];
    const blocks = new Map<number, Float64Array>();
    function* sample(index: number): Generator<ConvolveRequest, ArrayLike<number>, Uint8Array | undefined> {
        if (index < 0) return fill;
        const start = Math.floor(index / 512) * 512;
        let samples = blocks.get(start);
        if (!samples) {
            const length = Math.min(512, width * height - start) * 4;
            const bytes = yield { kind: "read", hue, evaluate: !hue && evaluate, highDepth: !hue && !evaluate, position: start * 4, length };
            if (!bytes || bytes.length !== length * (hue || evaluate ? 8 : 2)) throw new Error("Truncated adaptive filter pixels");
            samples = hue ? new Float64Array(bytes.slice().buffer).map(value => value * 255) : evaluate ? new Float64Array(bytes.slice().buffer) : Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257);
            if (blocks.size >= 16) blocks.delete(blocks.keys().next().value!);
            blocks.set(start, samples);
        }
        return samples.subarray((index - start) * 4, (index - start + 1) * 4);
    }
    for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 256) {
        yield;
        const count = Math.min(256, width - left), position = (y * width + left) * 4;
        const edgeBytes = yield { kind: "read", image: 1, evaluate: true, position, length: count * 4 };
        if (!edgeBytes || edgeBytes.length !== count * 32) throw new Error("Truncated adaptive filter edges");
        const edges = new Float64Array(edgeBytes.slice().buffer);
        const output = new Float64Array(count * 4);
        for (let x = 0; x < count; x++) {
            yield;
            const level = (c: number) => high > low ? Math.fround(65535 * (edges[x * 4 + c]! - low) / (high - low)) / 65535 : edges[x * 4 + c]! / 255;
            const intensity = 0.212656 * level(0) + 0.715158 * level(1) + 0.072186 * level(2);
            let j = Math.max(0, Math.min(2 * half + 1, Math.ceil((2 * half + 1) * (1 - intensity) - 0.5)));
            if (j % 2) j--;
            const h = half - j / 2, kernel = kernels[h]!;
            const sums = new Float64Array(4);
            let gamma = 0, alphaGamma = 0, k = 0;
            for (let ky = -h; ky <= h; ky++) {
                yield;
                for (let kx = -h; kx <= h; kx++) {
                    const pixel = yield* sample(virtualPixelIndex(left + x + kx, y + ky, width, height, virtualPixel));
                    const weight = kernel[k++]!, alpha = image.hasAlpha ? pixel[3]! / 255 : 1;
                    for (let c = 0; c < 3; c++) sums[c]! += weight * alpha * pixel[c]!;
                    sums[3]! += weight * pixel[3]!;
                    gamma += weight; alphaGamma += weight * alpha;
                }
            }
            for (let c = 0; c < 4; c++) {
                const divisor = c === 3 ? gamma : alphaGamma;
                output[x * 4 + c] = Math.fround(257 * sums[c]! / (Math.abs(divisor) < 1e-12 ? (divisor < 0 ? -1e-12 : 1e-12) : divisor)) / 257;
            }
        }
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(output.buffer) };
        if (hue) yield { kind: "write", hue: true, position, data: new Uint8Array(output.map(value => value / 255).buffer) };
        yield { kind: "write", highDepth: true, position, data: new Uint8Array(Uint16Array.from(output, value => Math.max(0, Math.min(65535, Math.round(value * 257)))).buffer) };
    }
}
