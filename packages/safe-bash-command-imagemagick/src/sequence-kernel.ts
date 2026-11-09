import type { RgbaImage } from "@poe-code/image-ast";
import type { ConvolveRequest } from "./convolve-kernel.js";
type Steps = Generator<ConvolveRequest | undefined, void, Uint8Array | undefined>;
const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

export type LookupInterpolation = "bilinear" | "nearest" | "integer" | "average" | "mesh";

function* sampleLookup(lut: { width: number; height: number }, x: number, y: number, highDepth: boolean, interpolation: LookupInterpolation): Generator<ConvolveRequest, number[], Uint8Array | undefined> {
    if (interpolation === "mesh") throw new Error("Unsupported lookup interpolation: mesh");
    const nearest = interpolation === "nearest", single = nearest || interpolation === "integer";
    const left = Math.floor(x + (nearest ? 0.5 : 0)), top = Math.floor(y + (nearest ? 0.5 : 0));
    const dx = x - left, dy = y - top, values = [0, 0, 0, 0];
    for (let row = 0; row < (single ? 1 : 2); row++) for (let column = 0; column < (single ? 1 : 2); column++) {
        const weight = single ? 1 : interpolation === "average" ? 0.25 : (column ? dx : 1 - dx) * (row ? dy : 1 - dy);
        if (!weight) continue;
        const position = (Math.max(0, Math.min(lut.height - 1, top + row)) * lut.width + Math.max(0, Math.min(lut.width - 1, left + column))) * 4;
        const bytes = (yield { kind: "read", highDepth, image: 1, position, length: 4 })!;
        const pixel = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
        for (let channel = 0; channel < 3; channel++) values[channel]! += pixel[channel]! * weight * (single ? 1 : interpolation === "average" ? Number(pixel[3]! > 0) : pixel[3]!);
        values[3]! += pixel[3]! * weight;
    }
    if (interpolation === "bilinear") for (let channel = 0; channel < 3; channel++) values[channel] = values[3] === 0 ? 0 : values[channel]! / values[3]!;
    return values;
}

export function* clutPixelSteps(size: number, lut: { width: number; height: number }, mask: readonly boolean[], highDepth = false, interpolation: LookupInterpolation = "bilinear"): Steps {
    // Integer lookup partitions the full dimensions; other methods sample the diagonal endpoints.
    function* sample(value: number): Generator<ConvolveRequest, number[], Uint8Array | undefined> {
        const adjust = interpolation === "integer" ? 0 : 1;
        return (yield* sampleLookup(lut, value * (lut.width - adjust), value * (lut.height - adjust), highDepth, interpolation)).map(Math.round);
    }
    if (highDepth) {
        for (let position = 0; position < size; position += 4096) {
            yield;
            const bytes = (yield { kind: "read", highDepth, position, length: Math.min(4096, size - position) })!;
            const data = new Uint16Array(bytes.slice().buffer);
            for (let offset = 0; offset < data.length; offset++) {
                if (offset % 256 === 0) yield;
                const channel = offset % 4;
                if (mask[channel]) data[offset] = (yield* sample(data[offset]! / 65535))[channel]!;
            }
            yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
        }
        return;
    }
    const table = new Uint8Array(1024);
    for (let value = 0; value < 256; value++) {
        if (value % 64 === 0) yield;
        table.set(yield* sample(value / 255), value * 4);
    }
    for (let position = 0; position < size; position += 16384) {
        yield;
        const data = new Uint8Array((yield { kind: "read", position, length: Math.min(16384, size - position) })!);
        for (let offset = 0; offset < data.length; offset++) if (mask[offset % 4]) data[offset] = table[data[offset]! * 4 + offset % 4]!;
        yield { kind: "write", position, data };
    }
}

