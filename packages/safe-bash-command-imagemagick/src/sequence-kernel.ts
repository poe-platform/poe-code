import type { RgbaColor, RgbaImage } from "@poe-code/image-ast";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { magickIntensity } from "./intensity.js";
import { rgbToCmyk } from "./colorspace-cmyk.js";
import { createMagickRandom } from "./random.js";
import { evaluateNoiseSteps } from "./noise.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";
type Steps = Generator<ConvolveRequest | undefined, void, Uint8Array | undefined>;

export type LookupInterpolation = "background" | "blend" | "bilinear" | "nearest" | "integer" | "average" | "average9" | "average16" | "mesh" | "catrom" | "spline";

function* sampleLookup(lut: { width: number; height: number }, x: number, y: number, highDepth: boolean, interpolation: LookupInterpolation, background: RgbaColor = { r: 255, g: 255, b: 255, a: 255 }, virtualPixel: VirtualPixelMethod = "edge", cmyk = false): Generator<ConvolveRequest, number[], Uint8Array | undefined> {
    if (interpolation === "background") return [background.r, background.g, background.b, background.a].map(value => value * (highDepth ? 257 : 1));
    const nearest = interpolation === "nearest", single = nearest || interpolation === "integer";
    const averageSize = interpolation === "average" ? 2 : interpolation === "average9" ? 3 : interpolation === "average16" ? 4 : 0;
    // Odd neighborhoods center on the nearest pixel; even ones straddle floor(x/y).
    const shift = averageSize > 2 ? 1 : 0, round = nearest || averageSize === 3 ? 0.5 : 0;
    const left = Math.floor(x + round) - shift, top = Math.floor(y + round) - shift;
    let dx = x - left, dy = y - top;
    const range = highDepth ? 65535 : 255;
    const values = cmyk ? [0, 0, 0, 0, 0] : [0, 0, 0, 0];
    // Blend selects the nearest edge neighbor and averages the middle half.
    if (interpolation === "blend") {
        dx = dx >= 0.75 ? 1 : dx > 0.25 ? 0.5 : 0;
        dy = dy >= 0.75 ? 1 : dy > 0.25 ? 0.5 : 0;
    }
    const meshPixels: (Uint8Array | Uint16Array)[] = [];
    let meshWeights: number[] | undefined;
    if (interpolation === "mesh") {
        for (let row = 0; row < 2; row++) for (let column = 0; column < 2; column++) {
            const position = (Math.max(0, Math.min(lut.height - 1, top + row)) * lut.width + Math.max(0, Math.min(lut.width - 1, left + column))) * 4;
            const bytes = (yield { kind: "read", highDepth, image: 1, position, length: 4 })!;
            meshPixels.push(highDepth ? new Uint16Array(bytes.slice().buffer) : bytes);
        }
        const luma = meshPixels.map(p => 0.212656 * p[0]! + 0.715158 * p[1]! + 0.072186 * p[2]!);
        // Split along the diagonal with the smaller luminance difference.
        meshWeights = Math.abs(luma[0]! - luma[3]!) < Math.abs(luma[1]! - luma[2]!)
            ? dx <= dy ? [1 - dy, 0, dy - dx, dx] : [1 - dx, dx - dy, 0, dy]
            : dx <= 1 - dy ? [1 - dx - dy, dx, dy, 0] : [0, 1 - dy, 1 - dx, dx + dy - 1];
    }
    const cubic = interpolation === "catrom" || interpolation === "spline";
    const weights = cubic ? [dx, dy].map(delta => {
        const alpha = 1 - delta;
        const first = interpolation === "catrom" ? -0.5 * delta * alpha * alpha : alpha ** 3 / 6;
        const last = interpolation === "catrom" ? -0.5 * delta * delta * alpha : delta ** 3 / 6;
        const beta = last - first;
        return [first, alpha - first + beta, delta - last - beta, last];
    }) : undefined;
    const size = cubic ? 4 : single ? 1 : averageSize || 2;
    for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
        const weight = meshWeights?.[row * 2 + column] ?? (weights ? weights[0]![column]! * weights[1]![row]! : single ? 1 : averageSize ? 1 / (size * size) : (column ? dx : 1 - dx) * (row ? dy : 1 - dy));
        if (!weight) continue;
        const position = virtualPixelIndex(left + column - (cubic ? 1 : 0), top + row - (cubic ? 1 : 0), lut.width, lut.height, virtualPixel) * 4;
        let pixel: ArrayLike<number> | undefined = meshPixels[row * 2 + column];
        if (!pixel && position < 0) {
            const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 128 : 0;
            const color = virtualPixel === "background" || virtualPixel.endsWith("-tile")
                ? [background.r, background.g, background.b, background.a]
                : [gray, gray, gray, virtualPixel === "transparent" ? 0 : 255];
            pixel = highDepth ? color.map(value => value * 257) : color;
        } else if (!pixel) {
            const bytes = (yield { kind: "read", highDepth, image: 1, position, length: 4 })!;
            pixel = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
        }
        // Native cubic interpolation retains premultiplied colors without dividing by alpha.
        if (cmyk) {
            const hue = position < 0 ? undefined : yield { kind: "read", hue: true, image: 1, position, length: 4 };
            const inks = hue?.length ? new Float64Array(hue.slice().buffer) : rgbToCmyk(pixel[0]! / range, pixel[1]! / range, pixel[2]! / range);
            pixel = [inks[0]! * range, inks[1]! * range, inks[2]! * range, pixel[3]!, inks[3]! * range];
        }
        for (let channel = 0; channel < values.length; channel++) if (channel !== 3) values[channel]! += pixel[channel]! * weight * (single ? 1 : averageSize ? Number(pixel[3]! > 0) : cubic ? pixel[3]! / (highDepth ? 65535 : 255) : pixel[3]!);
        values[3]! += pixel[3]! * weight;
    }
    if (interpolation === "bilinear" || interpolation === "blend" || interpolation === "mesh") for (let channel = 0; channel < values.length; channel++) if (channel !== 3) values[channel] = values[3] === 0 ? 0 : values[channel]! / values[3]!;
    return values;
}

