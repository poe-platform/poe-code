import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import { convolvePixelSteps, type ConvolveRequest } from "./convolve-kernel.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";

type Image = Pick<RgbaImage, "width" | "height" | "hasAlpha"> & Partial<Pick<RgbaImage, "space" | "hueSamples"> & Pick<StoredRgbaImage, "storedHueSamples">>;
type Channels = { r: boolean; g: boolean; b: boolean; a: boolean; k?: boolean };

export interface AdaptiveEdgeRange {
    images: readonly Image[];
    low?: number[];
    high?: number[];
}

/** Edge detection and auto-leveling, retaining HDRI values between operations. */
export function* adaptiveEdgePixelSteps(image: Image, radius: number, virtualPixel: VirtualPixelMethod = "edge", background?: RgbaColor, channels?: Channels, range: AdaptiveEdgeRange = { images: [image] }, sourceIndex = 0): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const half = radius > 0 ? Math.ceil(radius) : 2;
    if (!Number.isFinite(half) || half >= 5000) throw new Error("Adaptive filter radius exceeds 5000");
    const width = half * 2 + 1, weights = Array<number>(width * width).fill(-1);
    weights[Math.floor(weights.length / 2)] = weights.length - 1;
    const low = range.low ?? Array<number>(5).fill(Infinity), high = range.high ?? Array<number>(5).fill(-Infinity);
    // Recompute the convolution after finding its range, without retaining a whole image.
    for (let pass = 0; pass < 2; pass++) for (const [index, source] of range.images.entries()) {
        if (pass === 0 && range.low || pass === 1 && index !== sourceIndex) continue;
        const cmyk = source.space === "cmyk", stride = cmyk ? 5 : 4;
        // Native per-channel auto-level addresses the fourth RGBA slot as Black, leaving alpha unchanged.
        const selected = [channels?.r ?? true, channels?.g ?? true, channels?.b ?? true, !!source.hasAlpha && (!channels || cmyk) && (channels?.a ?? true), channels ? !!channels.k : true];
        const steps = convolvePixelSteps(source, { weights, width, height: width, x: half, y: half }, 0, undefined, channels, virtualPixel, index === 0 ? background : { r: 0, g: 0, b: 0, a: 255 });
        let next = steps.next();
        let inks: Float64Array | undefined;
        while (!next.done) {
            const request = next.value;
            if (request?.kind === "read") {
                let bytes = yield { ...request, image: index };
                if (request.evaluate && !bytes?.length) {
                    const source = yield { ...request, image: index, evaluate: false, highDepth: true };
                    if (!source || source.length !== request.length * 2) throw new Error("Truncated adaptive filter pixels");
                    bytes = new Uint8Array(Float64Array.from(new Uint16Array(source.slice().buffer), value => value / 257).buffer);
                }
                next = steps.next(bytes);
            } else {
                if (request?.kind === "write" && request.hue && cmyk) inks = new Float64Array(request.data.slice().buffer);
                if (request?.kind === "write" && request.evaluate) {
                    const rgba = new Float64Array(request.data.slice().buffer);
                    const samples = cmyk ? new Float64Array(rgba.length / 4 * stride) : rgba;
                    if (cmyk) for (let i = 0; i < rgba.length / 4; i++)
                        samples.set([inks![i * 4]! * 255, inks![i * 4 + 1]! * 255, inks![i * 4 + 2]! * 255, rgba[i * 4 + 3]!, inks![i * 4 + 3]! * 255], i * stride);
                    for (let i = 0; i < samples.length; i++) {
                        if (!selected[i % stride]) continue;
                        // Default channels share a range; explicit selections level each channel independently.
                        const c = channels ? i % stride : 0;
                        if (pass === 0) { low[c] = Math.min(low[c]!, samples[i]!); high[c] = Math.max(high[c]!, samples[i]!); }
                        else if (high[c]! > low[c]!) samples[i] = Math.fround(65535 * (samples[i]! - low[c]!) / (high[c]! - low[c]!)) / 257;
                    }
                    if (pass === 1) {
                        if (cmyk) {
                            for (let i = 0; i < rgba.length / 4; i++) {
                                inks!.set([samples[i * stride]! / 255, samples[i * stride + 1]! / 255, samples[i * stride + 2]! / 255, samples[i * stride + 4]! / 255], i * 4);
                                for (let c = 0; c < 3; c++) rgba[i * 4 + c] = (1 - inks![i * 4 + c]!) * (1 - inks![i * 4 + 3]!) * 255;
                                rgba[i * 4 + 3] = samples[i * stride + 3]!;
                            }
                            yield { kind: "write", hue: true, position: request.position, data: new Uint8Array(inks!.buffer) };
                        }
                        yield { ...request, data: new Uint8Array(rgba.buffer) };
                        if (image.space !== "cmyk" && (image.hueSamples || image.storedHueSamples !== undefined))
                            yield { kind: "write", hue: true, position: request.position, data: new Uint8Array(samples.map(value => value / 255).buffer) };
                        yield { kind: "write", highDepth: true, position: request.position, data: new Uint8Array(Uint16Array.from(rgba, value => Math.max(0, Math.min(65535, Math.round(value * 257)))).buffer) };
                    }
                } else if (!request) yield;
                next = steps.next();
            }
        }
    }
    range.low = low; range.high = high;
}

