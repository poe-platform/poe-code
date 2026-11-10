import { expect, it } from "vitest";
import { clutPixelSteps, haldClutPixelSteps, combinePixelSteps, evaluateSequencePixelSteps, interpolatePixelSteps } from "./sequence-kernel.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

function run(steps: Generator<ConvolveRequest | undefined, void, Uint8Array | undefined>, sources: Uint8Array[], size: number) {
    const result = new Uint8Array(size), owned: { bytes: Uint8Array; copy: Uint8Array }[] = [];
    let next = steps.next();
    while (!next.done) {
        const request = next.value;
        if (!request) next = steps.next();
        else if (request.kind === "read") {
            expect(request.length).toBeLessThanOrEqual(16384);
            next = steps.next(request.evaluate || request.hue ? new Uint8Array() : sources[request.image ?? 0]!.subarray(request.position, request.position + request.length));
        } else {
            expect(request.data.length / (request.evaluate ? 8 : request.highDepth ? 2 : 1)).toBeLessThanOrEqual(16384);
            owned.push({ bytes: request.data, copy: new Uint8Array(request.data) });
            if (!request.evaluate) result.set(request.data, request.position);
            next = steps.next();
        }
    }
    for (const { bytes, copy } of owned) expect(bytes).toEqual(copy);
    return result;
}

it.each(["mean", "median", "min", "max", "add", "multiply"])("matches independent sequence reference for %s, including stable intensity ties", operation => {
    const size = 1031 * 4, frames = Array.from({ length: 75 }, (_, frame) => Uint8Array.from({ length: size }, (_, index) => index < 8 ? index % 4 === 0 ? frame : index % 4 === 1 ? 255 - frame : 0 : (index * 73 + frame * 31) % 256));
    const actual = run(evaluateSequencePixelSteps(size, frames.map(() => ({ hasAlpha: true, space: "srgb" as const, format: "png" as const, depth: "uchar" as const })), operation), frames, size), expected = new Uint8Array(size);
    for (let pixel = 0; pixel < size; pixel += 4) {
        const ranked = frames.map((data, index) => ({ data, index, sum: data.slice(pixel, pixel + 4).reduce((a, b) => a + b, 0) })).sort((a, b) => a.sum - b.sum || a.index - b.index);
        for (let channel = 0; channel < 4; channel++) {
            const values = frames.map(frame => frame[pixel + channel]!);
            let value = values[0]!;
            if (operation === "median") value = ranked[Math.floor(frames.length / 2)]!.data[pixel + channel]!;
            else if (operation === "mean") value = values.reduce((a, b) => a + b, 0) / values.length;
            else if (operation === "add") value = values.reduce((a, b) => a + b, 0);
            else if (operation === "multiply") value = values.reduce((a, b) => a * (b / 255), 1) * 255;
            else if (operation === "min") value = Math.min(...values);
            else if (operation === "max") value = Math.max(...values);
            expected[pixel + channel] = Math.max(0, Math.min(255, Math.round(value)));
        }
    }
    expect(actual).toEqual(expected);
});

it.each([false, true])("uses one-dimensional LUTs and channel mask, vertical=%s", vertical => {
    const width = vertical ? 1 : 10001, height = vertical ? 10001 : 1, size = 4201 * 4;
    const source = Uint8Array.from({ length: size }, (_, i) => i % 256), lut = Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 59 % 256);
    const expected = Uint8Array.from(source, (value, index) => {
        if (index % 4 !== 1 && index % 4 !== 3) return value;
        const position = value / 255 * 10000, lower = Math.floor(position), upper = Math.ceil(position);
        const a = lower * (vertical ? width : 1) * 4, b = upper * (vertical ? width : 1) * 4;
        const weights = [1 - (position - lower), position - lower];
        const alpha = lut[a + 3]! * weights[0]! + lut[b + 3]! * weights[1]!;
        if (index % 4 === 3) return Math.round(alpha);
        return alpha === 0 ? 0 : Math.round((lut[a + 1]! * lut[a + 3]! * weights[0]! + lut[b + 1]! * lut[b + 3]! * weights[1]!) / alpha);
    });
    expect(run(clutPixelSteps(size, { width, height, hasAlpha: true }, [false, true, false, true]), [source, lut], size)).toEqual(expected);
});

it("uses a single LUT pixel for every input value", () => {
    const source = Uint8Array.of(0, 128, 255, 64), lut = Uint8Array.of(12, 34, 56, 78);
    expect(run(clutPixelSteps(4, { width: 1, height: 1, hasAlpha: true }, [true, true, true, true]), [source, lut], 4)).toEqual(lut);
});