/** Hald pixels store red fastest, then green, then blue in a flattened RGB cube. */
export function* haldClutPixelSteps(size: number, lut: { width: number; height: number; space?: string }, mask: readonly boolean[], highDepth = false, interpolation: LookupInterpolation = "bilinear"): Steps {
    const range = highDepth ? 65535 : 255;
    const gray = lut.space === "b-w" || lut.space === "grey16";
    // Native rounds incomplete tables up to the next level, with a minimum of 2.
    const level = Math.max(2, Math.ceil(Math.cbrt(Math.min(lut.width, lut.height)))), edge = level * level;
    for (let position = 0; position < size; position += 16384) {
        yield;
        const bytes = (yield { kind: "read", highDepth, position, length: Math.min(16384, size - position) })!;
        const data = highDepth ? new Uint16Array(bytes.slice().buffer) : new Uint8Array(bytes);
        for (let offset = 0; offset < data.length; offset += 4) {
            if (offset % 256 === 0) yield;
            // Native adopts the lookup colorspace without a luminance conversion:
            // grayscale aliases all three input channels to the red sample.
            const red = data[offset]! / range * (edge - 1), green = gray ? red : data[offset + 1]! / range * (edge - 1), blue = gray ? red : data[offset + 2]! / range * (edge - 1);
            const g = Math.floor(green), b = Math.floor(blue), values = [0, 0, 0, 0];
            const dy = interpolation === "nearest" ? Math.round(green - g) : green - g;
            const dz = interpolation === "nearest" ? Math.round(blue - b) : blue - b;
            // Native Hald interpolates flattened 2D samples, then blends green and blue planes.
            for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) {
                const weight = (y ? dy : 1 - dy) * (z ? dz : 1 - dz);
                if (!weight) continue;
                const index = red + edge * (g + y + edge * (b + z));
                const sample = yield* sampleLookup(lut, index % lut.width, Math.floor(index / lut.width), highDepth, interpolation);
                for (let channel = 0; channel < 3; channel++) values[channel]! += sample[channel]! * sample[3]! * weight;
                values[3]! += sample[3]! * weight;
            }
            for (let channel = 0; channel < 3; channel++) values[channel] = values[3] === 0 ? 0 : values[channel]! / values[3]!;
            for (let channel = 0; channel < 4; channel++) if (mask[channel]) data[offset + channel] = Math.max(0, Math.min(range, Math.round(values[channel]! + Number.EPSILON * range)));
        }
        yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
    }
}

export function* interpolatePixelSteps(size: number, fraction: number, blendAlpha = true, channels?: readonly boolean[], highDepth = false): Steps {
    const range = highDepth ? 65535 : 255;
    for (let position = 0; position < size; position += 16384) {
        yield;
        const length = Math.min(16384, size - position);
        const bytes = (yield { kind: "read", highDepth, position, length })!;
        const otherBytes = (yield { kind: "read", highDepth, image: 1, position, length })!;
        const data = highDepth ? new Uint16Array(bytes.slice().buffer) : new Uint8Array(bytes);
        const other = highDepth ? new Uint16Array(otherBytes.slice().buffer) : otherBytes;
        for (let offset = 0; offset < length; offset++) {
            if (offset % 4 === 3 && !blendAlpha) continue;
            data[offset] = channels && !channels[offset % 4] ? other[offset]! : Math.max(0, Math.min(range, Math.round(data[offset]! * (1 - fraction) + other[offset]! * fraction)));
        }
        yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
    }
}

export function* combinePixelSteps(inputs: readonly Pick<RgbaImage, "width" | "height">[], highDepth = false): Steps {
    const { width, height } = inputs[0]!, chunkPixels = highDepth ? 2048 : 4096;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x += chunkPixels) {
        yield;
        const position = (y * width + x) * 4, length = Math.min(chunkPixels, width - x) * 4;
        const base = (yield { kind: "read", highDepth, image: 0, position, length })!;
        const data = highDepth ? new Uint16Array(base.slice().buffer) : new Uint8Array(base);
        if (inputs.length < 4) for (let offset = 3; offset < length; offset += 4) data[offset] = highDepth ? 65535 : 255;
        for (let image = 0; image < inputs.length; image++) {
            const sourceImage = inputs[image]!;
            if (y >= sourceImage.height || x >= sourceImage.width) continue;
            const count = Math.min(length, (sourceImage.width - x) * 4);
            const bytes = image === 0 ? base : (yield { kind: "read", highDepth, image, position: (y * sourceImage.width + x) * 4, length: count })!;
            const source = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
            for (let offset = 0; offset < count; offset += 4) data[offset + image] = Math.round(0.212656 * source[offset]! + 0.715158 * source[offset + 1]! + 0.072186 * source[offset + 2]!);
        }
        yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
    }
}

