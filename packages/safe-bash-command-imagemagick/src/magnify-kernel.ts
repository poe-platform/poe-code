/*!
 * Fish2x rules adapted from ImageMagick 7.1.2-35 MagickCore/resize.c.
 * Copyright 1999 ImageMagick Studio LLC. Licensed under the ImageMagick
 * License (https://imagemagick.org/license/); see ../LICENSE for its text.
 * Modified for bounded TypeScript RGBA raster processing.
 */
import { hq2xPixels } from "./hq2x-kernel.js";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { VirtualPixelMethod } from "./warp-kernel.js";
import { magickIntensity } from "./intensity.js";
import { virtualPixelIndex } from "./virtual-pixel.js";

export type MagnifyMethod = "fish2x" | "hq2x" | "epbx2x" | "scale2x" | "eagle2x" | "scale3x" | "eagle3x" | "xbr2x";

export function parseMagnifyMethod(value: string): MagnifyMethod {
    const method = value.toLowerCase();
    if (method === "fish2x" || method === "hq2x" || method === "epbx2x" || method === "scale2x" || method === "eagle2x" || method === "scale3x" || method === "eagle3x" || method === "xbr2x") return method;
    // Native defaults unknown names to Scale2x, but these names select distinct algorithms.
    if (["eagle3xb"].includes(method)) {
        throw new Error(`Unsupported magnify method: ${value}`);
    }
    return "scale2x";
}

