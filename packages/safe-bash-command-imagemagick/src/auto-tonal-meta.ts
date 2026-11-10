import type { RgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { Region } from "./region.js";

/** Extra planes share the parent alpha and clipping during both level cache syncs. */
export function* autoTonalMetaPixelSteps(
    image: Omit<RgbaImage, "data"> & { alphaBlend?: boolean | undefined; alphaSeparate?: boolean | undefined; region?: Region | undefined },
    masked: boolean,
    apply: (pixels: RgbaImage, pixelOffset?: number, imageWidth?: number) => Generator<void, RgbaImage, void>,
): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const size = image.width * image.height * 4;
    for (let position = 0; position < size; position += 2048) {
        yield;
        const length = Math.min(2048, size - position);
        const samples: Float64Array[] = [];
        for (const source of [0, 1]) {
            const working = yield { kind: "read", evaluate: true, image: source, position, length };
            samples.push(working?.length ? new Float64Array(working.slice().buffer)
                : Float64Array.from(new Uint16Array((yield { kind: "read", highDepth: true, image: source, position, length })!.slice().buffer), value => value / 257));
        }
        const values = samples[0]!;
        for (let offset = 3; offset < length; offset += 4) values[offset] = samples[1]![offset]!;
        const writeMask = masked ? {
            ...image, width: length / 4, height: 1,
            data: (yield { kind: "read", image: 2, position, length })!,
        } : undefined;
        const pixels = {
            format: image.format, depth: image.depth, density: image.density,
            width: length / 4, height: 1, space: "b-w" as const, channels: 1 as const,
            hasAlpha: image.hasAlpha, alphaBlend: image.alphaBlend, alphaSeparate: image.alphaSeparate, region: image.region,
            data: Uint8Array.from(values), evaluateSamples: values, writeMask,
        };
        const operation = apply(pixels, position / 4, image.width);
        let step = operation.next();
        while (!step.done) { yield; step = operation.next(); }
        const corrected = step.value.evaluateSamples!;
        // Alpha only supplies blending context; the extra plane itself remains opaque.
        for (let offset = 3; offset < length; offset += 4) corrected[offset] = 255;
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(corrected.buffer) };
        const bounded = Uint16Array.from(corrected, value => Math.round(Math.max(0, Math.min(65535, value * 257))));
        yield { kind: "write", highDepth: true, position, data: new Uint8Array(bounded.buffer) };
    }
}
