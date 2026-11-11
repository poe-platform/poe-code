import { virtualPixelIndex } from "./virtual-pixel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";
import { resizeContributions, type MagickResizeKernel, type ResizeFilterSettings } from "./resize-kernel.js";
import type { RgbaImage } from "@poe-code/image-ast/portable";
import type { HueMetadata } from "./colorspace-hue.js";
import { createMagickRandom } from "./random.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

function kernelWidth(radius: number, sigma: number): number {
    if (radius > 0) return 2 * Math.ceil(radius) + 1;
    if (sigma < 1e-12) return 3;
    let sum = 1 + 2 * Math.exp(-1 / (2 * sigma * sigma));
    for (let half = 2; half <= 5000; half++) {
        const edge = Math.exp(-half * half / (2 * sigma * sigma));
        sum += 2 * edge;
        if (edge / sum < 1 / 65535) return half * 2 - 1;
    }
    throw new Error("Sketch radius exceeds 5000");
}

/** ImageMagick's noise, directional blur, edge, normalize and color-dodge sketch. */
export function* sketchPixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "space"> & HueMetadata & { virtualPixel?: VirtualPixelMethod | undefined; inactiveAlpha?: boolean | undefined; alphaBlend?: boolean | undefined; alphaSeparate?: boolean | undefined }, geometry: { width?: number; height?: number; x?: number }, seed: bigint, selection?: { r: boolean; g: boolean; b: boolean; a: boolean }, kernel?: MagickResizeKernel, settings: ResizeFilterSettings = {}): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const selected = selection ? [selection.r, selection.g, selection.b, selection.a] : undefined;
    const cmyk = image.space === "cmyk";
    const hue = image.hueSamples !== undefined || image.storedHueSamples !== undefined;
    const radius = geometry.width ?? 0, sigma = Math.abs(geometry.height ?? 1), angle = geometry.x ?? 0;
    if (![radius, sigma, angle].every(Number.isFinite) || radius < 0 || radius > 5000) throw new Error("Invalid sketch geometry");
    const width = image.width * 2, height = image.height * 2, size = width * height;
    const hasAlpha = image.hasAlpha || image.inactiveAlpha === true && image.alphaBlend !== false;
    const copyAlpha = hasAlpha && !image.hasAlpha && image.alphaSeparate !== true;
    const alphas = hasAlpha ? new Float64Array(size) : undefined;
    const alphaScratch = hasAlpha ? new Float64Array(size) : undefined;
    const random = createMagickRandom(seed);
    let values = new Float64Array(size), scratch = new Float64Array(size);
    for (let i = 0; i < size; i++) {
        if (i % 1024 === 0) yield;
        values[i] = random();
    }
    const virtualPixel = image.virtualPixel ?? "edge";
    const outside = virtualPixel === "white" || virtualPixel === "background" || virtualPixel.endsWith("-tile") ? 1 : virtualPixel === "gray" ? 0.5 : 0;
    const outsideAlpha = virtualPixel === "transparent" ? 0 : 1;
    const length = kernelWidth(radius, sigma), weights = new Float64Array(length);
    let total = 0;
    for (let k = 0; k < length; k++) { weights[k] = sigma < 1e-12 ? (k === 0 ? 1 : 0) : Math.exp(-k * k / (2 * sigma * sigma)); total += weights[k]!; }
    const dx = new Int32Array(length), dy = new Int32Array(length);
    for (let k = 0; k < length; k++) { weights[k]! /= total; dx[k] = Math.ceil(k * Math.cos(angle * Math.PI / 180) - 0.5); dy[k] = Math.ceil(k * Math.sin(angle * Math.PI / 180) - 0.5); }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (x % 256 === 0) yield;
        let sum = 0, alpha = 0;
        for (let k = 0; k < length; k++) {
            const index = virtualPixelIndex(x + dx[k]!, y + dy[k]!, width, height, virtualPixel);
            const value = index < 0 ? outside : values[index]!;
            const opacity = index < 0 ? outsideAlpha : value;
            sum += weights[k]! * value * (hasAlpha ? opacity : 1); alpha += weights[k]! * opacity;
        }
        scratch[y * width + x] = hasAlpha ? sum / Math.max(1e-12, alpha) : sum;
        if (alphas) alphas[y * width + x] = copyAlpha ? values[y * width + x]! : alpha;
    }
    [values, scratch] = [scratch, values];
    const edgeWidth = kernelWidth(radius, 0.5), half = (edgeWidth - 1) / 2, histogram = new Uint32Array(65536);
    const edgeSample = (x: number, y: number): number => {
        const i = virtualPixelIndex(x, y, width, height, virtualPixel);
        return i < 0 ? outside * (image.hasAlpha ? outsideAlpha : 1) : values[i]! * (image.hasAlpha ? alphas![i]! : 1);
    };
    const edgeAlpha = (x: number, y: number): number => {
        const i = virtualPixelIndex(x, y, width, height, virtualPixel);
        return alphas ? i < 0 ? outsideAlpha : alphas[i]! : 0;
    };
    // Edge convolution premultiplies only active alpha; inactive alpha still
    // participates in motion blur, resize and compositing.
    for (let y = 0; y < height; y++) {
        yield;
        let sum = 0, alphaSum = 0;
        for (let k = -half; k <= half; k++) {
            sum += edgeSample(k, y);
            alphaSum += edgeAlpha(k, y);
        }
        for (let x = 0; x < width; x++) {
            if (x % 1024 === 0) yield;
            scratch[y * width + x] = sum;
            if (alphaScratch) alphaScratch[y * width + x] = alphaSum;
            sum += edgeSample(x + half + 1, y) - edgeSample(x - half, y);
            alphaSum += edgeAlpha(x + half + 1, y) - edgeAlpha(x - half, y);
        }
    }
    const rowSample = (x: number, y: number): number => {
        const i = virtualPixelIndex(x, y, width, height, virtualPixel);
        return i < 0 ? edgeWidth * outside * (image.hasAlpha ? outsideAlpha : 1) : scratch[i]!;
    };
    const rowAlpha = (x: number, y: number): number => {
        const i = virtualPixelIndex(x, y, width, height, virtualPixel);
        return alphaScratch ? i < 0 ? edgeWidth * outsideAlpha : alphaScratch[i]! : 0;
    };
    for (let x = 0; x < width; x++) {
        yield;
        let sum = 0, alphaSum = 0;
        for (let k = -half; k <= half; k++) {
            sum += rowSample(x, k);
            alphaSum += rowAlpha(x, k);
        }
        for (let y = 0; y < height; y++) {
            if (y % 1024 === 0) yield;
            const i = y * width + x;
            const alpha = alphas ? edgeWidth * edgeWidth * alphas[i]! - alphaSum : 1;
            const divisor = image.hasAlpha ? alpha : 1;
            const edge = (edgeWidth * edgeWidth * values[i]! * (image.hasAlpha ? alphas![i]! : 1) - sum) / (Math.abs(divisor) < 1e-12 ? (divisor < 0 ? -1e-12 : 1e-12) : divisor);
            const bin = Math.round(Math.max(0, Math.min(1, edge)) * 65535);
            values[i] = bin; histogram[bin]!++;
            if (alphas && !copyAlpha) alphas[i] = Math.round(Math.max(0, Math.min(1, alpha)) * 65535);
            sum += rowSample(x, y + half + 1) - rowSample(x, y - half);
            alphaSum += rowAlpha(x, y + half + 1) - rowAlpha(x, y - half);
        }
    }
    let low = 0, high = 65535, count = 0;
    for (; low < 65535; low++) { count += histogram[low]!; if (count > size * 0.02) break; }
    count = 0;
    for (; high > 0; high--) { count += histogram[high]!; if (count > size * 0.01) break; }
    for (let i = 0; i < size; i++) {
        if (i % 1024 === 0) yield;
        values[i] = 1 - Math.max(0, Math.min(1, high === low ? values[i]! / 65535 : (values[i]! - low) / (high - low)));
        if (alphas && !copyAlpha) alphas[i] = 1 - Math.max(0, Math.min(1, high === low ? alphas[i]! / 65535 : (alphas[i]! - low) / (high - low)));
    }
    // Native 50% resize filters vertically first; alpha defaults to Mitchell.
    kernel = settings.window ? "sinc" : kernel ?? (hasAlpha ? "mitchell" : "lanczos3");
    const blur = Math.max(1e-12, (settings.blur ?? 1) * (kernel === "lanczos2sharp" ? 0.9549963639785485
        : kernel === "lanczossharp" ? 0.9812505644269356 : 1));
    for (let y = 0; y < image.height; y++) {
        const vertical = resizeContributions(y, height, image.height, blur, false, kernel, 0, settings);
        for (let x = 0; x < width; x++) {
            if (x % 1024 === 0) yield;
            let sum = 0, weight = 0, alpha = 0;
            for (let k = 0; k < vertical.weights.length; k++) {
                const w = vertical.weights[k]!, i = (vertical.first + k) * width + x;
                sum += values[i]! * w * (alphas?.[i] ?? 1);
                alpha += w * (alphas?.[i] ?? 1); weight += w;
            }
            scratch[y * width + x] = sum / (Math.abs(alpha) < 1e-12 ? (alpha < 0 ? -1e-12 : 1e-12) : alpha);
            if (alphaScratch) alphaScratch[y * width + x] = copyAlpha ? alphas![Math.min(height - 1, y * 2 + 1) * width + x]! : alpha / weight;
        }
    }
    for (let y = 0; y < image.height; y++) for (let left = 0; left < image.width; left += 1024) {
        yield;
        const count = Math.min(1024, image.width - left), position = (y * image.width + left) * 4;
        const evaluate = yield { kind: "read", evaluate: true, position, length: count * 4 };
        const bytes = evaluate?.length ? evaluate : yield { kind: "read", highDepth: true, position, length: count * 4 };
        if (!bytes || bytes.length !== count * 4 * (evaluate?.length ? 8 : 2)) throw new Error("Truncated sketch pixels");
        const originalSamples = evaluate?.length ? new Float64Array(bytes.slice().buffer)
            : Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257);
        const data = new Float64Array(originalSamples);
        const workingBytes = hue ? yield { kind: "read", hue: true, position, length: count * 4 } : undefined;
        if (hue && workingBytes?.length !== count * 32) throw new Error("Truncated sketch working samples");
        const channels = workingBytes ? new Float64Array(workingBytes.slice().buffer) : undefined;
        for (let x = 0; x < count; x++) {
            const horizontal = resizeContributions(left + x, width, image.width, blur, false, kernel, 0, settings);
            let sum = 0, weight = 0, alpha = 0;
            for (let k = 0; k < horizontal.weights.length; k++) {
                const w = horizontal.weights[k]!, i = y * width + horizontal.first + k;
                sum += scratch[i]! * w * (alphaScratch?.[i] ?? 1);
                alpha += w * (alphaScratch?.[i] ?? 1); weight += w;
            }
            // Keep resize overshoot until compositing; native clamps each composite result.
            const sourceColor = sum / (Math.abs(alpha) < 1e-12 ? (alpha < 0 ? -1e-12 : 1e-12) : alpha);
            const dodge = alpha > 0 ? Math.max(0, Math.min(1, sourceColor)) : 0;
            const sourceAlpha = copyAlpha ? alphaScratch![y * width + Math.min(width - 1, (left + x) * 2 + 1)]! : alpha / weight;
            const originalAlpha = hasAlpha ? originalSamples[x * 4 + 3]! / 255 : 1;
            const dodgeAlpha = Math.max(0, Math.min(1, sourceAlpha + originalAlpha - sourceAlpha * originalAlpha));
            // Sketch's final Blend adds the original when it has an alpha channel.
            const blendAlpha = image.hasAlpha ? originalAlpha : 0;
            const outputAlpha = Math.max(0, Math.min(1, blendAlpha + (copyAlpha ? originalAlpha : dodgeAlpha)));
            for (let channel = 0; channel < (cmyk ? 4 : 3); channel++) {
                if (selected && !selected[channel]) continue;
                const original = channels ? channels[x * 4 + channel]! : originalSamples[x * 4 + channel]! / 255;
                const color = dodge >= 1 ? 1 : Math.min(1, original / Math.max(1e-12, 1 - dodge));
                const premultiplied = sourceAlpha * originalAlpha * color + sourceAlpha * (1 - originalAlpha) * sourceColor + originalAlpha * (1 - sourceAlpha) * original;
                const dodgeColor = Math.max(0, Math.min(1, premultiplied / Math.max(1e-12, dodgeAlpha)));
                const value = Math.max(0, Math.min(1, (blendAlpha * original + (copyAlpha ? originalAlpha : dodgeAlpha) * dodgeColor) / Math.max(1e-12, outputAlpha)));
                if (channels) channels[x * 4 + channel] = Math.fround(value * 65535) / 65535;
                else data[x * 4 + channel] = Math.fround(65535 * value) / 257;
            }
            if (!copyAlpha && (!selected || selected[3])) data[x * 4 + 3] = 255 * outputAlpha;
            if (channels && !cmyk && !copyAlpha && (!selected || selected[3])) channels[x * 4 + 3] = Math.fround(outputAlpha * 65535) / 65535;
        }
        if (channels) {
            yield { kind: "write", hue: true, position, data: new Uint8Array(channels.buffer) };
            // CMYK keeps alpha in the RGBA backing and black in the fourth ink plane.
            for (let x = 0; x < count; x++) {
                for (let channel = 0; channel < 3; channel++) data[x * 4 + channel] = 255 * (cmyk
                    ? (1 - channels[x * 4 + channel]!) * (1 - channels[x * 4 + 3]!) : channels[x * 4 + channel]!);
                if (!cmyk) data[x * 4 + 3] = channels[x * 4 + 3]! * 255;
            }
        }
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(data.buffer) };
        const bounded = Uint8Array.from(data, value => Math.round(Math.max(0, Math.min(255, value))));
        yield { kind: "write", position, data: bounded };
    }
}
