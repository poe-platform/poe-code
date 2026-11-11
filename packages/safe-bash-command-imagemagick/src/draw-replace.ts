import type { RgbaColor, RgbaImage } from "@poe-code/image-ast";
import { paintWorkingChunk } from "./paint-working.js";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { matchesAlphaFloodfill } from "./floodfill.js";

export function* drawReplacePixelSteps(image: Pick<RgbaImage, "width" | "height" | "space">, x: number, y: number, color: RgbaColor, alphaOnly: boolean, fuzz: number, highDepth: boolean): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const scale = highDepth ? 257 : 1;
    const seedBytes = yield { kind: "read", position: (y * image.width + x) * 4, length: 4, highDepth };
    if (!seedBytes || seedBytes.length !== 4 * (highDepth ? 2 : 1)) throw new Error("Truncated drawing seed");
    const seed = highDepth ? new Uint16Array(seedBytes.slice().buffer) : seedBytes;
    for (let position = 0; position < image.width * image.height * 4; position += 4096) {
        yield;
        const length = Math.min(4096, image.width * image.height * 4 - position);
        const bytes = yield { kind: "read", position, length, highDepth };
        if (!bytes || bytes.length !== length * (highDepth ? 2 : 1)) throw new Error("Truncated drawing pixels");
        const data = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes.slice();
        const selected = new Uint8Array(length / 4);
        for (let i = 0; i < length; i += 4) {
            if (!matchesAlphaFloodfill(data[i]! / scale, data[i + 1]! / scale, data[i + 2]! / scale, data[i + 3]! / scale, seed[0]! / scale, seed[1]! / scale, seed[2]! / scale, seed[3]! / scale, fuzz)) continue;
            selected[i / 4] = 1;
        }
        yield* paintWorkingChunk(position, data, selected, color, image.space === "cmyk", alphaOnly);
        yield { kind: "write", position, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), highDepth };
    }
}
