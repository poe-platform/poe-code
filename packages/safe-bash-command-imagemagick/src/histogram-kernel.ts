import type { ConvolveRequest } from "./convolve-kernel.js";

/** Overlay RGB frequency bars using the requested histogram canvas. */
export function* histogramPixelSteps(count: number, width: number, height: number): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const bins = new Float64Array(256 * 3);
    let maximum = 0;
    for (let first = 0; first < count; first += 4096) {
        yield;
        const length = Math.min(4096, count - first) * 4;
        const pixels = yield { kind: "read", position: first * 4, length };
        if (!pixels || pixels.length !== length) throw new Error("Truncated histogram pixels");
        for (let i = 0; i < length; i += 4) for (let channel = 0; channel < 3; channel++) {
            maximum = Math.max(maximum, ++bins[pixels[i + channel]! * 3 + channel]!);
        }
    }
    for (let y = 0; y < height; y++) {
        yield;
        const data = new Uint8Array(width * 4);
        for (let x = 0; x < width; x++) {
            for (let channel = 0; channel < 3; channel++) {
                if (y >= Math.round(height - height * (bins[x * 3 + channel] ?? 0) / maximum)) data[x * 4 + channel] = 255;
            }
            data[x * 4 + 3] = 255;
        }
        yield { kind: "write", position: y * width * 4, data };
    }
}