export function* clutPixelSteps(size: number, lut: { width: number; height: number; space?: string }, mask: readonly boolean[], highDepth = false, interpolation: LookupInterpolation = "bilinear", background?: RgbaColor, virtualPixel?: VirtualPixelMethod, sourceCmyk = false): Steps {
    // Integer lookup partitions the full dimensions; other methods sample the diagonal endpoints.
    function* sample(value: number): Generator<ConvolveRequest, number[], Uint8Array | undefined> {
        const adjust = interpolation === "integer" ? 0 : 1;
        return yield* sampleLookup(lut, value * (lut.width - adjust), value * (lut.height - adjust), highDepth, interpolation, background, virtualPixel, lut.space === "cmyk");
    }
    const cmyk = sourceCmyk || lut.space === "cmyk", range = highDepth ? 65535 : 255;
    const table = highDepth || cmyk ? undefined : new Float64Array(1024);
    if (table) for (let value = 0; value < 256; value++) {
        if (value % 64 === 0) yield;
        table.set(yield* sample(value / 255), value * 4);
    }
    for (let position = 0; position < size; position += 2048) {
        yield;
        const bytes = (yield { kind: "read", highDepth, position, length: Math.min(2048, size - position) })!;
        const data = Float64Array.from(highDepth ? new Uint16Array(bytes.slice().buffer) : bytes);
        const hue = sourceCmyk ? yield { kind: "read", hue: true, position, length: data.length } : undefined;
        const inks = hue?.length ? new Float64Array(hue.slice().buffer) : sourceCmyk ? new Float64Array(data.length) : undefined;
        for (let offset = 0; offset < data.length; offset += 4) {
            if (offset % 256 === 0) yield;
            if (inks && !hue?.length) inks.set(rgbToCmyk(data[offset]! / range, data[offset + 1]! / range, data[offset + 2]! / range), offset);
            for (let channel = 0; channel < (sourceCmyk ? 5 : 4); channel++) {
                if (!mask[channel]) continue;
                // The working ink plane stores C/M/Y/K; alpha stays in the RGBA backing.
                const ink = inks && channel !== 3 ? offset + (channel === 4 ? 3 : channel) : undefined;
                const value = ink === undefined ? data[offset + channel]! / range : inks![ink]!;
                const index = cmyk ? Math.round(Math.max(0, Math.min(1, value)) * 65535) / 65535 : value;
                const mapped = table ? table[data[offset + channel]! * 4 + channel]! : (yield* sample(index))[channel] ?? 0;
                if (ink === undefined) data[offset + channel] = mapped;
                else inks![ink] = mapped / range;
            }
            if (inks) for (let channel = 0; channel < 3; channel++) data[offset + channel] = (1 - inks[offset + channel]!) * (1 - inks[offset + 3]!) * range;
        }
        if (inks) yield { kind: "write", hue: true, position, data: new Uint8Array(inks.buffer) };
        // Interpolation produces fractional Q16-HDRI samples even from byte inputs.
        const working = data.map(value => Math.fround(value * (highDepth ? 1 : 257)) / 257);
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(working.buffer) };
        const rounded = data.map(value => Math.max(0, Math.min(highDepth ? 65535 : 255, Math.round(value))));
        const pixels = highDepth ? Uint16Array.from(rounded) : Uint8Array.from(rounded);
        yield { kind: "write", highDepth, position, data: new Uint8Array(pixels.buffer) };
    }
}