// Bounded row neighborhoods serve both in-memory and retained rasters.
// Keep working samples outside the quantum range available to later arithmetic.
export function* magnifyPixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "evaluateSamples"> & Partial<Pick<StoredRgbaImage, "storedEvaluateSamples">>, method: MagnifyMethod = "scale2x", background: RgbaColor, virtualPixel: VirtualPixelMethod = "edge", intensityMethod = "rec709luma"): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const evaluate = !!image.evaluateSamples || image.storedEvaluateSamples !== undefined;
    const Samples = evaluate ? Float64Array : Uint16Array;
    const factor = method === "scale3x" || method === "eagle3x" ? 3 : 2;
    const radius = method === "xbr2x" ? 2 : 1;
    const gray = virtualPixel === "white" ? 65535 : virtualPixel === "gray" ? 32768 : 0;
    const fill = virtualPixel === "background" || virtualPixel.endsWith("-tile")
        ? [background.r, background.g, background.b, background.a].map(value => Math.round(value * 257))
        : [gray, gray, gray, virtualPixel === "transparent" ? 0 : 65535];
    for (let y = 0; y < image.height; y++) for (let left = 0; left < image.width; left += 1024) {
        yield;
        const count = Math.min(1024, image.width - left);
        const rows: (Uint16Array | Float64Array)[] = [];
        for (let dy = -radius; dy <= radius; dy++) {
            const row = new Samples((count + 2 * radius) * 4);
            for (let column = 0; column < count + 2 * radius;) {
                const pixel = virtualPixelIndex(left + column - radius, y + dy, image.width, image.height, virtualPixel);
                if (pixel < 0) {
                    row.set(fill, column++ * 4);
                    continue;
                }
                // Keep contiguous reads bounded, splitting where virtual pixels wrap.
                let length = 1;
                while (column + length < count + 2 * radius && virtualPixelIndex(left + column + length - radius, y + dy, image.width, image.height, virtualPixel) === pixel + length) length++;
                const bytes = yield { kind: "read", highDepth: !evaluate, evaluate, position: pixel * 4, length: length * 4 };
                if (!bytes || bytes.length !== length * 4 * (evaluate ? 8 : 2)) throw new Error("Truncated magnify pixels");
                row.set(evaluate ? new Float64Array(bytes.slice().buffer).map(value => value * 257) : new Uint16Array(bytes.slice().buffer), column * 4);
                column += length;
            }
            rows.push(row);
        }
        const output = Array.from({ length: factor }, () => new Samples(count * factor * 4));
        for (let x = 0; x < count; x++) {
            const pixels = rows.flatMap(row => Array.from({ length: 2 * radius + 1 }, (_, dx) => {
                const offset = (x + dx) * 4;
                return row.subarray(offset, offset + 4);
            }));
            const eq = (a: number, b: number) => pixels[a]!.every((value, channel) => channel === 3 && !image.hasAlpha || value === pixels[b]![channel]);
            if (method === "hq2x") {
                const blended = hq2xPixels(pixels, eq);
                for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
                    output[dy]!.set(blended[dy * 2 + dx]!, (x * 2 + dx) * 4);
                }
                continue;
            }
            const selected = new Array<number>(factor * factor).fill(method === "xbr2x" ? 12 : 4);
            if (method === "fish2x") {
                // Native Fish2x uses the upper-left 2x2 of the 3x3 neighborhood.
                const intensity = (index: number) => magickIntensity(pixels[index]![0]!, pixels[index]![1]!, pixels[index]![2]!, intensityMethod, 65535, false);
                const a = intensity(0), b = intensity(1), d = intensity(3), e = intensity(4);
                const ab = eq(0, 1), ad = eq(0, 3), ae = eq(0, 4), bd = eq(1, 3), be = eq(1, 4), de = eq(3, 4);
                selected[0] = 0;
                selected[1] = a > b ? 0 : 1;
                selected[2] = a > d ? 0 : 3;
                let mix: number[];
                if (ae && bd && ab) mix = [0];
                else if (ad && de && !ab) mix = a > b ? [0, 4, 3] : [1, 0, 4];
                else if (be && de && !ab) mix = b > a ? [1, 3, 4] : [0, 1, 3];
                else if (ad && ab && !be) mix = d > e ? [3, 1, 0] : [4, 3, 1];
                else if (ab && be && !ad) mix = a > d ? [0, 4, 1] : [3, 0, 4];
                else if (ae && (!bd || b > a)) mix = [0, 4];
                else if (bd && (!ae || a > b)) mix = [1, 3];
                else if (ab) mix = d > a ? [3, 4] : [0, 1];
                else if (de) mix = a > d ? [0, 1] : [3, 4];
                else if (ad) mix = b > a ? [1, 4] : [0, 3];
                else if (be) mix = a > b ? [0, 3] : [1, 4];
                else mix = [0, 1, 3, 4];
                // MixPixels truncates the Q16 average, including alpha.
                const blended = new Samples(4);
                for (let channel = 0; channel < 4; channel++) {
                    blended[channel] = Math.trunc(mix.reduce((sum, index) => sum + pixels[index]![channel]!, 0) / mix.length);
                }
                selected[3] = pixels.push(blended) - 1;
            } else if (method === "xbr2x") {
                // ImageMagick Xbr2X: equality weights over a row-major 5x5 neighborhood.
                const w = (a: number, b: number) => eq(a, b) ? 0 : 1;
                if (w(12, 16) + w(12, 8) + w(6, 10) + w(6, 2) + 4 * w(11, 7) <
                    w(11, 17) + w(11, 5) + w(7, 13) + w(7, 1) + 4 * w(12, 6)) selected[0] = w(12, 11) <= w(12, 7) ? 11 : 7;
                if (w(12, 18) + w(12, 6) + w(8, 14) + w(8, 2) + 4 * w(7, 13) <
                    w(13, 17) + w(13, 9) + w(11, 7) + w(7, 3) + 4 * w(12, 8)) selected[1] = w(12, 7) <= w(12, 13) ? 7 : 13;
                if (w(12, 6) + w(12, 18) + w(16, 10) + w(16, 22) + 4 * w(11, 17) <
                    w(11, 7) + w(11, 15) + w(13, 17) + w(17, 21) + 4 * w(12, 16)) selected[2] = w(12, 11) <= w(12, 17) ? 11 : 17;
                if (w(12, 8) + w(12, 16) + w(18, 14) + w(18, 22) + 4 * w(13, 17) <
                    w(11, 17) + w(17, 23) + w(17, 19) + w(7, 13) + 4 * w(12, 18)) selected[3] = w(12, 13) <= w(12, 17) ? 13 : 17;
            } else if (method === "eagle2x") {
                if (eq(0, 1) && eq(1, 3)) selected[0] = 0;
                if (eq(1, 2) && eq(2, 5)) selected[1] = 2;
                if (eq(3, 6) && eq(6, 7)) selected[2] = 6;
                if (eq(5, 8) && eq(8, 7)) selected[3] = 8;
            } else if (method === "eagle3x") {
                const topLeft = eq(0, 1) && eq(0, 3), topRight = eq(1, 2) && eq(2, 5);
                const bottomLeft = eq(3, 6) && eq(6, 7), bottomRight = eq(5, 7) && eq(7, 8);
                if (topLeft) selected[0] = 0;
                if (topRight) selected[2] = 1;
                if (bottomLeft) selected[6] = 3;
                if (bottomRight) selected[8] = 5;
                // Adjacent matching corners have identical pixels, so their native average is a copy.
                if (topLeft && topRight) selected[1] = 0;
                if (topLeft && bottomLeft) selected[3] = 0;
                if (topRight && bottomRight) selected[5] = 2;
                if (bottomLeft && bottomRight) selected[7] = 6;
            } else if (method === "epbx2x") {
                if (!eq(3, 5) && !eq(1, 7) && (
                    eq(4, 3) || eq(4, 7) || eq(4, 5) || eq(4, 1) ||
                    ((!eq(0, 8) || eq(4, 6) || eq(3, 2)) && (!eq(6, 2) || eq(4, 0) || eq(4, 8)))
                )) {
                    // Native averages equal neighbors; copying preserves the same Q16 samples.
                    if (eq(1, 3) && (eq(4, 0) || eq(4, 8) || eq(1, 2) || eq(3, 6))) selected[0] = 1;
                    if (eq(5, 1) && (eq(4, 2) || eq(4, 6) || eq(5, 8) || eq(1, 0))) selected[1] = 5;
                    if (eq(3, 7) && (eq(4, 6) || eq(4, 2) || eq(3, 0) || eq(7, 8))) selected[2] = 3;
                    if (eq(7, 5) && (eq(4, 8) || eq(4, 0) || eq(7, 6) || eq(5, 2))) selected[3] = 7;
                }
            } else if (!eq(1, 7) && !eq(3, 5)) {
                selected[0] = eq(3, 1) ? 3 : 4;
                selected[factor - 1] = eq(5, 1) ? 5 : 4;
                selected[factor * (factor - 1)] = eq(3, 7) ? 3 : 4;
                selected[factor * factor - 1] = eq(5, 7) ? 5 : 4;
                if (factor === 3) {
                    selected[1] = (eq(3, 1) && !eq(4, 2)) || (eq(5, 1) && !eq(4, 0)) ? 1 : 4;
                    selected[3] = (eq(3, 1) && !eq(4, 6)) || (eq(3, 7) && !eq(4, 0)) ? 3 : 4;
                    selected[5] = (eq(5, 1) && !eq(4, 8)) || (eq(5, 7) && !eq(4, 2)) ? 5 : 4;
                    selected[7] = (eq(3, 7) && !eq(4, 8)) || (eq(5, 7) && !eq(4, 6)) ? 7 : 4;
                }
            }
            for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) {
                const pixel = pixels[selected[dy * factor + dx]!]!, offset = (x * factor + dx) * 4;
                if (method === "xbr2x") {
                    // Native Mix2Pixels uses integer division, including the alpha channel.
                    for (let channel = 0; channel < 4; channel++) output[dy]![offset + channel] = Math.floor((pixel[channel]! + pixels[12]![channel]!) / 2);
                } else output[dy]!.set(pixel, offset);
            }
        }
        for (let dy = 0; dy < factor; dy++) {
            const position = ((y * factor + dy) * image.width * factor + left * factor) * 4;
            const samples = output[dy]!;
            const encoded = evaluate ? Uint16Array.from(samples, value => Math.max(0, Math.min(65535, Math.round(value)))) : samples;
            yield { kind: "write", highDepth: true, position, data: new Uint8Array(encoded.buffer) };
            if (evaluate) yield { kind: "write", evaluate: true, position, data: new Uint8Array(samples.map(value => value / 257).buffer) };
        }
    }
}
