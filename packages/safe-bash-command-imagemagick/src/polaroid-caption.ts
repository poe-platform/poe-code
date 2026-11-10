import { borderPixels } from "./border.js";
import type { renderFontCaption } from "./font/caption.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

export function* polaroidPixels(image: Parameters<typeof borderPixels>[0], border: number, color: Parameters<typeof borderPixels>[3], caption?: ReturnType<typeof renderFontCaption>): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    yield* borderPixels(image, border, border, color, true, border + (caption?.height ?? 0));
    if (!caption) return;
    const width = image.width + 2 * border, top = image.height + Math.floor(3 * border / 2);
    for (let y = 0; y < caption.height; y++) for (let x = 0; x < caption.width; x += 1024) {
        yield;
        const count = Math.min(1024, caption.width - x);
        const samples = caption.pixels.subarray((y * caption.width + x) * 4, (y * caption.width + x + count) * 4);
        const data = Uint16Array.from(samples, value => Math.round(value * 257));
        const position = ((top + y) * width + border + x) * 4;
        yield { kind: "write", position, data: new Uint8Array(data.buffer), highDepth: true };
        if (image.evaluateSamples || image.storedEvaluateSamples !== undefined) yield { kind: "write", position, data: new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), evaluate: true };
    }
}
