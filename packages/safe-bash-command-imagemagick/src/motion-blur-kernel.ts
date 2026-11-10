import { virtualPixelIndex } from "./virtual-pixel.js";
import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";

export function* motionBlurPixelSteps(image: Pick<RgbaImage, "width" | "height" | "data16" | "evaluateSamples" | "space"> & Partial<Pick<StoredRgbaImage, "storedData16" | "storedEvaluateSamples">>, geometry: { width?: number; height?: number; x?: number }, background: RgbaColor, virtualPixel: VirtualPixelMethod = "edge", channels?: { r: boolean; g: boolean; b: boolean; a: boolean }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const highDepth = !!(image.data16 || image.storedData16);
    const evaluate = !!image.evaluateSamples || image.storedEvaluateSamples !== undefined;
    const scale = !evaluate && highDepth ? 257 : 1;
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
    const mask = channels ? [channels.r, gray ? channels.r : channels.g, gray ? channels.r : channels.b, channels.a] : undefined;
    // Native samples a one-sided Gaussian along rounded directional offsets.
    for (let start = 0; start < width * height; start += 1024) {
        yield;
        const count = Math.min(1024, width * height - start);
        const original = yield { kind: "read", evaluate, highDepth, position: start * 4, length: count * 4 };
        if (!original || original.length !== count * 4 * (evaluate ? 8 : highDepth ? 2 : 1)) throw new Error("Truncated motion blur pixels");
        const data = evaluate ? new Float64Array(original.slice().buffer)
            : Float64Array.from(highDepth ? new Uint16Array(original.slice().buffer) : original, value => value / scale);
        if (sigma > 1e-12) for (let i = 0; i < count; i++) {
            yield;
            const sx = (start + i) % width, sy = Math.floor((start + i) / width);
            const sums = [0, 0, 0, 0];
            for (let j = 0; j < samples; j++) {
                yield;
                let x = sx + dx[j]!, y = sy + dy[j]!;
                let pixel: Uint8Array | Uint16Array | Float64Array | number[] | undefined;
                if (x < 0 || y < 0 || x >= width || y >= height) {
                    const index = virtualPixelIndex(x, y, width, height, virtualPixel);
                    if (index >= 0) {
                        x = index % width; y = Math.floor(index / width);
                    } else {
                        // Native gray is half the quantum range; round only the final blurred pixel.
                        const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 127.5 : 0;
                        const samples = (virtualPixel === "background" || virtualPixel?.endsWith("-tile")) ? [background.r, background.g, background.b, background.a] : [gray, gray, gray, virtualPixel === "transparent" ? 0 : 255];
                        pixel = samples.map(value => value * scale);
                    }
                }
                if (!pixel) {
                    const bytes = yield { kind: "read", evaluate, highDepth, position: (y * width + x) * 4, length: 4 };
                    if (!bytes || bytes.length !== 4 * (evaluate ? 8 : highDepth ? 2 : 1)) throw new Error("Truncated motion blur pixels");
                    pixel = evaluate ? new Float64Array(bytes.slice().buffer) : highDepth ? new Uint16Array(bytes.buffer, bytes.byteOffset, 4) : bytes;
                }
                for (let c = 0; c < 3; c++) sums[c]! += pixel[c]! * pixel[3]! * weights[j]!;
                sums[3]! += pixel[3]! * weights[j]!;
            }
            // Q16-HDRI retains float32 quantum samples until output encoding.
            for (let c = 0; c < 4; c++) if (!mask || mask[c]) data[i * 4 + c] = Math.fround((c === 3 ? sums[3]! : sums[3] ? sums[c]! / sums[3] : 0) * 257 / scale) / 257;
        }
        const encoded = highDepth
            ? Uint16Array.from(data, value => Math.max(0, Math.min(65535, Math.round(value * 257))))
            : Uint8Array.from(data, value => Math.max(0, Math.min(255, Math.round(value))));
        yield { kind: "write", highDepth, position: start * 4, data: new Uint8Array(encoded.buffer) };
        yield { kind: "write", evaluate: true, position: start * 4, data: new Uint8Array(data.buffer) };
    }
}
