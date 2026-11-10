import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { createMagickRandom } from "./random.js";
import { quantizePixelSteps } from "./quantize.js";

export function parseKmeansGeometry(raw: string): { colors: number; iterations: number; tolerance: number } {
    const value = raw.trim().replaceAll("%", "");
    const offset = [...value].findIndex((character, index) => character === "+" && value[index - 1]?.toLowerCase() !== "e");
    const dimensions = (offset < 0 ? value : value.slice(0, offset))
        .replaceAll("X", "x").replaceAll(",", "x").replaceAll("/", "x").replaceAll(":", "x").split("x");
    let colors = Number(dimensions[0]), iterations = dimensions[1]?.trim() ? Number(dimensions[1]) : 300;
    const toleranceText = offset < 0 ? "" : value.slice(offset + 1).trim();
    const tolerance = toleranceText ? Number(toleranceText) : 0.0001;
    // Native colon geometry is a ratio with unit iterations; percent does not scale tolerance.
    if (value.includes(":") && dimensions[1]?.trim()) {
        colors /= iterations;
        iterations = 1;
    }
    if (dimensions.length > 2 || !dimensions[0]?.trim() || !Number.isFinite(colors) || colors < 1
        || !Number.isFinite(iterations) || iterations < 0 || !Number.isFinite(tolerance) || tolerance < 0)
        throw new Error("Invalid kmeans geometry");
    if (colors > 65536 || iterations > 1000) throw new Error("Kmeans colors or iterations exceed limit");
    return { colors: Math.trunc(colors), iterations: Math.trunc(iterations), tolerance };
}

/** Quantization seeds followed by Lloyd refinement, with bounded raster reads. */
export function* kmeansPixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "data16" | "evaluateSamples"> & Partial<Pick<StoredRgbaImage, "storedData16" | "storedEvaluateSamples">>, options: ReturnType<typeof parseKmeansGeometry> & { seedColors?: RgbaColor[] | undefined; seed?: bigint | undefined }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const evaluate = !!image.evaluateSamples || image.storedEvaluateSamples !== undefined;
    const length = image.width * image.height * 4, highDepth = !!(image.data16 || image.storedData16), quantum = !evaluate && highDepth ? 65535 : 255;
    let palette: number[][];
    if (options.seedColors) {
        palette = options.seedColors.slice(0, options.colors).map(color => [color.r / 255, color.g / 255, color.b / 255, color.a / 255]);
        const random = createMagickRandom(options.seed);
        while (palette.length < options.colors) palette.push([random(), random(), random(), image.hasAlpha ? random() : 1]);
    } else {
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
        palette = [...colors.values()];
    }
    // Explicit opaque colors retain an undefined alpha trait in the native colormap.
    const alphaTraits = palette.map((_, index) => options.seedColors ? (options.seedColors[index]?.a ?? 255) < 255 : image.hasAlpha);
    let assignments = palette, previousDistortion = 0, work = 0;
    function* nearest(pixel: ArrayLike<number>, offset: number, centers: number[][]): Generator<undefined, { index: number; distance: number }> {
        let index = 0, distance = Infinity;
        for (let k = 0; k < centers.length; k++) {
            if (++work % 4096 === 0) yield;
            const center = centers[k]!, alpha = pixel[offset + 3]! / quantum;
            const centerAlpha = alphaTraits[k] ? center[3]! : 1;
            const weight = (image.hasAlpha ? alpha : 1) * centerAlpha;
            // Native alpha distance uses Q16 units; RGB distances are normalized.
            let candidate = (image.hasAlpha || alphaTraits[k]) ? 3 * ((alpha - centerAlpha) * 65535) ** 2 : 0;
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
        for (let position = 0; position < length; position += 2048) {
            yield;
            const size = Math.min(2048, length - position), bytes = yield { kind: "read", evaluate, highDepth, position, length: size };
            if (!bytes || bytes.length !== size * (evaluate ? 8 : highDepth ? 2 : 1)) throw new Error("Truncated kmeans pixels");
            const data = evaluate ? new Float64Array(bytes.slice().buffer) : highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
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
    for (let position = 0; position < length; position += 2048) {
        yield;
        const size = Math.min(2048, length - position), bytes = yield { kind: "read", evaluate, highDepth, position, length: size };
        if (!bytes || bytes.length !== size * (evaluate ? 8 : highDepth ? 2 : 1)) throw new Error("Truncated kmeans pixels");
        const data = evaluate ? new Float64Array(bytes.slice().buffer) : highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
        // Keep fractional 8-bit means at Q16 precision until export.
        const output = new Uint16Array(size), samples = evaluate ? new Float64Array(size) : undefined;
        for (let i = 0; i < size; i += 4) {
            const { index } = yield* nearest(data, i, assignments);
            for (let c = 0; c < 4; c++) {
                const value = c === 3 && !alphaTraits[index] ? 1 : palette[index]![c]!;
                output[i + c] = Math.max(0, Math.min(65535, Math.round(value * 65535)));
                if (samples) samples[i + c] = value * 255;
            }
        }
        yield { kind: "write", highDepth: true, position, data: new Uint8Array(output.buffer) };
        if (samples) yield { kind: "write", evaluate: true, position, data: new Uint8Array(samples.buffer) };
    }
}
