import type { RgbaColor, RgbaImage } from "@poe-code/image-ast";
import { paintWorkingChunk } from "./paint-working.js";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { matchesAlphaFloodfill } from "./floodfill.js";

export function* drawReplacePixelSteps(image: Pick<RgbaImage, "width" | "height" | "space" | "hasAlpha">, x: number, y: number, color: RgbaColor, alphaOnly: boolean, fuzz: number, highDepth: boolean): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const scale = highDepth ? 257 : 1;
    const seedBytes = yield { kind: "read", position: (y * image.width + x) * 4, length: 4, highDepth };
    if (!seedBytes || seedBytes.length !== 4 * (highDepth ? 2 : 1)) throw new Error("Truncated drawing seed");
    const seedEvaluateBytes = yield { kind: "read", position: (y * image.width + x) * 4, length: 4, evaluate: true };
    const seed = seedEvaluateBytes?.length ? new Float64Array(seedEvaluateBytes.slice().buffer)
        : highDepth ? new Uint16Array(seedBytes.slice().buffer) : seedBytes;
    const seedScale = seedEvaluateBytes?.length ? 1 : scale;
    for (let position = 0; position < image.width * image.height * 4; position += 4096) {
        yield;
        const length = Math.min(4096, image.width * image.height * 4 - position);
        const bytes = yield { kind: "read", position, length, highDepth };
        if (!bytes || bytes.length !== length * (highDepth ? 2 : 1)) throw new Error("Truncated drawing pixels");
        const data = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes.slice();
        const evaluateBytes = yield { kind: "read", position, length, evaluate: true };
        const samples = evaluateBytes?.length ? new Float64Array(evaluateBytes.slice().buffer) : data;
        const sampleScale = evaluateBytes?.length ? 1 : scale;
        const selected = new Uint8Array(length / 4);
        for (let i = 0; i < length; i += 4) {
            if (!matchesAlphaFloodfill(samples[i]! / sampleScale, samples[i + 1]! / sampleScale, samples[i + 2]! / sampleScale, image.hasAlpha ? samples[i + 3]! / sampleScale : 255, seed[0]! / seedScale, seed[1]! / seedScale, seed[2]! / seedScale, image.hasAlpha ? seed[3]! / seedScale : 255, fuzz)) continue;
            selected[i / 4] = 1;
        }
        yield* paintWorkingChunk(position, data, selected, color, image.space === "cmyk", alphaOnly);
        yield { kind: "write", position, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), highDepth };
    }
}
