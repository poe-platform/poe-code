import type { RgbaImage } from "@poe-code/image-ast";
import { quantizePixelSteps } from "./quantize.js";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { Region } from "./region.js";
import type { MaskChannels } from "./write-mask.js";

/** Rotate palette colors using bounded chunks in either raster backend. */
export function* cyclePixelSteps(image: Pick<RgbaImage, "width" | "height" | "indexedColors" | "pngPalette" | "depth" | "hasAlpha" | "isPalette"> & { inactiveAlpha?: boolean | undefined; alphaBlend?: boolean | undefined; region?: Region | undefined }, amount: number, channels?: MaskChannels): Generator<ConvolveRequest | undefined, void | number[], Uint8Array | undefined> {
    if (!Number.isSafeInteger(amount)) throw new Error("cycle requires an integer");
    const palette = image.isPalette !== false && image.indexedColors ? [...image.indexedColors] : [];
    const png = image.isPalette !== false ? image.pngPalette?.bytes : undefined;
    if (!palette.length && png) for (let i = 0; i < png.length; i += 3) palette.push((image.pngPalette?.transparency?.[i / 3] ?? 255) * 16777216 + png[i]! * 65536 + png[i + 1]! * 256 + png[i + 2]!);
    if (!palette.length) return yield* quantizePixelSteps(image.width * image.height * 4, 256, false, 5, image.hasAlpha || image.inactiveAlpha === true, true, { amount, width: image.width, region: image.region, alphaActive: image.hasAlpha && image.alphaBlend !== false, channels });
    const indices = new Map(palette.map((color, index) => [color, index]));
    const shift = ((amount % palette.length) + palette.length) % palette.length;
    const length = image.width * image.height * 4;
    const highDepth = image.depth === "ushort";
    const samples = highDepth ? palette.map(color => Uint16Array.of(((color >>> 16) & 255) * 257, ((color >>> 8) & 255) * 257, (color & 255) * 257, (color >>> 24) * 257)) : [];
    if (highDepth) for (let position = 0; position < length; position += 4096) {
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
    for (let position = 0; position < length; position += 4096) {
        yield;
        const size = Math.min(4096, length - position);
        const source = yield { kind: "read", position, length: size };
        if (!source || source.length !== size) throw new Error("Truncated cycle pixels");
        const data = source.slice();
        const data16 = highDepth ? new Uint16Array(size) : undefined;
        const original = yield { kind: "read", pngIndices: true, position: position / 4, length: size / 4 };
        const rotated = original?.length === size / 4 ? new Uint8Array(size / 4) : undefined;
        for (let i = 0; i < size; i += 4) {
            const pixel = data[i + 3]! * 16777216 + data[i]! * 65536 + data[i + 1]! * 256 + data[i + 2]!;
            const previous = rotated ? original![i / 4] : undefined;
            // Reordered pixels resolve by color; mask blending can leave only the retained index.
            const index = previous !== undefined && palette[previous] === pixel ? previous : indices.get(pixel) ?? previous;
            if (index === undefined) throw new Error("cycle requires an indexed image");
            const target = (index + shift) % palette.length;
            if (rotated) rotated[i / 4] = target;
            if (data16) data16.set(samples[target]!, i);
            const color = palette[target]!;
            data[i] = color >>> 16; data[i + 1] = color >>> 8; data[i + 2] = color; data[i + 3] = color >>> 24;
        }
        yield { kind: "write", highDepth, position, data: data16 ? new Uint8Array(data16.buffer) : data };
        if (rotated) yield { kind: "write", pngIndices: true, position: position / 4, data: rotated };
    }
}