/** Median ranks RGBA sums, retaining stable input order for equal sums. */
export function* evaluateSequencePixelSteps(size: number, inputs: readonly Pick<RgbaImage, "hasAlpha" | "space" | "format" | "depth">[], raw: string, channels?: readonly boolean[], highDepth = false): Steps {
    const frames = inputs.length, hasAlpha = inputs.some(image => image.hasAlpha);
    const colorOutput = inputs.some(image => image.space !== "b-w" && image.space !== "grey16");
    function* read(image: number, position: number, length: number): Generator<ConvolveRequest, Uint8Array | Uint16Array, Uint8Array | undefined> {
        const input = (yield { kind: "read", highDepth, image, position, length })!;
        const bytes = highDepth ? new Uint16Array(input.slice().buffer) : input;
        const inputImage = inputs[image]!;
        const gray = colorOutput && (inputImage.space === "b-w" || inputImage.space === "grey16");
        // Native Mean visits the input's channel slots using the output channel map.
        // An opaque 8-bit gray PNG has a palette-index slot in addition to gray.
        const colorSlots = gray ? 1 + Number(inputImage.hasAlpha || (inputImage.format === "png" && inputImage.depth === "uchar")) : 3;
        if ((!hasAlpha || inputImage.hasAlpha) && (!gray || operation !== "mean")) return bytes;
        const data = bytes.slice();
        for (let offset = 0; offset < length; offset++) {
            const channel = offset % 4;
            if (channel === 3 ? hasAlpha && (!inputImage.hasAlpha || (gray && operation === "mean")) : operation === "mean" && channel >= colorSlots) data[offset] = 0;
        }
        return data;
    }
    const operation = raw.toLowerCase().split("-").join("").split("_").join("");
    highDepth &&= operation === "mean" || operation === "median";
    if (!["abs", "add", "addmodulus", "and", "cos", "cosine", "divide", "exp", "exponential",
        "gaussiannoise", "impulsenoise", "inverselog", "laplaciannoise", "leftshift", "log", "max", "mean",
        "median", "min", "multiplicativenoise", "multiply", "or", "poissonnoise", "pow", "rightshift",
        "rms", "rootmeansquare", "set", "sin", "sine", "subtract", "sum", "threshold", "thresholdblack",
        "thresholdwhite", "uniformnoise", "xor"].includes(operation)) {
        throw new Error(`unrecognized evaluate operator '-evaluate-sequence' '${raw}'`);
    }
    const median = operation === "median", window = median ? 512 : 4096;
    let work = 0;
    for (let position = 0; position < size; position += window) {
        if (position % 16384 === 0) yield;
        const length = Math.min(window, size - position), data = (yield* read(0, position, length)).slice();
        if (["and", "or", "xor"].includes(operation)) {
            for (let image = 1; image < frames; image++) {
                if (++work % 64 === 0) yield;
                const bytes = yield* read(image, position, length);
                for (let offset = 0; offset < length; offset++) {
                    if (operation === "and") data[offset] = data[offset]! & bytes[offset]!;
                    else if (operation === "or") data[offset] = data[offset]! | bytes[offset]!;
                    else data[offset] = data[offset]! ^ bytes[offset]!;
                }
            }
        } else if (operation === "leftshift" || operation === "rightshift") {
            const values = Float64Array.from(data, value => value * 257);
            for (let image = 1; image < frames; image++) {
                if (++work % 64 === 0) yield;
                const bytes = yield* read(image, position, length);
                for (let offset = 0; offset < length; offset++) {
                    // Native Q16 shifts the incoming sample by the accumulated quantum.
                    // The reference's signed 64-bit conversion skips overflowing counts.
                    const count = values[offset]! < 2 ** 63 ? Math.trunc(values[offset]!) : 0;
                    const sample = bytes[offset]! * 257;
                    values[offset] = sample === 0 ? 0 : sample * 2 ** (operation === "leftshift" ? count : -count);
                }
            }
            for (let offset = 0; offset < length; offset++) {
                if (offset % 4 !== 3 || hasAlpha) data[offset] = byte(values[offset]! / 257);
            }
        } else if (["threshold", "thresholdblack", "thresholdwhite"].includes(operation)) {
            for (let image = 1; image < frames; image++) {
                if (++work % 64 === 0) yield;
                const bytes = yield* read(image, position, length);
                for (let offset = 0; offset < length; offset++) {
                    if (offset % 4 === 3 && !hasAlpha) continue;
                    // Each incoming sample uses the accumulated result as its threshold.
                    const sample = bytes[offset]!, threshold = data[offset]!;
                    if (operation === "threshold") data[offset] = sample <= threshold ? 0 : 255;
                    else if (operation === "thresholdblack") data[offset] = sample <= threshold ? 0 : sample;
                    else data[offset] = sample > threshold ? 255 : sample;
                }
            }
        } else if (median) {
            const pixels = length / 4, histogram = new Float64Array(pixels * 32), ranks = new Float64Array(pixels), sums = new Uint32Array(pixels);
            ranks.fill(Math.floor(frames / 2));
            // Bounded radix passes cover 10-bit byte sums or 18-bit quantum sums.
            for (const shift of highDepth ? [15, 10, 5, 0] : [5, 0]) {
                histogram.fill(0);
                for (let image = 0; image < frames; image++) {
                    if (++work % 64 === 0) yield;
                    const bytes = yield* read(image, position, length);
                    for (let pixel = 0; pixel < pixels; pixel++) {
                        const offset = pixel * 4, sum = bytes[offset]! + bytes[offset + 1]! + bytes[offset + 2]! + bytes[offset + 3]!;
                        if ((sum >> (shift + 5)) === (sums[pixel]! >> (shift + 5))) histogram[pixel * 32 + ((sum >> shift) & 31)]!++;
                    }
                }
                for (let pixel = 0; pixel < pixels; pixel++) for (let bucket = 0; bucket < 32; bucket++) {
                    const count = histogram[pixel * 32 + bucket]!;
                    if (ranks[pixel]! < count) { sums[pixel] = sums[pixel]! | (bucket << shift); break; }
                    ranks[pixel]! -= count;
                }
            }
            for (let image = 0; image < frames; image++) {
                if (++work % 64 === 0) yield;
                const bytes = yield* read(image, position, length);
                for (let pixel = 0; pixel < pixels; pixel++) {
                    const offset = pixel * 4, sum = bytes[offset]! + bytes[offset + 1]! + bytes[offset + 2]! + bytes[offset + 3]!;
                    if (sum === sums[pixel]) { if (ranks[pixel] === 0) data.set(bytes.subarray(offset, offset + 4), offset); ranks[pixel]! -= 1; }
                }
            }
        } else if (["sin", "sine", "cos", "cosine"].includes(operation)) {
            const values = Float64Array.from(data, value => value * 257);
            const wave = operation === "sin" || operation === "sine" ? Math.sin : Math.cos;
            for (let image = 1; image < frames; image++) {
                if (++work % 64 === 0) yield;
                const bytes = yield* read(image, position, length);
                // Native uses the accumulated Q16 quantum as the incoming sample's frequency.
                for (let offset = 0; offset < length; offset++) values[offset] = 65535 * (0.5 + 0.5 * wave(2 * Math.PI * (1 / 65535) * (bytes[offset]! * 257) * values[offset]!));
            }
            for (let offset = 0; offset < length; offset++) {
                if (offset % 4 !== 3 || hasAlpha) data[offset] = byte(values[offset]! / 257);
            }
        } else if (operation === "exp" || operation === "exponential") {
            const values = Float64Array.from(data, value => value * 257);
            for (let image = 1; image < frames; image++) {
                if (++work % 64 === 0) yield;
                const bytes = yield* read(image, position, length);
                // Native Exp uses the accumulated Q16 quantum as the exponent factor.
                for (let offset = 0; offset < length; offset++) values[offset] = 65535 * Math.exp(values[offset]! * (bytes[offset]! / 255));
            }
            for (let offset = 0; offset < length; offset++) {
                if (offset % 4 !== 3 || hasAlpha) data[offset] = byte(values[offset]! / 257);
            }
        } else if (operation === "log" || operation === "inverselog") {
            const values = Float64Array.from(data, value => value * 257);
            for (let image = 1; image < frames; image++) {
                if (++work % 64 === 0) yield;
                const bytes = yield* read(image, position, length);
                // The accumulated Q16 quantum is the next sample's logarithm parameter.
                for (let offset = 0; offset < length; offset++) {
                    const value = values[offset]!, sample = bytes[offset]! / 255;
                    values[offset] = operation === "log"
                        ? value <= 1e-12 ? 0 : 65535 * Math.log(1 + value * sample) / Math.log(1 + value)
                        : 65535 * Math.pow(value + 1, sample - 1) / Math.max(value, 1e-12);
                }
            }
            for (let offset = 0; offset < length; offset++) {
                if (offset % 4 !== 3 || hasAlpha) data[offset] = byte(values[offset]! / 257);
            }
        } else if (operation === "rootmeansquare" || operation === "rms") {
            // Native Q16 seeds the accumulator with the first unsquared quantum.
            const values = Float64Array.from(data, value => value * 257);
            for (let image = 1; image < frames; image++) {
                if (++work % 64 === 0) yield;
                const bytes = yield* read(image, position, length);
                for (let offset = 0; offset < length; offset++) values[offset]! += (bytes[offset]! * 257) ** 2;
            }
            for (let offset = 0; offset < length; offset++) {
                if (offset % 4 !== 3 || hasAlpha) data[offset] = byte(Math.sqrt(values[offset]! / frames) / 257);
            }
        } else if (["mean", "min", "max", "add", "addmodulus", "sum", "abs", "subtract", "divide", "multiply", "pow"].includes(operation)) {
            const values = new Float64Array(length), multiplication = operation === "multiply", addition = ["mean", "add", "addmodulus", "sum", "abs"].includes(operation);
            const quantum = operation === "divide" || operation === "pow";
            const ordered = operation === "subtract" || quantum;
            if (multiplication) values.fill(1);
            else if (!addition) values.set(data);
            if (quantum) for (let offset = 0; offset < length; offset++) values[offset]! *= 257;
            for (let image = ordered ? 1 : 0; image < frames; image++) {
                if (++work % 64 === 0) yield;
                const bytes = yield* read(image, position, length);
                for (let offset = 0; offset < length; offset++) {
                    if (operation === "addmodulus") {
                        // Wrap at QuantumRange + 1 in native Q16 units, not at 256 bytes.
                        values[offset] = (values[offset]! + bytes[offset]! * 257) % 65536;
                    } else if (addition) values[offset]! += bytes[offset]!;
                    else if (multiplication) values[offset]! *= bytes[offset]! / 255;
                    // Native sequence evaluation applies each incoming sample to the accumulator.
                    else if (operation === "subtract") values[offset] = bytes[offset]! - values[offset]!;
                    else if (operation === "divide") values[offset] = bytes[offset]! * 257 / (values[offset]! || 1);
                    // Native Pow treats a near-zero quantum exponent as zero output.
                    else if (operation === "pow") values[offset] = values[offset]! <= 1e-12 ? 0 : 65535 * (bytes[offset]! / 255) ** values[offset]!;
                    else if (operation === "min") values[offset] = Math.min(values[offset]!, bytes[offset]!);
                    else values[offset] = Math.max(values[offset]!, bytes[offset]!);
                }
            }
            if (operation === "addmodulus") for (let offset = 0; offset < length; offset++) values[offset]! /= 257;
            const average = operation === "mean";
            for (let offset = 0; offset < length; offset++) {
                if (average && channels && !channels[offset % 4] && (offset % 4 !== 3 || hasAlpha)) data[offset] = 0;
                else if (highDepth && average && (offset % 4 !== 3 || hasAlpha)) data[offset] = Math.round(values[offset]! / frames);
                else if (offset % 4 !== 3 || hasAlpha) data[offset] = byte(average ? values[offset]! / frames : multiplication ? values[offset]! * 255 : quantum ? values[offset]! / 257 : values[offset]!);
            }
        }
        yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
    }
}
