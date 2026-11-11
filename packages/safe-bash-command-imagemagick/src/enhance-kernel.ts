import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";
import { createMagickRandom } from "./random.js";
import { virtualPixelIndex } from "./virtual-pixel.js";

/** Native 5x5 enhancement: average only perceptually similar neighbors. */
export function* enhancePixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "data16" | "space" | "hueSamples"> & Partial<Pick<StoredRgbaImage, "storedData16" | "storedHueSamples">> & { inactiveAlpha?: boolean | undefined; alphaBlend?: boolean | undefined }, background: RgbaColor, method: VirtualPixelMethod = "edge", seed?: bigint): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, highDepth = !!(image.data16 || image.storedData16);
    const working = yield { kind: "read", evaluate: true, position: 0, length: 4 };
    const evaluate = !!working?.length, scale = evaluate || !highDepth ? 257 : 1;
    const hasAlpha = image.hasAlpha || image.inactiveAlpha === true && image.alphaBlend !== false;
    const hue = !!image.hueSamples || image.storedHueSamples !== undefined, cmyk = image.space === "cmyk";
    const weights = [5, 8, 10, 8, 5, 8, 20, 40, 20, 8, 10, 40, 80, 40, 10, 8, 20, 40, 20, 8, 5, 8, 10, 8, 5];
    // Native gray is half the quantum range, not the 8-bit color #808080.
    const gray = method === "white" ? 255 : method === "gray" ? 127.5 : 0;
    const fill = (method === "background" || method.endsWith("-tile") ? [background.r, background.g, background.b, background.a] : [gray, gray, gray, method === "transparent" ? 0 : 255]).map(value => value * 257);
    // Constant virtual pixels use the same quantum for CMYK black ink.
    fill.push(cmyk ? gray * 257 : 0);
    // Four Float64 samples per pixel must fit the 16 KiB storage read limit.
    const blocks = new Map<number, Float64Array>();
    const random = method === "random" ? createMagickRandom(seed) : undefined;
    const randomPixels = new Map<number, number>();
    function* sample(x: number, y: number): Generator<ConvolveRequest, ArrayLike<number>, Uint8Array | undefined> {
        const index = randomPixels.get(y * (width + 4) + x + 2)
            ?? virtualPixelIndex(x, y, width, height, method, random);
        if (index < 0) return fill;
        const start = Math.floor(index / 512) * 512;
        let data = blocks.get(start);
        if (!data) {
            const length = Math.min(512, width * height - start) * 4;
            const bytes = yield { kind: "read", evaluate, highDepth, position: start * 4, length };
            if (!bytes || bytes.length !== length * (evaluate ? 8 : highDepth ? 2 : 1)) throw new Error("Truncated enhance pixels");
            const rgba = Float64Array.from(evaluate ? new Float64Array(bytes.slice().buffer)
                : highDepth ? new Uint16Array(bytes.slice().buffer) : bytes, value => value * scale);
            const planes = hue ? yield { kind: "read", hue: true, position: start * 4, length } : undefined;
            if (hue && planes?.length !== length * 8) throw new Error("Truncated enhance color planes");
            const inks = planes ? new Float64Array(planes.slice().buffer) : undefined;
            // Keep opacity separate from CMYK black, the fourth working sample.
            data = new Float64Array(length / 4 * 5);
            for (let i = 0; i < length / 4; i++) {
                for (let c = 0; c < 3; c++) data[i * 5 + c] = inks ? inks[i * 4 + c]! * 65535 : rgba[i * 4 + c]!;
                data[i * 5 + 3] = hasAlpha ? rgba[i * 4 + 3]! : 65535;
                data[i * 5 + 4] = cmyk && inks ? inks[i * 4 + 3]! * 65535 : 0;
            }
            if (blocks.size >= 16) blocks.delete(blocks.keys().next().value!);
            blocks.set(start, data);
        }
        const offset = (index - start) * 5;
        return data.subarray(offset, offset + 5);
    }
    for (let start = 0; start < width * height; start += 512) {
        const count = Math.min(512, width * height - start), data = highDepth || evaluate ? new Uint16Array(count * 4) : new Uint8Array(count * 4);
        const planes = hue ? new Float64Array(count * 4) : undefined, rgba = new Float64Array(count * 4);
        for (let i = 0; i < count; i++) {
            yield;
            const x = (start + i) % width, y = Math.floor((start + i) / width), center = yield* sample(x, y);
            if (random && x === 0) {
                // Native reads one padded 5-row rectangle per output row and
                // reuses its random border pixels in overlapping neighborhoods.
                randomPixels.clear();
                for (let sy = y - 2; sy <= y + 2; sy++) for (let sx = -2; sx < width + 2; sx++) {
                    if (sx >= 0 && sx < width && sy >= 0 && sy < height) continue;
                    yield;
                    randomPixels.set(sy * (width + 4) + sx + 2,
                        virtualPixelIndex(sx, sy, width, height, method, random));
                }
            }
            // GetPixelInfo initializes native's alpha accumulator to opaque.
            const sums = [0, 0, 0, 65535, 0];
            let total = 0;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
                const pixel = yield* sample(x + dx, y + dy);
                let distance = 0;
                for (let c = 0; c < 5; c++) {
                    const mean = (pixel[c]! + center[c]!) / (2 * 65535), delta = (pixel[c]! - center[c]!) / 65535;
                    distance += (c === 0 ? 4 + mean : c === 1 ? 7 - mean : 5 - mean) * delta * delta;
                }
                if (distance >= 0.069) continue;
                const weight = weights[(dy + 2) * 5 + dx + 2]!;
                for (let c = 0; c < 5; c++) sums[c]! += weight * pixel[c]!;
                total += weight;
            }
            const filtered = sums.map((sum, c) => {
                const value = total > 1e-12 ? sum / total + 0.5 : center[c]!;
                return hue || evaluate ? Math.fround(value) : value;
            });
            for (let c = 0; c < 4; c++) {
                if (planes) planes[i * 4 + c] = filtered[c === 3 && cmyk ? 4 : c]! / 65535;
                const value = cmyk && c < 3 ? (1 - filtered[c]! / 65535) * (1 - filtered[4]! / 65535) * 65535 : filtered[c]!;
                rgba[i * 4 + c] = (hue ? value : Math.fround(value)) / 257;
                data[i * 4 + c] = Math.max(0, Math.min(highDepth || evaluate ? 65535 : 255, Math.round(value / (highDepth || evaluate ? 1 : 257))));
            }
        }
        if (planes) yield { kind: "write", hue: true, position: start * 4, data: new Uint8Array(planes.buffer) };
        yield { kind: "write", evaluate: true, position: start * 4, data: new Uint8Array(rgba.buffer) };
        yield { kind: "write", highDepth: highDepth || evaluate, position: start * 4, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
    }
}
