import type { RgbaImage } from "@poe-code/image-ast";
import type { ConvolveRequest } from "./convolve-kernel.js";

/** Rotate palette colors using bounded chunks in either raster backend. */
export function* cyclePixelSteps(image: Pick<RgbaImage, "width" | "height" | "indexedColors" | "pngPalette">, amount: number): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    if (!Number.isSafeInteger(amount)) throw new Error("cycle requires an integer");
    const palette = image.indexedColors ? [...image.indexedColors] : [];
    const png = image.pngPalette?.bytes;
    if (!palette.length && png) for (let i = 0; i < png.length; i += 3) palette.push((image.pngPalette?.transparency?.[i / 3] ?? 255) * 16777216 + png[i]! * 65536 + png[i + 1]! * 256 + png[i + 2]!);
    if (!palette.length) throw new Error("cycle requires an indexed image");
    const indices = new Map(palette.map((color, index) => [color, index]));
    const shift = ((amount % palette.length) + palette.length) % palette.length;
    const length = image.width * image.height * 4;
    for (let position = 0; position < length; position += 4096) {
        yield;
        const size = Math.min(4096, length - position);
        const source = yield { kind: "read", position, length: size };
        if (!source || source.length !== size) throw new Error("Truncated cycle pixels");
        const data = source.slice();
        const original = yield { kind: "read", pngIndices: true, position: position / 4, length: size / 4 };
        const rotated = original?.length === size / 4 ? new Uint8Array(size / 4) : undefined;
        for (let i = 0; i < size; i += 4) {
            const pixel = data[i + 3]! * 16777216 + data[i]! * 65536 + data[i + 1]! * 256 + data[i + 2]!;
            const previous = rotated ? original![i / 4] : undefined;
            // Other raster operations may have changed the pixels since decoding.
            const index = previous !== undefined && palette[previous] === pixel ? previous : indices.get(pixel);
            if (index === undefined) throw new Error("cycle requires an indexed image");
            const target = (index + shift) % palette.length;
            if (rotated) rotated[i / 4] = target;
            const color = palette[target]!;
            data[i] = color >>> 16; data[i + 1] = color >>> 8; data[i + 2] = color; data[i + 3] = color >>> 24;
        }
        yield { kind: "write", position, data };
        if (rotated) yield { kind: "write", pngIndices: true, position: position / 4, data: rotated };
    }
}