/** Hald pixels store red fastest, then green, then blue in a flattened RGB cube. */
export function* haldClutPixelSteps(size: number, lut: { width: number; height: number; space?: string }, mask: readonly boolean[], highDepth = false, interpolation: LookupInterpolation = "bilinear", background?: RgbaColor, virtualPixel?: VirtualPixelMethod, sourceCmyk = false): Steps {
    const cmyk = lut.space === "cmyk";
    const range = highDepth ? 65535 : 255;
    const gray = lut.space === "b-w" || lut.space === "grey16";
    // Native rounds incomplete tables up to the next level, with a minimum of 2.
    const level = Math.max(2, Math.ceil(Math.cbrt(Math.min(lut.width, lut.height)))), edge = level * level;
    for (let position = 0; position < size; position += 2048) {
        yield;
        const bytes = (yield { kind: "read", highDepth, position, length: Math.min(2048, size - position) })!;
        const data = highDepth ? new Uint16Array(bytes.slice().buffer) : new Uint8Array(bytes);
        const working = Float64Array.from(data, value => highDepth ? value / 257 : value);
        const hue = sourceCmyk ? yield { kind: "read", hue: true, position, length: data.length } : undefined;
        const inks = hue?.length ? new Float64Array(hue.slice().buffer) : cmyk || sourceCmyk ? new Float64Array(data.length) : undefined;
        const samples = Float64Array.from(data);
        if (inks) for (let offset = 0; offset < data.length; offset += 4) {
            if (sourceCmyk && !hue?.length) inks.set(rgbToCmyk(data[offset]! / range, data[offset + 1]! / range, data[offset + 2]! / range), offset);
            for (let channel = 0; channel < 3; channel++) {
                if (sourceCmyk) samples[offset + channel] = inks[offset + channel]! * range;
                else inks[offset + channel] = samples[offset + channel]! / range;
            }
        }
        for (let offset = 0; offset < data.length; offset += 4) {
            if (offset % 256 === 0) yield;
            // Native adopts the lookup colorspace without a luminance conversion:
            // grayscale aliases all three input channels to the red sample.
            const red = samples[offset]! / range * (edge - 1), green = gray ? red : samples[offset + 1]! / range * (edge - 1), blue = gray ? red : samples[offset + 2]! / range * (edge - 1);
            const g = Math.floor(green), b = Math.floor(blue), values = cmyk ? [0, 0, 0, 0, 0] : [0, 0, 0, 0];
            const dy = interpolation === "nearest" ? Math.round(green - g) : green - g;
            const dz = interpolation === "nearest" ? Math.round(blue - b) : blue - b;
            // Native Hald interpolates flattened 2D samples, then blends green and blue planes.
            for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) {
                const weight = (y ? dy : 1 - dy) * (z ? dz : 1 - dz);
                if (!weight) continue;
                const index = red + edge * (g + y + edge * (b + z));
                const sample = yield* sampleLookup(lut, index % lut.width, Math.floor(index / lut.width), highDepth, interpolation, background, virtualPixel, cmyk);
                for (let channel = 0; channel < values.length; channel++) if (channel !== 3) values[channel]! += sample[channel]! * sample[3]! * weight;
                values[3]! += sample[3]! * weight;
            }
            for (let channel = 0; channel < values.length; channel++) if (channel !== 3) values[channel] = values[3] === 0 ? 0 : values[channel]! / values[3]!;
            for (let channel = 0; channel < 4; channel++) if (mask[channel]) samples[offset + channel] = values[channel]!;
            if (cmyk) {
                for (let channel = 0; channel < 3; channel++) inks![offset + channel] = samples[offset + channel]! / range;
                if (mask[4]) inks![offset + 3] = values[4]! / range;
                for (let channel = 0; channel < 3; channel++) samples[offset + channel] = (1 - inks![offset + channel]!) * (1 - inks![offset + 3]!) * range;
            }
            for (let channel = 0; channel < 4; channel++) {
                working[offset + channel] = Math.fround(samples[offset + channel]! * (highDepth ? 1 : 257)) / 257;
                data[offset + channel] = Math.max(0, Math.min(range, Math.round(samples[offset + channel]! + Number.EPSILON * range)));
            }
        }
        if (cmyk) yield { kind: "write", hue: true, position, data: new Uint8Array(inks!.buffer) };
        // Byte inputs still produce fractional Q16-HDRI lookup results.
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(working.buffer) };
        yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
    }
}

export function* interpolatePixelSteps(size: number, fraction: number, blendAlpha = true, channels?: readonly boolean[], highDepth = false, gray = false): Steps {
    const range = highDepth ? 65535 : 255;
    for (let position = 0; position < size; position += 16384) {
        yield;
        const length = Math.min(16384, size - position);
        const hue = yield { kind: "read", hue: true, position, length };
        const otherHue = yield { kind: "read", hue: true, image: 1, position, length };
        const bytes = hue?.length ? hue : (yield { kind: "read", highDepth, position, length })!;
        const otherBytes = otherHue?.length ? otherHue : (yield { kind: "read", highDepth, image: 1, position, length })!;
        const data = hue?.length ? new Float64Array(bytes.slice().buffer).map(value => value * range)
            : Float64Array.from(highDepth ? new Uint16Array(bytes.slice().buffer) : bytes);
        const other = otherHue?.length ? new Float64Array(otherBytes.slice().buffer).map(value => value * range)
            : highDepth ? new Uint16Array(otherBytes.slice().buffer) : otherBytes;
        for (let offset = 0; offset < length; offset++) {
            if (offset % 4 === 3 && !blendAlpha) continue;
            if (gray && (offset % 4 === 1 || offset % 4 === 2)) {
                data[offset] = data[offset - offset % 4]!;
                continue;
            }
            data[offset] = channels && !channels[offset % 4] ? other[offset]! : data[offset]! * (1 - fraction) + other[offset]! * fraction;
        }
        // Morphing byte inputs still produces fractional Q16-HDRI samples.
        const working = data.map(value => Math.fround(value * (highDepth ? 1 : 257)) / 257);
        // Conversion back to sRGB must use the blended working colorspace samples.
        if (hue?.length) yield { kind: "write", hue: true, position, data: new Uint8Array(working.map(value => value / 255).buffer) };
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(working.buffer) };
        const rounded = data.map(value => Math.max(0, Math.min(range, Math.round(value))));
        const pixels = highDepth ? Uint16Array.from(rounded) : Uint8Array.from(rounded);
        yield { kind: "write", highDepth, position, data: new Uint8Array(pixels.buffer) };
    }
}

