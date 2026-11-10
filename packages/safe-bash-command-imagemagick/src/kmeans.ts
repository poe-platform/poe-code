import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { quantizePixelSteps } from "./quantize.js";

export function parseKmeansGeometry(raw: string): { colors: number; iterations: number; tolerance: number } {
    const offset = raw.indexOf("+"), dimensions = (offset < 0 ? raw : raw.slice(0, offset)).split("x");
    const colors = Number(dimensions[0]), iterations = dimensions[1] === undefined ? 300 : Number(dimensions[1]);
    const tolerance = offset < 0 ? 0.0001 : Number(raw.slice(offset + 1));
    if (dimensions.length > 2 || dimensions.some(part => !part.trim()) || !Number.isSafeInteger(colors) || colors < 1
        || !Number.isSafeInteger(iterations) || iterations < 1 || !Number.isFinite(tolerance) || tolerance < 0
        || (offset >= 0 && !raw.slice(offset + 1).trim())) throw new Error("Invalid kmeans geometry");
    if (colors > 65536 || iterations > 1000) throw new Error("Kmeans colors or iterations exceed limit");
    return { colors, iterations, tolerance };
}

/** Quantization seeds followed by Lloyd refinement, with bounded raster reads. */
export function* kmeansPixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "data16"> & Partial<Pick<StoredRgbaImage, "storedData16">>, options: ReturnType<typeof parseKmeansGeometry>): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const length = image.width * image.height * 4, highDepth = !!(image.data16 || image.storedData16), quantum = highDepth ? 65535 : 255;
    let depth = 1;
    for (let n = options.colors; n > 0; n = Math.floor(n / 4)) depth++;
    const seeds = quantizePixelSteps(length, options.colors, false, depth), colors = new Map<number, number[]>();
    let next = seeds.next();
    while (!next.done) {
        const request = next.value;
        if (request?.kind === "write") {
            if (request.evaluate) { next = seeds.next(); continue; }
            for (let i = 0; i < request.data.length; i += 4) {
                const data = request.data, key = data[i]! * 0x1000000 + data[i + 1]! * 0x10000 + data[i + 2]! * 256 + data[i + 3]!;
                if (!colors.has(key)) colors.set(key, Array.from(data.subarray(i, i + 4), value => value / 255));
            }
            next = seeds.next();
        } else next = seeds.next(yield request);
    }
    let palette = [...colors.values()], assignments = palette, previousDistortion = 0, work = 0;
    function* nearest(pixel: ArrayLike<number>, offset: number, centers: number[][]): Generator<undefined, { index: number; distance: number }> {
        let index = 0, distance = Infinity;
        for (let k = 0; k < centers.length; k++) {
            if (++work % 4096 === 0) yield;
            const center = centers[k]!, alpha = pixel[offset + 3]! / quantum;
            const weight = image.hasAlpha ? alpha * center[3]! : 1;
            // Native alpha distance uses Q16 units; RGB distances are normalized.
            let candidate = image.hasAlpha ? 3 * ((alpha - center[3]!) * 65535) ** 2 : 0;
            for (let c = 0; c < 3; c++) candidate += weight * (pixel[offset + c]! / quantum - center[c]!) ** 2;
            if (candidate < distance) { distance = candidate; index = k; }
            if (distance === 0) break;
        }
        return { index, distance };
    }
    for (let iteration = 0; iteration < options.iterations; iteration++) {
        const sums = palette.map(() => [0, 0, 0, 0]), counts = new Float64Array(palette.length);
        let distortion = 0;
        assignments = palette;
        for (let position = 0; position < length; position += 4096) {
            yield;
            const size = Math.min(4096, length - position), bytes = yield { kind: "read", highDepth, position, length: size };
            if (!bytes || bytes.length !== size * (highDepth ? 2 : 1)) throw new Error("Truncated kmeans pixels");
            const data = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
            for (let i = 0; i < size; i += 4) {
                const { index, distance } = yield* nearest(data, i, palette);
                counts[index]!++;
                for (let c = 0; c < 4; c++) sums[index]![c]! += data[i + c]! / quantum;
                distortion += distance;
            }
        }
        palette = sums.map((sum, index) => sum.map(value => value / (counts[index] || 1)));
        if (Math.abs(distortion - previousDistortion) <= options.tolerance) break;
        previousDistortion = distortion;
    }
    // Use the final iteration's assignments with its newly calculated means.
    for (let position = 0; position < length; position += 4096) {
        yield;
        const size = Math.min(4096, length - position), bytes = yield { kind: "read", highDepth, position, length: size };
        if (!bytes || bytes.length !== size * (highDepth ? 2 : 1)) throw new Error("Truncated kmeans pixels");
        const data = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes.slice();
        for (let i = 0; i < size; i += 4) {
            const { index } = yield* nearest(data, i, assignments);
            for (let c = 0; c < 4; c++) data[i + c] = Math.round(palette[index]![c]! * quantum);
        }
        yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
    }
}