it("preserves interpolation rounding and missing channel samples", () => {
    const size = 4201 * 4, a = Uint8Array.from({ length: size }, (_, i) => i % 256), b = Uint8Array.from(a, value => 255 - value);
    expect(run(interpolatePixelSteps(size, 1 / 3), [a, b], size)).toEqual(Uint8Array.from(a, (value, i) => Math.round(value * (1 - 1 / 3) + b[i]! / 3)));
    const g = b.subarray(0, 12), expected = new Uint8Array(size);
    // Consecutive RGB samples have Rec.709 intensity R + (0.715158 + 2 * 0.072186).
    for (let offset = 0; offset < size; offset += 4) { expected[offset] = Math.round(a[offset]! + 0.85953); expected[offset + 1] = offset < g.length ? Math.round(g[offset]! - 0.85953) : a[offset + 1]!; expected[offset + 2] = Math.round(b[offset]! - 0.85953); expected[offset + 3] = a[offset + 3]!; }
    expect(run(combinePixelSteps([a, g, b].map(data => ({ width: data.length / 4, height: 1 }))), [a, g, b], size)).toEqual(expected);
});


// Cross-channel lookup verifies cube indexing and interpolation at boundaries and interior points.
it("interpolates Hald cube corners and preserves unselected channels across chunks", () => {
    const source = Uint8Array.from({ length: 4201 * 4 }, (_, i) => [0, 64, 128, 192, 255][i % 5]!);
    const lut = new Uint8Array(8 * 8 * 4);
    for (let b = 0; b < 4; b++) for (let g = 0; g < 4; g++) for (let r = 0; r < 4; r++)
        lut.set([b * 85, r * 85, g * 85, 255], (r + 4 * g + 16 * b) * 4);
    const expected = new Uint8Array(source);
    for (let offset = 0; offset < source.length; offset += 4) {
        expected[offset] = source[offset + 2]!;
        expected[offset + 2] = source[offset + 1]!;
    }
    expect(run(haldClutPixelSteps(source.length, { width: 8, height: 8, hasAlpha: false }, [true, false, true, false]), [source, lut], source.length)).toEqual(expected);
});

it.each([
    { pixels: [1, 250], expected: 2 },
    { pixels: [1, 250, 254], expected: 52 },
    { pixels: [0, 255], expected: 0 },
    { pixels: [255, 255], expected: 255 },
    { pixels: [255, 255, 0], expected: 0 },
    { pixels: [83], expected: 83 },
])("uses native Pow quantum exponents without rounding intermediate values for $pixels", ({ pixels, expected }) => {
    const frames = pixels.map(value => Uint8Array.of(value, value, value, value));
    expect(run(evaluateSequencePixelSteps(4, frames.map(() => ({ hasAlpha: true, space: "srgb" as const, format: "png" as const, depth: "uchar" as const })), "Pow"), frames, 4)).toEqual(Uint8Array.of(expected, expected, expected, expected));
});

it.each([
    { pixels: [0, 0, 255], expected: 255 },
    { pixels: [0, 255, 255], expected: 0 },
    { pixels: [255, 0, 255], expected: 255 },
])("uses native Divide zero-divisor handling for $pixels", ({ pixels, expected }) => {
    const frames = pixels.map(value => Uint8Array.of(value, value, value, value));
    expect(run(evaluateSequencePixelSteps(4, frames.map(() => ({ hasAlpha: true, space: "srgb" as const, format: "png" as const, depth: "uchar" as const })), "Divide"), frames, 4)).toEqual(Uint8Array.of(expected, expected, expected, expected));
});

for (const hasAlpha of [false, true])
for (const count of [1, 4, 75])
it.each([
    [true, false, false, false],
    [true, true, false, false],
    [true, true, true, false],
    [false, false, false, true],
])(`ranks masked Median across chunks with stable ties (alpha=${hasAlpha}, frames=${count}), mask=%j`, (...mask) => {
    const size = 131 * 4;
    const frames = Array.from({ length: count }, (_, frame) => Uint8Array.from({ length: size }, (_, index) =>
        index % 4 === 3 && !hasAlpha ? 255 : index < 8 ? [frame, 255 - frame, frame * 3 % 256, 255 - frame * 2][index % 4]! : (index * 73 + frame * 31) % 256));
    const expected = new Uint8Array(size);
    for (let offset = 0; offset < size; offset += 4) {
        const ranked = frames.map(frame => frame.slice(offset, offset + 4)).sort((a, b) =>
            a.reduce((sum, value, channel) => sum + (mask[channel] ? value : 0), 0) -
            b.reduce((sum, value, channel) => sum + (mask[channel] ? value : 0), 0));
        const selected = ranked[Math.floor(count / 2)]!;
        for (let channel = 0; channel < 4; channel++) expected[offset + channel] = channel === 3 && !hasAlpha ? 255 : mask[channel] ? selected[channel]! : 0;
    }
    const inputs = frames.map(() => ({ hasAlpha, space: "srgb" as const, format: "png" as const, depth: "uchar" as const }));
    expect(run(evaluateSequencePixelSteps(size, inputs, "Median", mask), frames, size)).toEqual(expected);
});
