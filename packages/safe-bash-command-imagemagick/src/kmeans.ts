import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { createMagickRandom } from "./random.js";
import { quantizePixelSteps } from "./quantize.js";
import { regionContains, type Region } from "./region.js";

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
export function* kmeansPixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "data16" | "evaluateSamples" | "space" | "hueSamples"> & { region?: Region | undefined; alphaBlend?: boolean | undefined } & Partial<Pick<StoredRgbaImage, "storedData16" | "storedEvaluateSamples" | "storedHueSamples">>, options: ReturnType<typeof parseKmeansGeometry> & { seedColors?: RgbaColor[] | undefined; seed?: bigint | undefined }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const hue = image.space !== "cmyk" && (!!image.hueSamples || image.storedHueSamples !== undefined);
    const evaluate = !hue && (!!image.evaluateSamples || image.storedEvaluateSamples !== undefined);
    const cmyk = image.space === "cmyk", channels = cmyk ? 5 : 4;
    const length = image.width * image.height * 4, highDepth = cmyk || !!(image.data16 || image.storedData16), quantum = cmyk || hue ? 1 : !evaluate && highDepth ? 65535 : 255;
    function* readPixels(position: number, size: number): Generator<ConvolveRequest | undefined, Uint8Array | Uint16Array | Float64Array, Uint8Array | undefined> {
        const bytes = yield { kind: "read", hue, evaluate, highDepth, position, length: size };
        if (!bytes || bytes.length !== size * (hue || evaluate ? 8 : highDepth ? 2 : 1)) throw new Error("Truncated kmeans pixels");
        const data = hue || evaluate ? new Float64Array(bytes.slice().buffer) : highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
        if (!cmyk) return data;
        const inkBytes = yield { kind: "read", hue: true, position, length: size };
        if (!inkBytes || inkBytes.length !== size * 8) throw new Error("Truncated kmeans inks");
        const inks = new Float64Array(inkBytes.slice().buffer), pixels = new Float64Array(size / 4 * channels);
        for (let i = 0, j = 0; i < size; i += 4, j += channels) {
            pixels.set(inks.subarray(i, i + 3), j);
            pixels[j + 3] = image.hasAlpha ? data[i + 3]! / (evaluate ? 255 : 65535) : 1;
            pixels[j + 4] = inks[i + 3]!;
        }
        return pixels;
    }
    function* maskedPixels(position: number, size: number, passes: number): Generator<ConvolveRequest | undefined, Uint8Array | Uint16Array | Float64Array, Uint8Array | undefined> {
        const data = yield* readPixels(position, size);
        if (!image.region || !image.hasAlpha || image.alphaBlend === false || passes === 0) return data;
        const pixels = Float64Array.from(data);
        for (let i = 0; i < pixels.length; i += channels) {
            const pixel = position / 4 + i / channels;
            if (regionContains(image.region, pixel % image.width, Math.floor(pixel / image.width))) continue;
            const alpha = pixels[i + 3]! / quantum;
            if (alpha === 1) continue;
            // Index-only cache writes still composite protected translucent pixels.
            // Replay their float32 quantum rounding without retaining the whole raster.
            for (let pass = 0; pass < passes; pass++) {
                if (++work % 4096 === 0) yield;
                for (let c = 0; c < channels; c++) if (c !== 3) {
                    const value = pixels[i + c]! / quantum * 65535;
                    pixels[i + c] = Math.fround(value * alpha + value * alpha * (1 - alpha)) / 65535 * quantum;
                }
            }
        }
        return pixels;
    }
    let palette: number[][];
    if (options.seedColors) {
        palette = options.seedColors.slice(0, options.colors).map(color => [color.r / 255, color.g / 255, color.b / 255, color.a / 255, ...(cmyk ? [0] : [])]);
        const random = createMagickRandom(options.seed);
        while (palette.length < options.colors) palette.push([random(), random(), random(), image.hasAlpha ? random() : 1, ...(cmyk ? [random()] : [])]);
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
                    if (!colors.has(key)) colors.set(key, [...Array.from(data.subarray(i, i + 4), value => value / 255), ...(cmyk ? [0] : [])]);
                }
                next = seeds.next();
            } else if (cmyk && request?.kind === "read") {
                // Native quantization seeds on C/M/Y and alpha; black starts at zero.
                const data = new Uint8Array(request.length);
                for (let offset = 0; offset < request.length; offset += 2048) {
                    const size = Math.min(2048, request.length - offset), pixels = yield* readPixels(request.position + offset, size);
                    for (let i = 0, j = 0; i < size; i += 4, j += channels)
                        for (let c = 0; c < 4; c++) data[offset + i + c] = Math.round(pixels[j + c]! * 255);
                }
                next = seeds.next(data);
            } else next = seeds.next(yield request);
        }
        palette = [...colors.values()];
    }
    // Explicit opaque colors retain an undefined alpha trait in the native colormap.
    const alphaTraits = palette.map((_, index) => options.seedColors ? (options.seedColors[index]?.a ?? 255) < 255 : image.hasAlpha);
    let assignments = palette, previousDistortion = 0, work = 0, passes = 0;
    function* nearest(pixel: ArrayLike<number>, offset: number, centers: number[][]): Generator<undefined, { index: number; distance: number }> {
        let index = 0, distance = Infinity;
        for (let k = 0; k < centers.length; k++) {
            if (++work % 4096 === 0) yield;
            const center = centers[k]!, alpha = pixel[offset + 3]! / quantum;
            const centerAlpha = alphaTraits[k] ? center[3]! : 1;
            let weight = (image.hasAlpha ? alpha : 1) * centerAlpha;
            // Native alpha distance uses Q16 units; RGB distances are normalized.
            let candidate = (image.hasAlpha || alphaTraits[k]) ? 3 * ((alpha - centerAlpha) * 65535) ** 2 : 0;
            if (cmyk) {
                const black = pixel[offset + 4]!;
                candidate += 3 * weight * (black - center[4]!) ** 2;
                weight *= (1 - black) * (1 - center[4]!);
            }
            for (let c = 0; c < 3; c++) candidate += weight * (pixel[offset + c]! / quantum - center[c]!) ** 2;
            if (candidate < distance) { distance = candidate; index = k; }
            if (distance === 0) break;
        }
        return { index, distance };
    }
    for (let iteration = 0; iteration < options.iterations; iteration++) {
        const sums = palette.map(() => new Array<number>(channels).fill(0)), counts = new Float64Array(palette.length);
        let distortion = 0;
        assignments = palette;
        for (let position = 0; position < length; position += 2048) {
            yield;
            const size = Math.min(2048, length - position), data = yield* maskedPixels(position, size, passes);
            for (let i = 0; i < data.length; i += channels) {
                const { index, distance } = yield* nearest(data, i, palette);
                counts[index]!++;
                for (let c = 0; c < channels; c++) sums[index]![c]! += data[i + c]! / quantum;
                distortion += distance;
            }
        }
        passes++;
        palette = sums.map((sum, index) => sum.map(value => value / (counts[index] || 1)));
        if (Math.abs(distortion - previousDistortion) <= options.tolerance) break;
        previousDistortion = distortion;
    }
    // Use the final iteration's assignments with its newly calculated means.
    for (let position = 0; position < length; position += 2048) {
        yield;
        const size = Math.min(2048, length - position), data = yield* maskedPixels(position, size, passes - 1);
        const original = image.region ? yield* maskedPixels(position, size, passes) : undefined;
        const output = new Uint16Array(size), samples = hue || evaluate || cmyk || image.region ? new Float64Array(size) : undefined;
        const inks = cmyk ? new Float64Array(size) : undefined;
        for (let i = 0, j = 0; i < size; i += 4, j += channels) {
            const { index } = yield* nearest(data, j, assignments), center = image.region ? palette[index]!.slice() : palette[index]!;
            const pixel = (position + i) / 4;
            const protectedPixel = image.region && !regionContains(image.region, pixel % image.width, Math.floor(pixel / image.width));
            if (protectedPixel) {
                const alpha = image.hasAlpha && image.alphaBlend !== false ? original![j + 3]! / quantum : 1;
                const editedAlpha = image.hasAlpha && image.alphaBlend !== false && alphaTraits[index] ? Math.fround(center[3]! * 65535) / 65535 : 1;
                for (let c = 0; c < channels; c++) if (c !== 3)
                    center[c] = Math.fround((original![j + c]! / quantum * alpha + Math.fround(center[c]! * 65535) / 65535 * editedAlpha * (1 - alpha)) * 65535) / 65535;
                center[3] = original![j + 3]! / quantum;
            }
            if (inks) {
                for (let c = 0; c < 4; c++) inks[i + c] = Math.fround(center[c === 3 ? 4 : c]! * 65535) / 65535;
            }
            // Native Q16-HDRI palette samples are floats before integer export.
            for (let c = 0; c < 4; c++) {
                const value = c === 3 && !alphaTraits[index] && !protectedPixel ? 1 : inks && c < 3 ? (1 - inks[i + c]!) * (1 - inks[i + 3]!) : Math.fround(center[c]! * 65535) / 65535;
                output[i + c] = Math.max(0, Math.min(65535, Math.round(value * 65535)));
                if (samples) samples[i + c] = value * 255;
            }
        }
        if (inks) yield { kind: "write", hue: true, position, data: new Uint8Array(inks.buffer) };
        // Conversion back to sRGB consumes normalized working samples.
        if (hue) yield { kind: "write", hue: true, position, data: new Uint8Array(samples!.map(value => value / 255).buffer) };
        if (samples) yield { kind: "write", evaluate: true, position, data: new Uint8Array(samples.buffer) };
        // Keep fractional 8-bit means at Q16 precision until export.
        yield { kind: "write", highDepth: true, position, data: new Uint8Array(output.buffer) };
    }
}
