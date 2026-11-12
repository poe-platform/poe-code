import type { RgbaImage } from "@poe-code/image-ast";
import { quantizePixelSteps } from "./quantize.js";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { Region } from "./region.js";
import type { MaskChannels } from "./write-mask.js";

/** Fractional RGBA colormap samples, including colors absent from the raster. */
export interface CyclePalette { indexedColorSamples?: readonly (readonly number[])[] }

/** Rotate palette colors using bounded chunks in either raster backend. */
export function* cyclePixelSteps(image: Pick<RgbaImage, "width" | "height" | "indexedColors" | "pngPalette" | "depth" | "hasAlpha" | "isPalette" | "hueSamples"> & CyclePalette & { storedHueSamples?: number | undefined; inactiveAlpha?: boolean | undefined; alphaBlend?: boolean | undefined; region?: Region | undefined }, amount: number, channels?: MaskChannels, writeMask = false, dither: false | "riemersma" | "floydsteinberg" = "riemersma", diffusionAmount = 1): Generator<ConvolveRequest | undefined, void | number[], Uint8Array | undefined> {
    if (!Number.isSafeInteger(amount)) throw new Error("cycle requires an integer");
    const palette = image.isPalette !== false && image.indexedColors ? [...image.indexedColors] : [];
    const png = image.isPalette !== false ? image.pngPalette?.bytes : undefined;
    if (!palette.length && png) for (let i = 0; i < png.length; i += 3) palette.push((image.pngPalette?.transparency?.[i / 3] ?? 255) * 16777216 + png[i]! * 65536 + png[i + 1]! * 256 + png[i + 2]!);
    if (!palette.length) return yield* quantizePixelSteps(image.width * image.height * 4, 256, false, 5, image.hasAlpha || image.inactiveAlpha === true, true, { amount, width: image.width, region: image.region, writeMask, alphaActive: image.hasAlpha && image.alphaBlend !== false, channels }, dither ? { width: image.width, height: image.height, method: dither, diffusionAmount } : undefined);
    const indices = new Map(palette.map((color, index) => [color, index]));
    const shift = ((amount % palette.length) + palette.length) % palette.length;
    const length = image.width * image.height * 4;
    // Colorspace conversion reads this plane, so rotate its precise palette samples too.
    const huePalette = image.hueSamples || image.storedHueSamples !== undefined
        ? palette.map(color => Float64Array.of((color >>> 16 & 255) / 255, (color >>> 8 & 255) / 255, (color & 255) / 255, (color >>> 24) / 255)) : undefined;
    if (huePalette) for (let position = 0; position < length; position += 4096) {
        yield;
        const size = Math.min(4096, length - position);
        const bytes = (yield { kind: "read", hue: true, position, length: size })!;
        const hues = new Float64Array(bytes.slice().buffer);
        const original = (yield { kind: "read", pngIndices: true, position: position / 4, length: size / 4 })!;
        for (let i = 0; i < size; i += 4) {
            const color = Math.round(hues[i + 3]! * 255) * 16777216 + Math.round(hues[i]! * 255) * 65536 + Math.round(hues[i + 1]! * 255) * 256 + Math.round(hues[i + 2]! * 255);
            const index = indices.get(color) ?? original[i / 4];
            if (index !== undefined) huePalette[index]!.set(hues.subarray(i, i + 4));
        }
    }
    const highDepth = image.depth === "ushort";
    const samples = highDepth ? palette.map((color, index) => image.indexedColorSamples?.[index] ? Uint16Array.from(image.indexedColorSamples[index]!, value => Math.round(value * 257)) : Uint16Array.of(((color >>> 16) & 255) * 257, ((color >>> 8) & 255) * 257, (color & 255) * 257, (color >>> 24) * 257)) : [];
    if (highDepth && !image.indexedColorSamples) for (let position = 0; position < length; position += 4096) {
        yield;
        const size = Math.min(4096, length - position);
        const bytes = yield { kind: "read", highDepth, position, length: size };
        if (!bytes || bytes.length !== size * 2) throw new Error("Truncated cycle pixels");
        const data = new Uint16Array(bytes.slice().buffer);
        for (let i = 0; i < size; i += 4) {
            const color = Math.round(data[i + 3]! / 257) * 16777216 + Math.round(data[i]! / 257) * 65536 + Math.round(data[i + 1]! / 257) * 256 + Math.round(data[i + 2]! / 257);
            const index = indices.get(color);
            if (index !== undefined) samples[index]!.set(data.subarray(i, i + 4));
        }
    }
    const sampleIndices = highDepth && image.indexedColorSamples ? new Map(samples.map((color, index) => [color.join(","), index])) : undefined;
    for (let position = 0; position < length; position += 4096) {
        yield;
        const size = Math.min(4096, length - position);
        const source = yield { kind: "read", position, length: size };
        if (!source || source.length !== size) throw new Error("Truncated cycle pixels");
        const data = source.slice();
        const sourceBytes16 = sampleIndices ? yield { kind: "read", highDepth: true, position, length: size } : undefined;
        if (sampleIndices && sourceBytes16?.length !== size * 2) throw new Error("Truncated cycle pixels");
        const source16 = sourceBytes16 ? new Uint16Array(sourceBytes16.slice().buffer) : undefined;
        const evaluated = image.indexedColorSamples ? new Float64Array(size) : undefined;
        const hues = huePalette ? new Float64Array(size) : undefined;
        const data16 = highDepth ? new Uint16Array(size) : undefined;
        const original = yield { kind: "read", pngIndices: true, position: position / 4, length: size / 4 };
        const rotated = original?.length === size / 4 ? new Uint8Array(size / 4) : undefined;
        for (let i = 0; i < size; i += 4) {
            const pixel = data[i + 3]! * 16777216 + data[i]! * 65536 + data[i + 1]! * 256 + data[i + 2]!;
            const previous = rotated ? original![i / 4] : undefined;
            // Reordered pixels resolve by color; mask blending can leave only the retained index.
            const preciseIndex = source16 ? sampleIndices!.get(source16.subarray(i, i + 4).join(",")) : undefined;
            const index = previous !== undefined && palette[previous] === pixel ? previous : preciseIndex ?? indices.get(pixel) ?? previous;
            if (index === undefined) throw new Error("cycle requires an indexed image");
            const target = (index + shift) % palette.length;
            if (hues) hues.set(huePalette![target]!, i);
            if (rotated) rotated[i / 4] = target;
            if (data16) data16.set(samples[target]!, i);
            const color = palette[target]!;
            if (evaluated) {
                const samples = image.indexedColorSamples![target];
                // Other operators may have replaced or adjusted this palette entry.
                const packed = samples && Math.round(samples[3]!) * 16777216 + Math.round(samples[0]!) * 65536 + Math.round(samples[1]!) * 256 + Math.round(samples[2]!);
                evaluated.set(samples && packed === color ? samples : [color >>> 16 & 255, color >>> 8 & 255, color & 255, color >>> 24], i);
            }
            data[i] = color >>> 16; data[i + 1] = color >>> 8; data[i + 2] = color; data[i + 3] = color >>> 24;
        }
        yield { kind: "write", highDepth, position, data: data16 ? new Uint8Array(data16.buffer) : data };
        if (evaluated) yield { kind: "write", evaluate: true, position, data: new Uint8Array(evaluated.buffer) };
        if (hues) yield { kind: "write", hue: true, position, data: new Uint8Array(hues.buffer) };
        if (rotated) yield { kind: "write", pngIndices: true, position: position / 4, data: rotated };
    }
}
