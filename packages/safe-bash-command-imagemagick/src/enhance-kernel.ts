import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";
import { virtualPixelIndex } from "./virtual-pixel.js";

/** Native 5x5 enhancement: average only perceptually similar neighbors. */
export function* enhancePixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "data16"> & Partial<Pick<StoredRgbaImage, "storedData16">> & { inactiveAlpha?: boolean | undefined; alphaBlend?: boolean | undefined }, background: RgbaColor, method: VirtualPixelMethod = "edge"): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, highDepth = !!(image.data16 || image.storedData16);
    const working = yield { kind: "read", evaluate: true, position: 0, length: 4 };
    const evaluate = !!working?.length, scale = evaluate || !highDepth ? 257 : 1;
    const hasAlpha = image.hasAlpha || image.inactiveAlpha === true && image.alphaBlend !== false;
    const weights = [5, 8, 10, 8, 5, 8, 20, 40, 20, 8, 10, 40, 80, 40, 10, 8, 20, 40, 20, 8, 5, 8, 10, 8, 5];
    const gray = method === "white" ? 255 : method === "gray" ? 128 : 0;
    const fill = (method === "background" || method.endsWith("-tile") ? [background.r, background.g, background.b, background.a] : [gray, gray, gray, method === "transparent" ? 0 : 255]).map(value => value * 257);
    // Four Float64 samples per pixel must fit the 16 KiB storage read limit.
    const blocks = new Map<number, Uint8Array | Uint16Array | Float64Array>();
    function* sample(x: number, y: number): Generator<ConvolveRequest, number[], Uint8Array | undefined> {
        const index = virtualPixelIndex(x, y, width, height, method);
        if (index < 0) return fill;
        const start = Math.floor(index / 512) * 512;
        let data = blocks.get(start);
        if (!data) {
            const length = Math.min(512, width * height - start) * 4;
            const bytes = yield { kind: "read", evaluate, highDepth, position: start * 4, length };
            if (!bytes || bytes.length !== length * (evaluate ? 8 : highDepth ? 2 : 1)) throw new Error("Truncated enhance pixels");
            data = evaluate ? new Float64Array(bytes.slice().buffer) : highDepth ? new Uint16Array(bytes.buffer, bytes.byteOffset, length) : bytes;
            if (blocks.size >= 16) blocks.delete(blocks.keys().next().value!);
            blocks.set(start, data);
        }
        const offset = (index - start) * 4;
        return [data[offset]! * scale, data[offset + 1]! * scale, data[offset + 2]! * scale, hasAlpha ? data[offset + 3]! * scale : 65535];
    }
    for (let start = 0; start < width * height; start += 512) {
        const count = Math.min(512, width * height - start), data = evaluate ? new Float64Array(count * 4) : highDepth ? new Uint16Array(count * 4) : new Uint8Array(count * 4);
        const samples = evaluate ? undefined : new Float64Array(count * 4);
        for (let i = 0; i < count; i++) {
            yield;
            const x = (start + i) % width, y = Math.floor((start + i) / width), center = yield* sample(x, y);
            // GetPixelInfo initializes native's alpha accumulator to opaque.
            const sums = [0, 0, 0, 65535];
            let total = 0;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
                const pixel = yield* sample(x + dx, y + dy);
                let distance = 0;
                for (let c = 0; c < 4; c++) {
                    const mean = (pixel[c]! + center[c]!) / (2 * 65535), delta = (pixel[c]! - center[c]!) / 65535;
                    distance += (c === 0 ? 4 + mean : c === 1 ? 7 - mean : 5 - mean) * delta * delta;
                }
                if (distance >= 0.069) continue;
                const weight = weights[(dy + 2) * 5 + dx + 2]!;
                for (let c = 0; c < 4; c++) sums[c]! += weight * pixel[c]!;
                total += weight;
            }
            for (let c = 0; c < 4; c++) {
                const value = sums[c]! / total + 0.5;
                if (samples) samples[i * 4 + c] = Math.fround(value) / 257;
                data[i * 4 + c] = evaluate ? Math.fround(value) / 257 : Math.max(0, Math.min(65535 / scale, Math.round(value / scale)));
            }
        }
        if (samples) yield { kind: "write", evaluate: true, position: start * 4, data: new Uint8Array(samples.buffer) };
        if (evaluate) {
            yield { kind: "write", evaluate: true, position: start * 4, data: new Uint8Array(data.buffer) };
            const bounded = Uint16Array.from(data, value => Math.max(0, Math.min(65535, Math.round(value * 257))));
            yield { kind: "write", highDepth: true, position: start * 4, data: new Uint8Array(bounded.buffer) };
        } else yield { kind: "write", highDepth, position: start * 4, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
    }
}
