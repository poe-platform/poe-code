import { expect, it } from "vitest";
import { clutPixelSteps, combinePixelSteps, evaluateSequencePixelSteps, interpolatePixelSteps } from "./sequence-kernel.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

function run(steps: Generator<ConvolveRequest | undefined, void, Uint8Array | undefined>, sources: Uint8Array[], size: number) {
    const result = new Uint8Array(size), owned: { bytes: Uint8Array; copy: Uint8Array }[] = [];
    let next = steps.next();
    while (!next.done) {
        const request = next.value;
        if (!request) next = steps.next();
        else if (request.kind === "read") {
            expect(request.length).toBeLessThanOrEqual(16384);
            next = steps.next(sources[request.image ?? 0]!.subarray(request.position, request.position + request.length));
        } else {
            expect(request.data.length).toBeLessThanOrEqual(16384);
            owned.push({ bytes: request.data, copy: new Uint8Array(request.data) });
            result.set(request.data, request.position); next = steps.next();
        }
    }
    for (const { bytes, copy } of owned) expect(bytes).toEqual(copy);
    return result;
}

it.each(["mean", "average", "median", "min", "max", "add", "multiply", "unknown"])("matches independent sequence reference for %s, including stable intensity ties", operation => {
    const size = 1031 * 4, frames = Array.from({ length: 75 }, (_, frame) => Uint8Array.from({ length: size }, (_, index) => index < 8 ? index % 4 === 0 ? frame : index % 4 === 1 ? 255 - frame : 0 : (index * 73 + frame * 31) % 256));
    const actual = run(evaluateSequencePixelSteps(size, frames.length, operation), frames, size), expected = new Uint8Array(size);
    for (let pixel = 0; pixel < size; pixel += 4) {
        const ranked = frames.map((data, index) => ({ data, index, sum: data.slice(pixel, pixel + 4).reduce((a, b) => a + b, 0) })).sort((a, b) => a.sum - b.sum || a.index - b.index);
        for (let channel = 0; channel < 3; channel++) {
            const values = frames.map(frame => frame[pixel + channel]!);
            let value = values[0]!;
            if (operation === "median") value = ranked[Math.floor(frames.length / 2)]!.data[pixel + channel]!;
            else if (operation === "mean" || operation === "average") value = values.reduce((a, b) => a + b, 0) / values.length;
            else if (operation === "add") value = values.reduce((a, b) => a + b, 0);
            else if (operation === "multiply") value = values.reduce((a, b) => a * (b / 255), 1) * 255;
            else if (operation === "min") value = Math.min(...values);
            else if (operation === "max") value = Math.max(...values);
            expected[pixel + channel] = Math.max(0, Math.min(255, Math.round(value)));
        }
        expected[pixel + 3] = frames[0]![pixel + 3]!;
    }
    expect(actual).toEqual(expected);
});

it.each([false, true])("uses the selected LUT axis and channel mask, vertical=%s", vertical => {
    const width = vertical ? 3 : 10001, height = vertical ? 10001 : 3, size = 4201 * 4;
    const source = Uint8Array.from({ length: size }, (_, i) => i % 256), lut = Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 59 % 256);
    const expected = Uint8Array.from(source, (value, index) => index % 4 === 1 || index % 4 === 3 ? lut[Math.round(value / 255 * 10000) * (vertical ? width : 1) * 4 + index % 4]! : value);
    expect(run(clutPixelSteps(size, { width, height }, [false, true, false, true]), [source, lut], size)).toEqual(expected);
});

it("preserves interpolation rounding and missing channel samples", () => {
    const size = 4201 * 4, a = Uint8Array.from({ length: size }, (_, i) => i % 256), b = Uint8Array.from(a, value => 255 - value);
    expect(run(interpolatePixelSteps(size, 1 / 3), [a, b], size)).toEqual(Uint8Array.from(a, (value, i) => Math.round(value * (1 - 1 / 3) + b[i]! / 3)));
    const g = b.subarray(0, 12), expected = new Uint8Array(size);
    for (let offset = 0; offset < size; offset += 4) { expected[offset] = a[offset]!; expected[offset + 1] = g[offset] ?? 0; expected[offset + 2] = b[offset]!; expected[offset + 3] = 255; }
    expect(run(combinePixelSteps(size, [a.length, g.length, b.length]), [a, g, b], size)).toEqual(expected);
});
