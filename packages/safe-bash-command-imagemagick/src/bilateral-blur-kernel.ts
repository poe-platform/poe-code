import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";
import { magickIntensity } from "./intensity.js";
import { virtualPixelIndex } from "./virtual-pixel.js";

/** Native bilateral weights use byte-rounded intensity, not RGB distance. */
export function* bilateralBlurPixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "data16" | "space" | "hueSamples" | "evaluateSamples"> & Partial<Pick<StoredRgbaImage, "storedData16" | "storedHueSamples" | "storedEvaluateSamples">> & { magickColorspace?: string | undefined }, geometry: { width?: number; height?: number; x: number; y: number; hasOffset: boolean; hasYOffset: boolean }, background: RgbaColor, method: VirtualPixelMethod = "edge", channels?: { r: boolean; g: boolean; b: boolean; a: boolean; k?: boolean }, intensity = "rec709luma"): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const w = geometry.width ?? 0, h = geometry.height ?? w;
    const colorSigma = geometry.hasOffset ? geometry.x : Math.sqrt(w * w + h * h);
    const spatialSigma = geometry.hasYOffset ? geometry.y : Math.sqrt(w * w + h * h) / 4;
    if ((geometry.width === undefined && geometry.height === undefined) || ![w, h, colorSigma, spatialSigma].every(Number.isFinite)) throw new Error("Invalid bilateral-blur geometry");
    if (w < 0 || h < 0 || w > 1000 || h > 1000) throw new Error("Bilateral blur window exceeds limit");
    const columns = Math.max(1, Math.trunc(w)), rows = Math.max(1, Math.trunc(h));
    const hue = !!image.hueSamples || image.storedHueSamples !== undefined, cmyk = image.space === "cmyk";
    const { width, height } = image, highDepth = !!(image.data16 || image.storedData16), quantum = hue ? 1 : highDepth ? 65535 : 255;
    const stride = cmyk ? 5 : 4, alpha = stride - 1;
    const blend = image.hasAlpha || method === "transparent" || ((method === "background" || method.endsWith("-tile")) && background.a < 255);
    const mask = channels ? [channels.r, channels.g, channels.b, ...(cmyk ? [channels.k] : []), channels.a] : Array<boolean>(stride).fill(true);
    const gaussian = (distance: number, sigma: number): number => Math.exp(-distance * distance / Math.max(2 * sigma * sigma, 1e-12)) / Math.max(2 * Math.PI * sigma * sigma, 1e-12);
    const tonal = Float64Array.from({ length: 511 }, (_, i) => gaussian(i - 255, colorSigma));
    const spatial = new Float64Array(columns * rows);
    for (let y = 0; y < rows; y++) {
        yield;
        for (let x = 0; x < columns; x++) spatial[y * columns + x] = gaussian(Math.sqrt((x - Math.floor(columns / 2)) ** 2 + (y - Math.floor(rows / 2)) ** 2), spatialSigma);
    }
    const gray = method === "white" ? 255 : method === "gray" ? 128 : 0;
    const fill = (method === "background" || method.endsWith("-tile") ? [background.r, background.g, background.b, background.a] : [gray, gray, gray, method === "transparent" ? 0 : 255]).map(value => value * quantum / 255);
    if (cmyk) fill.splice(3, 0, 0);
    const blocks = new Map<number, Uint8Array | Uint16Array | Float64Array>();
    function* sample(x: number, y: number): Generator<ConvolveRequest, ArrayLike<number>, Uint8Array | undefined> {
        const index = virtualPixelIndex(x, y, width, height, method);
        if (index < 0) return fill;
        const start = Math.floor(index / 1024) * 1024;
        let data = blocks.get(start);
        if (!data) {
            const length = Math.min(1024, width * height - start) * 4;
            const working = hue ? undefined : yield { kind: "read", evaluate: true, position: start * 4, length };
            if (working?.length) {
                if (working.length !== length * 8) throw new Error("Truncated bilateral blur pixels");
                data = Float64Array.from(new Float64Array(working.slice().buffer), value => value * quantum / 255);
            } else {
                const bytes = yield { kind: "read", hue, highDepth, position: start * 4, length };
                if (!bytes || bytes.length !== length * (hue ? 8 : highDepth ? 2 : 1)) throw new Error("Truncated bilateral blur pixels");
                data = hue ? new Float64Array(bytes.slice().buffer) : highDepth ? new Uint16Array(bytes.buffer, bytes.byteOffset, length) : bytes;
            }
            if (cmyk) {
                // CMYK's fourth working sample is black; opacity lives in the RGBA backing.
                const evaluate = !!image.evaluateSamples || image.storedEvaluateSamples !== undefined;
                const bytes = yield { kind: "read", evaluate, highDepth: true, position: start * 4, length };
                if (!bytes || bytes.length !== length * (evaluate ? 8 : 2)) throw new Error("Truncated bilateral blur alpha");
                const rgba = evaluate ? new Float64Array(bytes.slice().buffer) : new Uint16Array(bytes.slice().buffer), inks = data;
                data = new Float64Array(length / 4 * stride);
                for (let i = 0; i < length / 4; i++) {
                    data.set(inks.subarray(i * 4, i * 4 + 4), i * stride);
                    data[i * stride + alpha] = rgba[i * 4 + 3]! / (evaluate ? 255 : 65535);
                }
            }
            if (blocks.size >= 16) blocks.delete(blocks.keys().next().value!);
            blocks.set(start, data);
        }
        return data.subarray((index - start) * stride, (index - start) * stride + stride);
    }
    const luma = (pixel: ArrayLike<number>): number => Math.max(0, Math.min(255, Math.floor(Math.fround(magickIntensity(pixel[0]!, pixel[1]!, pixel[2]!, intensity, quantum, image.magickColorspace === "RGB" || image.magickColorspace === "scRGB") * 65535 / quantum) / 257 + 0.5)));
    for (let start = 0; start < width * height; start += 1024) {
        const count = Math.min(1024, width * height - start), data = highDepth ? new Uint16Array(count * 4) : new Uint8Array(count * 4);
        const working = hue ? new Float64Array(count * 4) : undefined;
        const rgba = new Float64Array(count * 4);
        for (let i = 0; i < count; i++) {
            yield;
            const x = (start + i) % width, y = Math.floor((start + i) / width), center = yield* sample(x, y), centerLuma = luma(center);
            const sums = Array<number>(stride).fill(0);
            let total = 0, alphaTotal = 0;
            for (let dy = 0; dy < rows; dy++) for (let dx = 0; dx < columns; dx++) {
                yield;
                const pixel = yield* sample(x + dx - Math.floor(columns / 2), y + dy - Math.floor(rows / 2));
                const weight = tonal[luma(pixel) - centerLuma + 255]! * spatial[dy * columns + dx]!;
                total += weight;
                alphaTotal += weight * center[alpha]! / quantum * pixel[alpha]! / quantum;
                for (let c = 0; c < stride; c++) sums[c]! += weight * pixel[c]!;
            }
            const filtered = Array.from(center);
            for (let c = 0; c < stride; c++) {
                const divisor = blend && c !== alpha ? alphaTotal : total;
                const value = mask[c] ? sums[c]! / Math.max(divisor, 1e-12) : center[c]!;
                filtered[c] = Math.fround(value * 65535 / quantum) / 65535;
            }
            if (working) {
                working.set(filtered.slice(0, 4), i * 4);
                for (let c = 0; c < 3; c++) rgba[i * 4 + c] = (cmyk ? (1 - filtered[c]!) * (1 - filtered[3]!) : filtered[c]!) * 255;
                rgba[i * 4 + 3] = filtered[alpha]! * 255;
            } else for (let c = 0; c < 4; c++) rgba[i * 4 + c] = filtered[c]! * 255;
            for (let c = 0; c < 4; c++) {
                const value = rgba[i * 4 + c]! / 255;
                data[i * 4 + c] = Math.max(0, Math.min(highDepth ? 65535 : 255, Math.round(value * (highDepth ? 65535 : 255))));
            }
        }
        yield { kind: "write", highDepth, position: start * 4, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
        if (working) yield { kind: "write", hue: true, position: start * 4, data: new Uint8Array(working.buffer) };
        yield { kind: "write", evaluate: true, position: start * 4, data: new Uint8Array(rgba.buffer) };
    }
}
