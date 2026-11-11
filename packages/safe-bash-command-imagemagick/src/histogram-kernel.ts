import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";

/** Overlay RGB frequency bars using the requested histogram canvas. */
export function* histogramPixelSteps(source: Pick<RgbaImage, "width" | "height" | "space" | "hueSamples"> & Partial<Pick<StoredRgbaImage, "storedHueSamples">>, width: number, height: number, channels: { r: boolean; g: boolean; b: boolean }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const count = source.width * source.height, cmyk = source.space === "cmyk";
    const selected = [channels.r, channels.g, channels.b];
    const bins = new Float64Array(256 * 3);
    let maximum = 0;
    const chunkSize = cmyk ? 512 : 4096;
    for (let first = 0; first < count; first += chunkSize) {
        yield;
        const length = Math.min(chunkSize, count - first) * 4;
        const pixels = yield { kind: "read", position: first * 4, length, ...(cmyk ? { hue: true } : {}) };
        if (!pixels || pixels.length !== length * (cmyk ? 8 : 1)) throw new Error("Truncated histogram pixels");
        const inks = cmyk ? new Float64Array(pixels.slice().buffer) : undefined;
        for (let i = 0; i < length; i += 4) for (let channel = 0; channel < 3; channel++) {
            const value = inks ? Math.round(Math.max(0, Math.min(1, inks[i + channel]!)) * 255) : pixels[i + channel]!;
            if (selected[channel]) maximum = Math.max(maximum, ++bins[value * 3 + channel]!);
        }
    }
    for (let y = 0; y < height; y++) {
        yield;
        const data = new Uint8Array(width * 4);
        for (let x = 0; x < width; x++) {
            for (let channel = 0; channel < 3; channel++) {
                if (selected[channel] && y >= Math.round(height - height * (bins[x * 3 + channel] ?? 0) / maximum)) data[x * 4 + channel] = 255;
            }
            data[x * 4 + 3] = 255;
        }
        if (cmyk || source.hueSamples || source.storedHueSamples !== undefined) {
            const samples = Float64Array.from(data, value => value / 255);
            yield { kind: "write", hue: true, position: y * width * 4, data: new Uint8Array(samples.buffer) };
        }
        // The CMYK canvas starts with full black ink, which the color bars retain.
        if (cmyk) for (let i = 0; i < data.length; i += 4) data.fill(0, i, i + 3);
        yield { kind: "write", position: y * width * 4, data };
    }
}
