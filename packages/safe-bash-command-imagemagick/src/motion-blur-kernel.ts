import { createMagickRandom } from "./random.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";

// Channel indices in the RGBA/CMYK backing; extra channels follow at index 5.
export function motionBlurChannelOrder(image: Pick<RgbaImage, "space" | "hasAlpha" | "metaChannels"> & Partial<Pick<StoredRgbaImage, "storedMetaChannels">> & { inactiveAlpha?: boolean | undefined }, channels?: { r: boolean; g: boolean; b: boolean; a: boolean; k?: boolean; meta?: number[]; default?: boolean }): number[] {
    const gray = image.space === "b-w" || image.space === "grey16";
    const order = image.space === "cmyk" ? [0, 1, 2, 4] : gray ? [0] : [0, 1, 2];
    if (image.hasAlpha && !image.inactiveAlpha) order.push(3);
    const mask = channels ? [channels.r, channels.g, channels.b, channels.a, channels.k] : undefined;
    const selected = order.filter(channel => !mask || mask[channel]);
    for (let index = 0; index < (image.metaChannels ?? image.storedMetaChannels ?? []).length; index++)
        if (!channels || channels.default || channels.meta?.includes(index)) selected.push(5 + index);
    return selected;
}

export function* motionBlurPixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "data16" | "evaluateSamples" | "space" | "hueSamples"> & Partial<Pick<StoredRgbaImage, "storedData16" | "storedEvaluateSamples" | "storedHueSamples">> & { inactiveAlpha?: boolean | undefined; alphaBlend?: boolean | undefined }, geometry: { width?: number; height?: number; x?: number }, background: RgbaColor, virtualPixel: VirtualPixelMethod = "edge", channels?: { r: boolean; g: boolean; b: boolean; a: boolean; k?: boolean }, seed?: bigint, randomChannels = motionBlurChannelOrder(image, channels)): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const random = virtualPixel === "random" ? createMagickRandom(seed) : undefined;
    const cmyk = image.space === "cmyk";
    const alphaActive = image.hasAlpha || image.alphaBlend !== false;
    const highDepth = !!(image.data16 || image.storedData16);
    // Hue and Lab working samples take precedence over the RGBA backing.
    const hue = image.space !== "cmyk" && (!!image.hueSamples || image.storedHueSamples !== undefined);
    const evaluate = !hue && (!!image.evaluateSamples || image.storedEvaluateSamples !== undefined);
    const scale = !hue && !evaluate && highDepth ? 257 : 1;
    const { width, height } = image, radius = geometry.width ?? 0, sigma = Math.abs(geometry.height ?? 1), angle = geometry.x ?? 0;
    if (![radius, sigma, angle].every(Number.isFinite) || radius >= 5000) throw new Error("Motion blur radius or sigma exceeds limit");
    let half = radius > 0 ? Math.ceil(radius) : 1;
    if (radius <= 0 && sigma > 1e-12) {
        let total = 1 + 2 * Math.exp(-1 / (2 * sigma * sigma));
        for (half = 2; half < 5000; half++) {
            yield;
            const edge = Math.exp(-half * half / (2 * sigma * sigma));
            total += 2 * edge;
            if (edge / total < 1 / 65535) { half--; break; }
        }
    }
    if (half >= 5000) throw new Error("Motion blur radius exceeds limit");
    const samples = 2 * half + 1, weights = new Float64Array(samples);
    const dx = new Int32Array(samples), dy = new Int32Array(samples);
    const px = samples * Math.sin(angle * Math.PI / 180), py = samples * Math.cos(angle * Math.PI / 180);
    let total = 0;
    for (let j = 0; j < samples; j++) {
        yield;
        weights[j] = sigma <= 1e-12 ? (j === 0 ? 1 : 0) : Math.exp(-j * j / (2 * sigma * sigma));
        total += weights[j]!;
        dx[j] = Math.ceil(j * py / Math.hypot(px, py) - 0.5);
        dy[j] = Math.ceil(j * px / Math.hypot(px, py) - 0.5);
    }
    for (let j = 0; j < samples; j++) weights[j]! /= total;
    const gray = image.space === "b-w" || image.space === "grey16";
    const mask = channels ? [channels.r, gray ? channels.r : channels.g, gray ? channels.r : channels.b, channels.a, channels.k] : undefined;
    const samplingChannels = random ? randomChannels : [-1];
    // Native samples a one-sided Gaussian along rounded directional offsets.
    for (let start = 0; start < width * height; start += 1024) {
        yield;
        const count = Math.min(1024, width * height - start);
        const original = yield { kind: "read", hue, evaluate, highDepth, position: start * 4, length: count * 4 };
        if (!original || original.length !== count * 4 * (hue || evaluate ? 8 : highDepth ? 2 : 1)) throw new Error("Truncated motion blur pixels");
        const data = hue ? new Float64Array(original.slice().buffer).map(value => value * 255) : evaluate ? new Float64Array(original.slice().buffer)
            : Float64Array.from(highDepth ? new Uint16Array(original.slice().buffer) : original, value => value / scale);
        const inkBytes = cmyk ? yield { kind: "read", hue: true, position: start * 4, length: count * 4 } : undefined;
        if (cmyk && inkBytes?.length !== count * 32) throw new Error("Truncated motion blur inks");
        const inks = inkBytes ? new Float64Array(inkBytes.slice().buffer) : undefined;
        if (sigma > 1e-12) for (let i = 0; i < count; i++) {
            yield;
            const sx = (start + i) % width, sy = Math.floor((start + i) / width);
            const sums = [0, 0, 0, 0, 0];
            for (const channel of samplingChannels) {
                let alphaSum = 0;
                for (let j = 0; j < samples; j++) {
                    yield;
                    let x = sx + dx[j]!, y = sy + dy[j]!;
                    let pixel: Uint8Array | Uint16Array | Float64Array | number[] | undefined;
                    if (x < 0 || y < 0 || x >= width || y >= height) {
                        const index = virtualPixelIndex(x, y, width, height, virtualPixel, random);
                        if (index >= 0) {
                            x = index % width; y = Math.floor(index / width);
                        } else {
                            // Native gray is half the quantum range; round only the final blurred pixel.
                            const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 127.5 : 0;
                            const samples = (virtualPixel === "background" || virtualPixel?.endsWith("-tile")) ? [background.r, background.g, background.b, background.a] : [gray, gray, gray, virtualPixel === "transparent" ? 0 : 255];
                            pixel = [...samples.map(value => value * scale), gray * scale];
                        }
                    }
                    // Extra channels are processed as separate planes, but share native RNG order.
                    if (channel >= 5) continue;
                    if (!pixel) {
                        const bytes = yield { kind: "read", hue, evaluate, highDepth, position: (y * width + x) * 4, length: 4 };
                        if (!bytes || bytes.length !== 4 * (hue || evaluate ? 8 : highDepth ? 2 : 1)) throw new Error("Truncated motion blur pixels");
                        pixel = hue ? new Float64Array(bytes.slice().buffer).map(value => value * 255) : evaluate ? new Float64Array(bytes.slice().buffer) : highDepth ? new Uint16Array(bytes.buffer, bytes.byteOffset, 4) : bytes;
                    }
                    if (cmyk && x >= 0 && y >= 0 && x < width && y < height) {
                        const bytes = yield { kind: "read", hue: true, position: (y * width + x) * 4, length: 4 };
                        if (!bytes || bytes.length !== 32) throw new Error("Truncated motion blur inks");
                        const sample = new Float64Array(bytes.slice().buffer);
                        pixel = [sample[0]! * 255 * scale, sample[1]! * 255 * scale, sample[2]! * 255 * scale, pixel[3]!, sample[3]! * 255 * scale];
                    }
                    const alpha = alphaActive ? pixel[3]! : 1;
                    if (channel >= 0) {
                        sums[channel]! += pixel[channel]! * (channel === 3 ? 1 : alpha) * weights[j]!;
                        alphaSum += alpha * weights[j]!;
                    } else {
                        if (cmyk) sums[4]! += pixel[4]! * alpha * weights[j]!;
                        for (let c = 0; c < 3; c++) sums[c]! += pixel[c]! * alpha * weights[j]!;
                        sums[3]! += pixel[3]! * weights[j]!;
                    }
                }
                if (channel >= 0 && channel !== 3 && alphaActive) sums[channel] = alphaSum ? sums[channel]! / alphaSum : 0;
            }
            if (random && gray) sums[1] = sums[2] = sums[0]!;
            // Q16-HDRI retains float32 quantum samples until output encoding.
            // Deactivated alpha still weights colors and retains its original samples.
            for (let c = 0; c < (cmyk ? 5 : 4); c++) if ((!mask || mask[c]) && !(c === 3 && image.inactiveAlpha)) {
                const value = Math.fround((c === 3 ? sums[3]! : random || !alphaActive ? sums[c]! : sums[3] ? sums[c]! / sums[3] : 0) * 257 / scale) / 257;
                if (inks && c !== 3) inks[i * 4 + (c === 4 ? 3 : c)] = value / 255;
                else data[i * 4 + c] = value;
            }
        }
        // Native allocates zeroed alpha for an undefined alpha trait, including disassociate.
        if (!alphaActive) for (let i = 0; i < count; i++) data[i * 4 + 3] = 0;
        if (inks) {
            for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) data[i * 4 + c] = (1 - inks[i * 4 + c]!) * (1 - inks[i * 4 + 3]!) * 255;
            yield { kind: "write", hue: true, position: start * 4, data: new Uint8Array(inks.buffer) };
        }
        const encoded = highDepth
            ? Uint16Array.from(data, value => Math.max(0, Math.min(65535, Math.round(value * 257))))
            : Uint8Array.from(data, value => Math.max(0, Math.min(255, Math.round(value))));
        yield { kind: "write", highDepth, position: start * 4, data: new Uint8Array(encoded.buffer) };
        yield { kind: "write", evaluate: true, position: start * 4, data: new Uint8Array(data.buffer) };
        if (hue) yield { kind: "write", hue: true, position: start * 4, data: new Uint8Array(data.map(value => value / 255).buffer) };
    }
}
