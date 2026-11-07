import type { ConvolveRequest } from "./convolve-kernel.js";
type Steps = Generator<ConvolveRequest | undefined, void, Uint8Array | undefined>;
const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

export function* clutPixelSteps(size: number, lut: { width: number; height: number }, mask: readonly boolean[], highDepth = false): Steps {
    if (highDepth) {
        const horizontal = lut.width >= lut.height, length = Math.max(lut.width, lut.height);
        for (let position = 0; position < size; position += 4096) {
            yield;
            const bytes = (yield { kind: "read", highDepth, position, length: Math.min(4096, size - position) })!;
            const data = new Uint16Array(bytes.slice().buffer);
            for (let offset = 0; offset < data.length; offset++) {
                if (offset % 256 === 0) yield;
                const channel = offset % 4;
                if (!mask[channel]) continue;
                const sample = data[offset]! / 65535 * (length - 1), lower = Math.floor(sample), upper = Math.ceil(sample);
                const a = (yield { kind: "read", highDepth, image: 1, position: (horizontal ? lower : lower * lut.width) * 4, length: 4 })!;
                const b = upper === lower ? a : (yield { kind: "read", highDepth, image: 1, position: (horizontal ? upper : upper * lut.width) * 4, length: 4 })!;
                const av = new Uint16Array(a.slice().buffer), bv = new Uint16Array(b.slice().buffer), fraction = sample - lower;
                const aWeight = av[3]! * (1 - fraction), bWeight = bv[3]! * fraction, alpha = aWeight + bWeight;
                data[offset] = channel === 3 ? Math.round(alpha) : alpha === 0 ? 0 : Math.round((av[channel]! * aWeight + bv[channel]! * bWeight) / alpha);
            }
            yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
        }
        return;
    }
    const horizontal = lut.width >= lut.height, length = Math.max(1, horizontal ? lut.width : lut.height), table = new Uint8Array(1024);
    for (let value = 0; value < 256; value++) {
        if (value % 64 === 0) yield;
        const sample = value / 255 * (length - 1), lower = Math.floor(sample), upper = Math.ceil(sample), fraction = sample - lower;
        const a = (yield { kind: "read", image: 1, position: (horizontal ? lower : lower * lut.width) * 4, length: 4 })!;
        const b = upper === lower ? a : (yield { kind: "read", image: 1, position: (horizontal ? upper : upper * lut.width) * 4, length: 4 })!;
        const aWeight = a[3]! * (1 - fraction), bWeight = b[3]! * fraction, alpha = aWeight + bWeight;
        // Interpolate premultiplied colors so transparent entries cannot leak hidden RGB.
        for (let channel = 0; channel < 3; channel++) table[value * 4 + channel] = alpha === 0 ? 0 : byte((a[channel]! * aWeight + b[channel]! * bWeight) / alpha);
        table[value * 4 + 3] = byte(alpha);
    }
    for (let position = 0; position < size; position += 16384) {
        yield;
        const data = new Uint8Array((yield { kind: "read", position, length: Math.min(16384, size - position) })!);
        for (let offset = 0; offset < data.length; offset++) if (mask[offset % 4]) data[offset] = table[data[offset]! * 4 + offset % 4]!;
        yield { kind: "write", position, data };
    }
}

/** Hald pixels store red fastest, then green, then blue in a flattened RGB cube. */
export function* haldClutPixelSteps(size: number, lut: { width: number; height: number }, mask: readonly boolean[], highDepth = false): Steps {
    const range = highDepth ? 65535 : 255;
    const level = Math.max(1, Math.floor(Math.cbrt(Math.min(lut.width, lut.height)))), edge = level * level;
    for (let position = 0; position < size; position += 16384) {
        yield;
        const bytes = (yield { kind: "read", highDepth, position, length: Math.min(16384, size - position) })!;
        const data = highDepth ? new Uint16Array(bytes.slice().buffer) : new Uint8Array(bytes);
        for (let offset = 0; offset < data.length; offset += 4) {
            if (offset % 256 === 0) yield;
            const red = data[offset]! / range * (edge - 1), green = data[offset + 1]! / range * (edge - 1), blue = data[offset + 2]! / range * (edge - 1);
            const r = Math.floor(red), g = Math.floor(green), b = Math.floor(blue), values = [0, 0, 0, 0];
            for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
                const weight = (x ? red - r : 1 - (red - r)) * (y ? green - g : 1 - (green - g)) * (z ? blue - b : 1 - (blue - b));
                if (!weight) continue;
                const index = Math.min(r + x, edge - 1) + edge * (Math.min(g + y, edge - 1) + edge * Math.min(b + z, edge - 1));
                const bytes = (yield { kind: "read", highDepth, image: 1, position: index * 4, length: 4 })!;
                const sample = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
                for (let channel = 0; channel < 4; channel++) values[channel]! += sample[channel]! * weight;
            }
            for (let channel = 0; channel < 4; channel++) if (mask[channel]) data[offset + channel] = Math.max(0, Math.min(range, Math.round(values[channel]!)));
        }
        yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
    }
}