export type ChannelAssignment = { target: number } & ({ image: number; source: number } | { value: number });

export function* channelFxPixelSteps(inputs: readonly Pick<RgbaImage, "width" | "height" | "hasAlpha">[], assignments: readonly ChannelAssignment[], highDepth: boolean): Steps {
    const { width, height } = inputs[0]!;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x += 2048) {
        yield;
        const position = (y * width + x) * 4, length = Math.min(2048, width - x) * 4;
        const working = yield { kind: "read", evaluate: true, position, length };
        const base = working?.length ? new Float64Array(working.slice().buffer)
            : Float64Array.from(highDepth ? new Uint16Array((yield { kind: "read", highDepth, position, length })!.slice().buffer)
                : (yield { kind: "read", position, length })!, value => highDepth ? value / 257 : value);
        const data = base.slice();
        for (const assignment of assignments) {
            if ("value" in assignment) {
                for (let offset = assignment.target; offset < length; offset += 4) data[offset] = assignment.value;
                continue;
            }
            const image = Math.min(assignment.image, inputs.length - 1), input = inputs[image]!;
            if (y >= input.height || x >= input.width) continue;
            const count = Math.min(length, (input.width - x) * 4);
            let samples = base;
            if (image !== 0) {
                const position = (y * input.width + x) * 4;
                const working = yield { kind: "read", evaluate: true, image, position, length: count };
                const bytes = working?.length ? working : (yield { kind: "read", highDepth, image, position, length: count })!;
                samples = working?.length ? new Float64Array(bytes.slice().buffer)
                    : Float64Array.from(highDepth ? new Uint16Array(bytes.slice().buffer) : bytes, value => highDepth ? value / 257 : value);
            }
            for (let offset = 0; offset < count; offset += 4)
                data[offset + assignment.target] = assignment.source === 3 && !input.hasAlpha ? 255 : samples[offset + assignment.source]!;
        }
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(data.buffer) };
        const bounded = highDepth ? Uint16Array.from(data, value => Math.round(Math.max(0, Math.min(65535, value * 257))))
            : Uint8Array.from(data, value => Math.round(Math.max(0, Math.min(255, value))));
        yield { kind: "write", highDepth, position, data: new Uint8Array(bounded.buffer) };
    }
}

export function* combinePixelSteps(inputs: readonly (Pick<RgbaImage, "width" | "height"> & { space?: RgbaImage["space"] | undefined; magickColorspace?: string | undefined })[], highDepth = false, intensity = "rec709luma", gray = false): Steps {
    const { width, height } = inputs[0]!, chunkPixels = 512;
    // The storage planes are RGBA plus CMYK inks; reduce C, M, Y, alpha and K together.
    const cmyk = inputs[0]!.space === "cmyk", range = highDepth ? 65535 : 255;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x += chunkPixels) {
        yield;
        const position = (y * width + x) * 4, length = Math.min(chunkPixels, width - x) * 4;
        const base = (yield { kind: "read", highDepth, image: 0, position, length })!;
        const data = highDepth ? new Uint16Array(base.slice().buffer) : new Uint8Array(base);
        const samples = Float64Array.from(data, value => highDepth ? value / 257 : value);
        const baseHue = cmyk ? yield { kind: "read", hue: true, position, length } : undefined;
        const inks = baseHue?.length ? new Float64Array(baseHue.slice().buffer) : cmyk ? new Float64Array(length) : undefined;
        if (inks && !baseHue?.length) for (let offset = 0; offset < length; offset += 4)
            inks.set(rgbToCmyk(data[offset]! / range, data[offset + 1]! / range, data[offset + 2]! / range), offset);
        for (let image = 0; image < inputs.length; image++) {
            const sourceImage = inputs[image]!;
            if (y >= sourceImage.height || x >= sourceImage.width) continue;
            const count = Math.min(length, (sourceImage.width - x) * 4);
            const bytes = image === 0 ? base : (yield { kind: "read", highDepth, image, position: (y * sourceImage.width + x) * 4, length: count })!;
            const source = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
            const hue = cmyk && sourceImage.space === "cmyk" ? image === 0 ? baseHue
                : yield { kind: "read", hue: true, image, position: (y * sourceImage.width + x) * 4, length: count } : undefined;
            const inkSamples = hue?.length ? new Float64Array(hue.slice().buffer) : undefined;
            for (let offset = 0; offset < count; offset += 4) {
                if (inks) {
                    const channels = inkSamples ? inkSamples.subarray(offset, offset + 3) : sourceImage.space === "cmyk"
                        ? rgbToCmyk(source[offset]! / range, source[offset + 1]! / range, source[offset + 2]! / range)
                        : [source[offset]! / range, source[offset + 1]! / range, source[offset + 2]! / range];
                    inks[offset + image] = magickIntensity(channels[0]!, channels[1]!, channels[2]!, intensity, 1, sourceImage.magickColorspace === "RGB");
                    continue;
                }
                const value = magickIntensity(source[offset]!, source[offset + 1]!, source[offset + 2]!, intensity, highDepth ? 65535 : 255, sourceImage.magickColorspace === "RGB");
                const channel = gray && image === 1 ? 3 : image;
                samples[offset + channel] = highDepth ? value / 257 : value;
                data[offset + channel] = Math.round(value);
                if (gray && image === 0) {
                    samples[offset + 1] = samples[offset + 2] = samples[offset]!;
                    data[offset + 1] = data[offset + 2] = data[offset]!;
                }
            }
        }
        if (inks) {
            // Keep the CMYK working plane and RGB backing in agreement; alpha is independent of black.
            for (let offset = 0; offset < length; offset += 4) for (let channel = 0; channel < 3; channel++) {
                const value = (1 - inks[offset + channel]!) * (1 - inks[offset + 3]!);
                samples[offset + channel] = value * 255;
                data[offset + channel] = Math.round(value * range);
            }
            yield { kind: "write", hue: true, position, data: new Uint8Array(inks.buffer) };
        }
        // Retain fractional intensities for later high-depth output.
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(samples.buffer) };
        yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
    }
}

