import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import { convolvePixelSteps, type ConvolveRequest } from "./convolve-kernel.js";

type Image = Pick<RgbaImage, "width" | "height" | "hasAlpha">;

/** Edge detection and auto-leveling, retaining HDRI values between operations. */
export function* adaptiveEdgePixelSteps(image: Image, radius: number): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const half = radius > 0 ? Math.ceil(radius) : 2;
    if (!Number.isFinite(half) || half >= 5000) throw new Error("Adaptive filter radius exceeds 5000");
    const width = half * 2 + 1, weights = Array<number>(width * width).fill(-1);
    weights[Math.floor(weights.length / 2)] = weights.length - 1;
    let low = Infinity, high = -Infinity;
    // Recompute the convolution after finding its range, without retaining a whole image.
    for (let pass = 0; pass < 2; pass++) {
        const steps = convolvePixelSteps(image, { weights, width, height: width, x: half, y: half }, 0);
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
                        yield { kind: "write", highDepth: true, position: request.position, data: new Uint8Array(Uint16Array.from(samples, value => Math.max(0, Math.min(65535, Math.round(value * 257)))).buffer) };
                    }
                } else if (!request) yield;
                next = steps.next();
            }
        }
    }
}

/** Select a blur or sharpening radius from the leveled, blurred edge intensity at each pixel. */
export function* adaptivePixelSteps(image: Image & Partial<Pick<RgbaImage, "evaluateSamples">> & Partial<Pick<StoredRgbaImage, "storedEvaluateSamples">>, geometry: { width?: number; height?: number }, sharpen: boolean): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
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
    for (let position = 0; position < width * height * 4; position += 4096) {
        const length = Math.min(4096, width * height * 4 - position);
        const bytes = yield { kind: "read", image: 1, evaluate: true, position, length };
        if (!bytes || bytes.length !== length * 8) throw new Error("Truncated adaptive filter edges");
        const samples = new Float64Array(bytes.slice().buffer);
        for (let i = 0; i < samples.length; i++) if (i % 4 !== 3 || image.hasAlpha) {
            low = Math.min(low, samples[i]!); high = Math.max(high, samples[i]!);
        }
    }
    const evaluate = !!image.evaluateSamples || image.storedEvaluateSamples !== undefined;
    for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 256) {
        yield;
        const count = Math.min(256, width - left), position = (y * width + left) * 4;
        const edgeBytes = yield { kind: "read", image: 1, evaluate: true, position, length: count * 4 };
        if (!edgeBytes || edgeBytes.length !== count * 32) throw new Error("Truncated adaptive filter edges");
        const edges = new Float64Array(edgeBytes.slice().buffer);
        const rows = new Map<number, Float64Array>();
        const first = Math.max(0, left - half), last = Math.min(width - 1, left + count - 1 + half);
        for (let ky = -half; ky <= half; ky++) {
            const sy = Math.max(0, Math.min(height - 1, y + ky));
            if (rows.has(sy)) continue;
            const length = (last - first + 1) * 4;
            const bytes = yield { kind: "read", evaluate, highDepth: !evaluate, position: (sy * width + first) * 4, length };
            if (!bytes || bytes.length !== length * (evaluate ? 8 : 2)) throw new Error("Truncated adaptive filter pixels");
            rows.set(sy, evaluate ? new Float64Array(bytes.slice().buffer) : Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257));
        }
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
                const row = rows.get(Math.max(0, Math.min(height - 1, y + ky)))!;
                for (let kx = -h; kx <= h; kx++) {
                    const offset = (Math.max(0, Math.min(width - 1, left + x + kx)) - first) * 4;
                    const weight = kernel[k++]!, alpha = image.hasAlpha ? row[offset + 3]! / 255 : 1;
                    for (let c = 0; c < 3; c++) sums[c]! += weight * alpha * row[offset + c]!;
                    sums[3]! += weight * row[offset + 3]!;
                    gamma += weight; alphaGamma += weight * alpha;
                }
            }
            for (let c = 0; c < 4; c++) {
                const divisor = c === 3 ? gamma : alphaGamma;
                output[x * 4 + c] = Math.fround(257 * sums[c]! / (Math.abs(divisor) < 1e-12 ? (divisor < 0 ? -1e-12 : 1e-12) : divisor)) / 257;
            }
        }
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(output.buffer) };
        yield { kind: "write", highDepth: true, position, data: new Uint8Array(Uint16Array.from(output, value => Math.max(0, Math.min(65535, Math.round(value * 257)))).buffer) };
    }
}