/** Select a blur or sharpening radius from the leveled, blurred edge intensity at each pixel. */
export function* adaptivePixelSteps(image: Image & Partial<Pick<RgbaImage, "evaluateSamples">> & Partial<Pick<StoredRgbaImage, "storedEvaluateSamples">>, geometry: { width?: number; height?: number }, sharpen: boolean, virtualPixel: VirtualPixelMethod = "edge", background?: RgbaColor, channels?: Channels, edgeImages: readonly Image[] = [image], edgeChannels = channels): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
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
    const cmyk = image.space === "cmyk", stride = cmyk ? 5 : 4;
    const hue = !cmyk && (!!image.hueSamples || image.storedHueSamples !== undefined);
    const evaluate = !!image.evaluateSamples || image.storedEvaluateSamples !== undefined;
    function* readSamples(position: number, length: number, source = 0): Generator<ConvolveRequest, Float64Array, Uint8Array | undefined> {
        const workingHue = source === 0 && hue, floating = source > 0 || evaluate;
        const bytes = yield { kind: "read", image: source, hue: workingHue, evaluate: !workingHue && floating, highDepth: !workingHue && !floating, position, length };
        if (!bytes || bytes.length !== length * (workingHue || floating ? 8 : 2)) throw new Error("Truncated adaptive filter pixels");
        const rgba = workingHue ? new Float64Array(bytes.slice().buffer).map(value => value * 255)
            : floating ? new Float64Array(bytes.slice().buffer) : Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257);
        if ((source === 0 ? image : edgeImages[source - 1])?.space !== "cmyk") return rgba;
        const inkBytes = yield { kind: "read", image: source, hue: true, position, length };
        if (!inkBytes || inkBytes.length !== length * 8) throw new Error("Truncated adaptive filter inks");
        const inks = new Float64Array(inkBytes.slice().buffer), samples = new Float64Array(length / 4 * 5);
        for (let i = 0; i < length / 4; i++)
            samples.set([inks[i * 4]! * 255, inks[i * 4 + 1]! * 255, inks[i * 4 + 2]! * 255, rgba[i * 4 + 3]!, inks[i * 4 + 3]! * 255], i * 5);
        return samples;
    }
    const selected = [channels?.r ?? true, channels?.g ?? true, channels?.b ?? true, !!image.hasAlpha && (channels?.a ?? true), channels ? !!channels.k : true];
    const edgeSelected = [edgeChannels?.r ?? true, edgeChannels?.g ?? true, edgeChannels?.b ?? true, !!edgeImages[0]!.hasAlpha && (!edgeChannels || edgeImages[0]!.space === "cmyk") && (edgeChannels?.a ?? true), edgeChannels ? !!edgeChannels.k : true];
    const low = Array<number>(5).fill(Infinity), high = Array<number>(5).fill(-Infinity);
    for (const [index, edgeImage] of edgeImages.entries()) {
        if (index > 0 && edgeChannels) continue;
        for (let position = 0; position < width * height * 4; position += 2048) {
            const length = Math.min(2048, width * height * 4 - position);
            const samples = yield* readSamples(position, length, index + 1);
            const edgeStride = edgeImage.space === "cmyk" ? 5 : 4;
            for (let i = 0; i < samples.length; i++) {
                if (index === 0 ? !edgeSelected[i % edgeStride] : i % edgeStride === 3 && !edgeImage.hasAlpha) continue;
                const c = edgeChannels ? i % edgeStride : 0;
                low[c] = Math.min(low[c]!, samples[i]!); high[c] = Math.max(high[c]!, samples[i]!);
            }
        }
    }
    const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 127.5 : 0;
    const fill = virtualPixel === "background" || virtualPixel.endsWith("-tile")
        ? [background?.r ?? 255, background?.g ?? 255, background?.b ?? 255, background?.a ?? 255]
        : [gray, gray, gray, virtualPixel === "transparent" ? 0 : 255];
    if (cmyk) fill.push(gray);
    const blocks = new Map<number, Float64Array>();
    function* sample(index: number): Generator<ConvolveRequest, ArrayLike<number>, Uint8Array | undefined> {
        if (index < 0) return fill;
        const start = Math.floor(index / 512) * 512;
        let samples = blocks.get(start);
        if (!samples) {
            const length = Math.min(512, width * height - start) * 4;
            samples = yield* readSamples(start * 4, length);
            if (blocks.size >= 16) blocks.delete(blocks.keys().next().value!);
            blocks.set(start, samples);
        }
        return samples.subarray((index - start) * stride, (index - start + 1) * stride);
    }
    for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 256) {
        yield;
        const count = Math.min(256, width - left), position = (y * width + left) * 4;
        const edges = yield* readSamples(position, count * 4, 1);
        const output = new Float64Array(count * stride);
        for (let x = 0; x < count; x++) {
            yield;
            const level = (c: number) => {
                const range = edgeChannels ? c : 0, value = edges[x * (edgeImages[0]!.space === "cmyk" ? 5 : 4) + c]!;
                return edgeSelected[c] && high[range]! > low[range]!
                    ? Math.fround(65535 * (value - low[range]!) / (high[range]! - low[range]!)) / 65535 : value / 255;
            };
            const intensity = 0.212656 * level(0) + 0.715158 * level(1) + 0.072186 * level(2);
            let j = Math.max(0, Math.min(2 * half + 1, Math.ceil((2 * half + 1) * (1 - intensity) - 0.5)));
            if (j % 2) j--;
            const h = half - j / 2, kernel = kernels[h]!;
            const sums = new Float64Array(stride);
            let gamma = 0, alphaGamma = 0, k = 0;
            for (let ky = -h; ky <= h; ky++) {
                yield;
                for (let kx = -h; kx <= h; kx++) {
                    const pixel = yield* sample(virtualPixelIndex(left + x + kx, y + ky, width, height, virtualPixel));
                    const weight = kernel[k++]!, alpha = image.hasAlpha ? pixel[3]! / 255 : 1;
                    for (let c = 0; c < stride; c++) if (c !== 3) sums[c]! += weight * alpha * pixel[c]!;
                    sums[3]! += weight * pixel[3]!;
                    gamma += weight; alphaGamma += weight * alpha;
                }
            }
            for (let c = 0; c < stride; c++) {
                if (!selected[c]) {
                    output[x * stride + c] = (yield* sample(y * width + left + x))[c]!;
                    continue;
                }
                const divisor = c === 3 ? gamma : alphaGamma;
                output[x * stride + c] = Math.fround(257 * sums[c]! / (Math.abs(divisor) < 1e-12 ? (divisor < 0 ? -1e-12 : 1e-12) : divisor)) / 257;
            }
        }
        const rgba = cmyk ? new Float64Array(count * 4) : output;
        if (cmyk) {
            const inks = new Float64Array(count * 4);
            for (let i = 0; i < count; i++) {
                inks.set([output[i * stride]! / 255, output[i * stride + 1]! / 255, output[i * stride + 2]! / 255, output[i * stride + 4]! / 255], i * 4);
                for (let c = 0; c < 3; c++) rgba[i * 4 + c] = (1 - inks[i * 4 + c]!) * (1 - inks[i * 4 + 3]!) * 255;
                rgba[i * 4 + 3] = output[i * stride + 3]!;
            }
            yield { kind: "write", hue: true, position, data: new Uint8Array(inks.buffer) };
        }
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(rgba.buffer) };
        if (hue) yield { kind: "write", hue: true, position, data: new Uint8Array(output.map(value => value / 255).buffer) };
        yield { kind: "write", highDepth: true, position, data: new Uint8Array(Uint16Array.from(rgba, value => Math.max(0, Math.min(65535, Math.round(value * 257)))).buffer) };
    }
}
