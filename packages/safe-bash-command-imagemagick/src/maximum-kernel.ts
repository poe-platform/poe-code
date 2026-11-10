import type { RgbaColor } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { MorphologyRow } from "./morphology-kernel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";
import { virtualPixelIndex } from "./virtual-pixel.js";

/** Maximum over working samples, with bounded source pages and output spans. */
export function* maximumWorkingPixelSteps(image: { width: number; height: number }, rows: readonly MorphologyRow[], channels?: readonly boolean[], virtualPixel: VirtualPixelMethod = "edge", background?: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, ry = Math.floor(rows.length / 2);
    const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 127.5 : 0;
    const fill = (virtualPixel === "background" || virtualPixel.endsWith("-tile")) && background
        ? [background.r, background.g, background.b, background.a]
        : [gray, gray, gray, virtualPixel === "transparent" ? 0 : 255];
    const cache = new Map<number, Float64Array>();
    let work = 0;
    for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 1024) {
        yield;
        const count = Math.min(1024, width - left), position = (y * width + left) * 4;
        const original = yield { kind: "read", evaluate: true, position, length: count * 4 };
        if (!original || original.length !== count * 32) throw new Error("Truncated morphology pixels");
        const values = new Float64Array(original.slice().buffer);
        for (let local = 0; local < count; local++) {
            for (let c = 0; c < 4; c++) if (!channels || channels[c]) values[local * 4 + c] = -Infinity;
            for (let row = 0; row < rows.length; row++) {
                const offsets = rows[row]!;
                const before = typeof offsets === "number" ? Math.ceil(offsets) : 0;
                const count = typeof offsets === "number" ? offsets * 2 + 1 : offsets.length;
                for (let sample = 0; sample < count; sample++) {
                    if (++work % 4096 === 0) yield;
                    const column = left + local + (typeof offsets === "number" ? sample - before : offsets[sample]!);
                    const pixel = virtualPixelIndex(column, y + row - ry, width, height, virtualPixel);
                    let samples: Float64Array | number[] = fill;
                    let offset = 0;
                    if (pixel >= 0) {
                        const position = pixel * 4, page = Math.floor(position / 4096) * 4096;
                        let cached = cache.get(page);
                        if (!cached) {
                            const length = Math.min(4096, width * height * 4 - page);
                            const bytes = yield { kind: "read", evaluate: true, position: page, length };
                            if (!bytes || bytes.length !== length * 8) throw new Error("Truncated morphology pixels");
                            cached = new Float64Array(bytes.slice().buffer);
                            if (cache.size === 32) cache.delete(cache.keys().next().value!);
                            cache.set(page, cached);
                        }
                        samples = cached;
                        offset = position - page;
                    }
                    for (let c = 0; c < 4; c++) if (!channels || channels[c])
                        values[local * 4 + c] = Math.max(values[local * 4 + c]!, samples[offset + c]!);
                }
            }
        }
        const data = Uint16Array.from(values, value => Math.max(0, Math.min(65535, Math.round(value * 257))));
        yield { kind: "write", highDepth: true, position, data: new Uint8Array(data.buffer) };
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(values.buffer) };
    }
}