/** Median ranks selected channel sums, retaining stable input order for equal sums. */
export function* evaluateSequencePixelSteps(size: number, inputs: readonly (Pick<RgbaImage, "hasAlpha" | "space" | "format" | "depth" | "isPalette"> & { magickColorspace?: string })[], raw: string, channels?: readonly boolean[], highDepth = false, seed = 0n, width = size / 4): Steps {
    const cmyk = inputs[0]!.space === "cmyk", stride = cmyk ? 5 : 4;
    size = size / 4 * stride;
    const frames = inputs.length, hasAlpha = inputs.some(image => image.hasAlpha);
    const hue = !!inputs[0]?.magickColorspace && inputs[0].magickColorspace !== "RGB" && inputs[0].space !== "cmyk";
    const colorOutput = inputs.some(image => image.space !== "b-w" && image.space !== "grey16");
    const operation = raw.toLowerCase().split("-").join("").split("_").join("");
    const fractional = cmyk || ["cos", "cosine", "divide", "log", "mean", "multiply", "rms", "rootmeansquare", "sin", "sine"].includes(operation);
    const retainRange = ["add", "addmodulus", "sum", "subtract", "min", "max"].includes(operation);
    function* read(image: number, position: number, length: number, retainWorking = retainRange || fractional): Generator<ConvolveRequest, Uint8Array | Uint16Array | Float64Array, Uint8Array | undefined> {
        const storagePosition = position / stride * 4, storageLength = length / stride * 4;
        const working = retainWorking ? yield { kind: "read", evaluate: true, image, position: storagePosition, length: storageLength } : undefined;
        const input = working?.length ? working : (yield { kind: "read", highDepth, image, position: storagePosition, length: storageLength })!;
        let bytes: Uint8Array | Uint16Array | Float64Array = working?.length ? Float64Array.from(new Float64Array(input.slice().buffer), value => highDepth ? value * 257 : value)
            : highDepth ? new Uint16Array(input.slice().buffer) : input;
        const inputImage = inputs[image]!;
        if (cmyk) {
            const hue = inputs[image]!.space === "cmyk" ? yield { kind: "read", hue: true, image, position: storagePosition, length: storageLength } : undefined;
            const inks = hue?.length ? new Float64Array(hue.slice().buffer) : undefined;
            const samples = new Float64Array(length);
            for (let offset = 0; offset < length; offset += stride) {
                const source = offset / stride * 4;
                const ink = inks?.subarray(source, source + 4) ?? rgbToCmyk(bytes[source]! / range, bytes[source + 1]! / range, bytes[source + 2]! / range);
                for (let channel = 0; channel < 3; channel++) samples[offset + channel] = ink[channel]! * range;
                samples[offset + 3] = bytes[source + 3]!;
                samples[offset + 4] = ink[3]! * range;
            }
            bytes = samples;
        }
        const gray = colorOutput && (inputImage.space === "b-w" || inputImage.space === "grey16");
        // Native Mean visits the input's channel slots using the output channel map.
        // An opaque 8-bit gray PNG has a palette-index slot in addition to gray.
        const colorSlots = cmyk ? stride : gray ? 1 + Number(inputImage.hasAlpha || (inputImage.format === "png" && inputImage.depth === "uchar")) : 3;
        const maskedMedian = operation === "median" && channels?.some(selected => !selected);
        if ((!hasAlpha || inputImage.hasAlpha) && (!gray || operation !== "mean") && !maskedMedian) return bytes;
        const data = bytes.slice();
        for (let offset = 0; offset < length; offset++) {
            const channel = offset % stride;
            // Mask candidates before ranking so unused samples cannot choose the median.
            if (maskedMedian && !channels![channel] && (channel !== 3 || hasAlpha)) data[offset] = 0;
            if (channel === 3 ? hasAlpha && (!inputImage.hasAlpha || (gray && operation === "mean")) : operation === "mean" && channel >= colorSlots) data[offset] = 0;
        }
        return data;
    }
    const noise = operation.endsWith("noise");
    const range = highDepth ? 65535 : 255, scale = highDepth ? 1 : 257;
    const clamp = (value: number) => Math.max(0, Math.min(range, Math.round(value)));
    if (!["abs", "add", "addmodulus", "and", "cos", "cosine", "divide", "exp", "exponential",
        "gaussiannoise", "impulsenoise", "inverselog", "laplaciannoise", "leftshift", "log", "max", "mean",
        "median", "min", "multiplicativenoise", "multiply", "or", "poissonnoise", "pow", "rightshift",
        "rms", "rootmeansquare", "set", "sin", "sine", "subtract", "sum", "threshold", "thresholdblack",
        "thresholdwhite", "undefined", "uniformnoise", "xor"].includes(operation)) {
        throw new Error(`unrecognized evaluate operator '-evaluate-sequence' '${raw}'`);
    }
    function* write(position: number, values: Uint8Array | Uint16Array | Float64Array, evaluate = false): Steps {
        if (!cmyk) {
            yield { kind: "write", highDepth: !evaluate && highDepth, evaluate, position, data: new Uint8Array(values.buffer) };
            if (hue && (evaluate || !retainRange)) yield { kind: "write", hue: true, position, data: new Uint8Array(Float64Array.from(values, value => value / (evaluate ? 255 : range)).buffer) };
            return;
        }
        const inks = new Float64Array(values.length / stride * 4), rgba = new Float64Array(inks.length);
        const quantum = evaluate ? 255 : range;
        for (let offset = 0; offset < values.length; offset += stride) {
            const target = offset / stride * 4;
            for (let channel = 0; channel < 4; channel++) inks[target + channel] = values[offset + (channel === 3 ? 4 : channel)]! / quantum;
            for (let channel = 0; channel < 3; channel++) rgba[target + channel] = (1 - inks[target + channel]!) * (1 - inks[target + 3]!) * 255;
            rgba[target + 3] = values[offset + 3]! / quantum * 255;
        }
        const encoded = highDepth ? Uint16Array.from(rgba, value => clamp(value * 257)) : Uint8Array.from(rgba, clamp);
        const target = position / stride * 4;
        yield { kind: "write", hue: true, position: target, data: new Uint8Array(inks.buffer) };
        yield { kind: "write", evaluate: true, position: target, data: new Uint8Array(rgba.buffer) };
        yield { kind: "write", highDepth, position: target, data: new Uint8Array(encoded.buffer) };
    }
    if (noise) {
        const random = createMagickRandom(seed);
        const outputChannels = cmyk ? [0, 1, 2, 4] : colorOutput ? [0, 1, 2] : [0];
        if (hasAlpha) outputChannels.push(3);
        // Native visits input slots through the output channel map. Unmapped
        // palette slots alias red and still consume randomness.
        const inputSlots = inputs.map(image => {
            const gray = image.space === "b-w" || image.space === "grey16";
            const indexed = image.isPalette || gray && !image.hasAlpha && image.format === "png" && image.depth === "uchar";
            return (gray ? 1 : image.space === "cmyk" ? 4 : 3) + Number(image.hasAlpha) + Number(!!indexed);
        });
        const slots = inputSlots.reduce((count, value) => Math.max(count, value), outputChannels.length);
        // Native consumes randomness row first, then frame, pixel and channel.
        // Keep one HDRI accumulator row; transfer pixels in bounded spans.
        const values = new Float64Array(width * slots);
        for (let row = 0; row < size; row += width * stride) {
            values.fill(0);
            for (let image = 0; image < frames; image++) {
                for (let left = 0; left < width; left += 1024) {
                    yield;
                    const count = Math.min(1024, width - left);
                    const samples = yield* read(image, row + left * stride, count * stride);
                    for (let pixel = 0; pixel < count; pixel++) {
                        if (pixel % 64 === 0) yield;
                        for (let slot = 0; slot < inputSlots[image]!; slot++) {
                            const channel = outputChannels[slot] ?? 0;
                            if (channels && !channels[channel] || channel === 3 && !inputs[image]!.hasAlpha) continue;
                            const sample = samples[pixel * stride + channel]! * scale / 257;
                            const offset = (left + pixel) * slots + slot;
                            values[offset] = image === 0 ? sample
                                : yield* evaluateNoiseSteps(sample, operation, values[offset]! * 257, random);
                        }
                    }
                }
            }
            for (let left = 0; left < width; left += 1024) {
                yield;
                const count = Math.min(1024, width - left);
                const data = highDepth ? new Uint16Array(count * stride) : new Uint8Array(count * stride);
                for (let pixel = 0; pixel < count; pixel++) for (let channel = 0; channel < stride; channel++) {
                    const slot = cmyk ? channel === 3 ? 4 : channel === 4 ? 3 : channel : colorOutput ? channel : channel === 3 ? 1 : 0;
                    data[pixel * stride + channel] = channel === 3 && !hasAlpha ? range
                        : Math.max(0, Math.min(range, Math.round(values[(left + pixel) * slots + slot]! * (highDepth ? 257 : 1))));
                }
                yield* write(row + left * stride, data);
            }
        }
        return;
    }
    const median = operation === "median", window = (median ? 128 : fractional || retainRange ? 512 : 1024) * stride;
    let work = 0;
    for (let position = 0; position < size; position += window) {
        if (position % 16384 === 0) yield;
        const length = Math.min(window, size - position), first = yield* read(0, position, length);
        const data = fractional || median ? Float64Array.from(first) : highDepth ? Uint16Array.from(first, clamp) : Uint8Array.from(first, clamp);
        if (operation === "undefined" && frames > 1) {
            // Native Undefined clears active samples after the first input.
            for (let offset = 0; offset < length; offset++) {
                if (offset % stride !== 3 || hasAlpha) data[offset] = 0;
            }
        } else if (["and", "or", "xor"].includes(operation)) {
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
            const values = Float64Array.from(data, value => value * scale);
            for (let image = 1; image < frames; image++) {
                if (++work % 64 === 0) yield;
                const bytes = yield* read(image, position, length);
                for (let offset = 0; offset < length; offset++) {
                    // Native Q16 shifts the incoming sample by the accumulated quantum.
                    // The reference's signed 64-bit conversion skips overflowing counts.
                    const count = values[offset]! < 2 ** 63 ? Math.trunc(values[offset]!) : 0;
                    const sample = bytes[offset]! * scale;
                    values[offset] = sample === 0 ? 0 : sample * 2 ** (operation === "leftshift" ? count : -count);
                }
            }
            for (let offset = 0; offset < length; offset++) {
                if (offset % stride !== 3 || hasAlpha) data[offset] = clamp(values[offset]! / scale);
            }
        } else if (["threshold", "thresholdblack", "thresholdwhite"].includes(operation)) {
            for (let image = 1; image < frames; image++) {
                if (++work % 64 === 0) yield;
                const bytes = yield* read(image, position, length);
                for (let offset = 0; offset < length; offset++) {
                    if (offset % stride === 3 && !hasAlpha) continue;
                    // Each incoming sample uses the accumulated result as its threshold.
                    const sample = bytes[offset]!, threshold = data[offset]!;
                    if (operation === "threshold") data[offset] = sample <= threshold ? 0 : range;
                    else if (operation === "thresholdblack") data[offset] = sample <= threshold ? 0 : sample;
                    else data[offset] = sample > threshold ? range : sample;
                }
            }
        } else if (median) {
            const pixels = length / stride, histogram = new Float64Array(pixels * 32), ranks = new Float64Array(pixels), sums = new Uint32Array(pixels);
            ranks.fill(Math.floor(frames / 2));
            // Bounded radix passes cover 10-bit byte sums or 18-bit quantum sums.
            for (const shift of highDepth ? [15, 10, 5, 0] : cmyk ? [10, 5, 0] : [5, 0]) {
                histogram.fill(0);
                for (let image = 0; image < frames; image++) {
                    if (++work % 64 === 0) yield;
                    const bytes = yield* read(image, position, length);
                    for (let pixel = 0; pixel < pixels; pixel++) {
                        const offset = pixel * stride, sum = Math.trunc(bytes[offset]! + bytes[offset + 1]! + bytes[offset + 2]! + bytes[offset + 3]! + (cmyk ? bytes[offset + 4]! : 0));
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
                // Preserve the selected tuple's working samples after bounded ranking.
                const samples = yield* read(image, position, length, true);
                for (let pixel = 0; pixel < pixels; pixel++) {
                    const offset = pixel * stride, sum = Math.trunc(bytes[offset]! + bytes[offset + 1]! + bytes[offset + 2]! + bytes[offset + 3]! + (cmyk ? bytes[offset + 4]! : 0));
                    if (sum === sums[pixel]) { if (ranks[pixel] === 0) data.set(samples.subarray(offset, offset + stride), offset); ranks[pixel]! -= 1; }
                }
            }
        } else if (["sin", "sine", "cos", "cosine"].includes(operation)) {
            const values = Float64Array.from(data, value => value * scale);
            const wave = operation === "sin" || operation === "sine" ? Math.sin : Math.cos;
            for (let image = 1; image < frames; image++) {
                if (++work % 64 === 0) yield;
                const bytes = yield* read(image, position, length);
                // Native uses the accumulated Q16 quantum as the incoming sample's frequency.
                for (let offset = 0; offset < length; offset++) values[offset] = 65535 * (0.5 + 0.5 * wave(2 * Math.PI * (1 / 65535) * (bytes[offset]! * scale) * values[offset]!));
            }
            for (let offset = 0; offset < length; offset++) {
                if (offset % stride !== 3 || hasAlpha) data[offset] = values[offset]! / scale;
            }
        } else if (operation === "exp" || operation === "exponential") {
            const values = Float64Array.from(data, value => value * scale);
            for (let image = 1; image < frames; image++) {
                if (++work % 64 === 0) yield;
                const bytes = yield* read(image, position, length);
                // Native Exp uses the accumulated Q16 quantum as the exponent factor.
                for (let offset = 0; offset < length; offset++) values[offset] = 65535 * Math.exp(values[offset]! * (bytes[offset]! / range));
            }
            for (let offset = 0; offset < length; offset++) {
                if (offset % stride !== 3 || hasAlpha) data[offset] = clamp(values[offset]! / scale);
            }
        } else if (operation === "log" || operation === "inverselog") {
            const values = Float64Array.from(data, value => value * scale);
            for (let image = 1; image < frames; image++) {
                if (++work % 64 === 0) yield;
                const bytes = yield* read(image, position, length);
                // The accumulated Q16 quantum is the next sample's logarithm parameter.
                for (let offset = 0; offset < length; offset++) {
                    const value = values[offset]!, sample = bytes[offset]! / range;
                    values[offset] = operation === "log"
                        ? value <= 1e-12 ? 0 : 65535 * Math.log(1 + value * sample) / Math.log(1 + value)
                        : 65535 * Math.pow(value + 1, sample - 1) / Math.max(value, 1e-12);
                }
            }
            for (let offset = 0; offset < length; offset++) {
                if (offset % stride !== 3 || hasAlpha) data[offset] = operation === "log" ? values[offset]! / scale : clamp(values[offset]! / scale);
            }
        } else if (operation === "rootmeansquare" || operation === "rms") {
            // Native Q16 seeds the accumulator with the first unsquared quantum.
            const values = Float64Array.from(data, value => value * scale);
            for (let image = 1; image < frames; image++) {
                if (++work % 64 === 0) yield;
                const bytes = yield* read(image, position, length);
                for (let offset = 0; offset < length; offset++) values[offset]! += (bytes[offset]! * scale) ** 2;
            }
            for (let offset = 0; offset < length; offset++) {
                if (offset % stride !== 3 || hasAlpha) data[offset] = Math.sqrt(values[offset]! / frames) / scale;
            }
        } else if (["mean", "min", "max", "add", "addmodulus", "sum", "abs", "subtract", "divide", "multiply", "pow"].includes(operation)) {
            const values = new Float64Array(length), multiplication = operation === "multiply", addition = ["mean", "add", "addmodulus", "sum", "abs"].includes(operation);
            const quantum = operation === "divide" || operation === "pow";
            const ordered = operation === "subtract" || quantum;
            if (multiplication) values.fill(1);
            else if (!addition) values.set(first);
            if (quantum) for (let offset = 0; offset < length; offset++) values[offset]! *= scale;
            for (let image = ordered ? 1 : 0; image < frames; image++) {
                if (++work % 64 === 0) yield;
                const bytes = yield* read(image, position, length);
                for (let offset = 0; offset < length; offset++) {
                    if (operation === "addmodulus") {
                        // Wrap at QuantumRange + 1 in native Q16 units, not at 256 bytes.
                        values[offset] = (values[offset]! + bytes[offset]! * scale) % 65536;
                    } else if (addition) values[offset]! += bytes[offset]!;
                    else if (multiplication) values[offset]! *= bytes[offset]! / range;
                    // Native sequence evaluation applies each incoming sample to the accumulator.
                    else if (operation === "subtract") values[offset] = bytes[offset]! - values[offset]!;
                    else if (operation === "divide") values[offset] = bytes[offset]! * scale / (values[offset]! || 1);
                    // Native Pow treats a near-zero quantum exponent as zero output.
                    else if (operation === "pow") values[offset] = values[offset]! <= 1e-12 ? 0 : 65535 * (bytes[offset]! / range) ** values[offset]!;
                    else if (operation === "min") values[offset] = Math.min(values[offset]!, bytes[offset]!);
                    else values[offset] = Math.max(values[offset]!, bytes[offset]!);
                }
            }
            if (operation === "addmodulus") for (let offset = 0; offset < length; offset++) values[offset]! /= scale;
            if (retainRange) {
                // Keep HDRI arithmetic separate from the bounded encoding views.
                const samples = Float64Array.from(values, (value, offset) => offset % stride === 3 && !hasAlpha ? 255 : highDepth ? value / 257 : value);
                yield* write(position, samples, true);
            }
            const average = operation === "mean";
            for (let offset = 0; offset < length; offset++) {
                if (average && channels && !channels[offset % stride] && (offset % stride !== 3 || hasAlpha)) data[offset] = 0;
                else if (multiplication && (offset % stride !== 3 || hasAlpha)) data[offset] = values[offset]! * range;
                else if (average && (offset % stride !== 3 || hasAlpha)) data[offset] = values[offset]! / frames;
                else if (operation === "divide" && (offset % stride !== 3 || hasAlpha)) data[offset] = values[offset]! / scale;
                else if (offset % stride !== 3 || hasAlpha) data[offset] = cmyk ? (quantum ? values[offset]! / scale : values[offset]!) : clamp(quantum ? values[offset]! / scale : values[offset]!);
            }
        }
        if (fractional || median) {
            // Keep working precision for subsequent arithmetic; integer views are only for encoding.
            const samples = Float64Array.from(data, value => operation === "mean" || median ? highDepth ? value / 257 : value : Math.fround(value * scale) / 257);
            const encoded = highDepth ? Uint16Array.from(samples, value => clamp(value * 257)) : Uint8Array.from(samples, clamp);
            if (!cmyk) yield* write(position, encoded);
            yield* write(position, samples, true);
        } else yield* write(position, data);
    }
}