export function* interpolatePixelSteps(size: number, fraction: number): Steps {
    for (let position = 0; position < size; position += 16384) {
        yield;
        const length = Math.min(16384, size - position), data = new Uint8Array((yield { kind: "read", position, length })!);
        const other = (yield { kind: "read", image: 1, position, length })!;
        for (let offset = 0; offset < length; offset++) data[offset] = byte(data[offset]! * (1 - fraction) + other[offset]! * fraction);
        yield { kind: "write", position, data };
    }
}

export function* combinePixelSteps(size: number, lengths: readonly number[]): Steps {
    for (let position = 0; position < size; position += 16384) {
        yield;
        const length = Math.min(16384, size - position), data = new Uint8Array(length);
        for (let image = 0; image < 4; image++) {
            if (image === 3 && lengths.length < 4) { for (let offset = 3; offset < length; offset += 4) data[offset] = 255; continue; }
            const count = Math.max(0, Math.min(length, (lengths[image] ?? 0) - position));
            if (!count) continue;
            const source = (yield { kind: "read", image, position, length: count })!;
            for (let offset = 0; offset < count; offset += 4) data[offset + image] = Math.round(0.212656 * source[offset]! + 0.715158 * source[offset + 1]! + 0.072186 * source[offset + 2]!);
        }
        yield { kind: "write", position, data };
    }
}

/** Median ranks RGBA sums, retaining stable input order for equal sums. */
export function* evaluateSequencePixelSteps(size: number, frames: number, raw: string): Steps {
    const operation = raw.toLowerCase().split("-").join("").split("_").join("");
    const median = operation === "median", window = median ? 512 : 4096;
    let work = 0;
    for (let position = 0; position < size; position += window) {
        if (position % 16384 === 0) yield;
        const length = Math.min(window, size - position), data = new Uint8Array((yield { kind: "read", position, length })!);
        if (median) {
            const pixels = length / 4, histogram = new Float64Array(pixels * 32), ranks = new Float64Array(pixels), sums = new Uint16Array(pixels);
            ranks.fill(Math.floor(frames / 2));
            // Two radix passes keep histograms independent of both frame count and image size.
            for (const shift of [5, 0]) {
                histogram.fill(0);
                for (let image = 0; image < frames; image++) {
                    if (++work % 64 === 0) yield;
                    const bytes = (yield { kind: "read", image, position, length })!;
                    for (let pixel = 0; pixel < pixels; pixel++) {
                        const offset = pixel * 4, sum = bytes[offset]! + bytes[offset + 1]! + bytes[offset + 2]! + bytes[offset + 3]!;
                        if (shift === 5 || (sum >> 5) === (sums[pixel]! >> 5)) histogram[pixel * 32 + ((sum >> shift) & 31)]!++;
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
                const bytes = (yield { kind: "read", image, position, length })!;
                for (let pixel = 0; pixel < pixels; pixel++) {
                    const offset = pixel * 4, sum = bytes[offset]! + bytes[offset + 1]! + bytes[offset + 2]! + bytes[offset + 3]!;
                    if (sum === sums[pixel]) { if (ranks[pixel] === 0) data.set(bytes.subarray(offset, offset + 4), offset); ranks[pixel]! -= 1; }
                }
            }
        } else if (["mean", "average", "min", "max", "add", "multiply"].includes(operation)) {
            const values = new Float64Array(length), multiplication = operation === "multiply", addition = ["mean", "average", "add"].includes(operation);
            if (multiplication) values.fill(1);
            else if (!addition) values.set(data);
            for (let image = 0; image < frames; image++) {
                if (++work % 64 === 0) yield;
                const bytes = (yield { kind: "read", image, position, length })!;
                for (let offset = 0; offset < length; offset++) {
                    if (addition) values[offset]! += bytes[offset]!;
                    else if (multiplication) values[offset]! *= bytes[offset]! / 255;
                    else if (operation === "min") values[offset] = Math.min(values[offset]!, bytes[offset]!);
                    else values[offset] = Math.max(values[offset]!, bytes[offset]!);
                }
            }
            const average = operation === "mean" || operation === "average";
            for (let offset = 0; offset < length; offset++) data[offset] = byte(average ? values[offset]! / frames : multiplication ? values[offset]! * 255 : values[offset]!);
        }
        yield { kind: "write", position, data };
    }
}
