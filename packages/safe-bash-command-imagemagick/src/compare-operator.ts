import { compareImageSteps, type CompareImage, type CompareSamples } from "./compare-kernel.js";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { rgbToCmyk } from "./colorspace-cmyk.js";

/** Drive the comparison kernel through the pipeline's bounded raster I/O. */
export function* compareOperatorPixelSteps(first: CompareImage, second: CompareImage, fuzz: number): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const comparison = compareImageSteps(first, second, {
        metric: "rmse", fuzz, highlightColor: { r: 241, g: 0, b: 30, a: 204 },
        composeSrc: false, diff: true, highDepthDiff: true
    });
    let next = comparison.next();
    while (!next.done) {
        const request = next.value;
        if (!request) {
            yield;
            next = comparison.next();
        } else if (request.kind === "read") {
            const image = request.image === 0 ? first : second;
            const source = request.mask ? request.image + 2 : request.image;
            const read = { kind: "read" as const, image: source, position: request.position, length: request.length };
            const working = yield { ...read, evaluate: true };
            let samples: CompareSamples;
            if (working?.length) samples = new Float64Array(working.slice().buffer);
            else {
                const bytes = (yield { ...read, highDepth: true })!;
                samples = Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257);
            }
            if (!request.mask) {
                const bytes = yield { ...read, hue: true };
                const hue = bytes?.length ? new Float64Array(bytes.slice().buffer) : undefined;
                if (image.space === "cmyk") {
                    const cmyka = new Float64Array(request.length / 4 * 5);
                    for (let offset = 0; offset < request.length; offset += 4) {
                        const inks = hue?.subarray(offset, offset + 4) ?? rgbToCmyk(samples[offset]! / 255, samples[offset + 1]! / 255, samples[offset + 2]! / 255);
                        cmyka.set([inks[0]! * 255, inks[1]! * 255, inks[2]! * 255, samples[offset + 3]!, inks[3]! * 255], offset / 4 * 5);
                    }
                    samples = cmyka;
                } else if (hue) samples = Float64Array.from(hue, value => value * 255);
            }
            next = comparison.next(samples);
        } else {
            yield { kind: "write", position: request.position, highDepth: true, data: new Uint8Array(request.data16!.buffer, request.data16!.byteOffset, request.data16!.byteLength) };
            next = comparison.next();
        }
    }
}
