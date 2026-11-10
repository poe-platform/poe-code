import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";

export function* borderPixels(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "evaluateSamples"> & Partial<Pick<StoredRgbaImage, "storedEvaluateSamples">>, left: number, top: number, color: RgbaColor, highDepth: boolean, bottom = top): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const width = image.width + left * 2, height = image.height + top + bottom;
    const evaluate = !!image.evaluateSamples || image.storedEvaluateSamples !== undefined;
    const maximum = highDepth ? 65535 : 255;
    const background = [color.r, color.g, color.b, color.a].map(value => Math.round(value * maximum / 255));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x += 1024) {
        yield;
        const count = Math.min(1024, width - x);
        const data = highDepth ? new Uint16Array(count * 4) : new Uint8Array(count * 4);
        const samples = evaluate ? new Float64Array(count * 4) : undefined;
        for (let pixel = 0; pixel < count; pixel++) {
            data.set(background, pixel * 4);
            samples?.set([color.r, color.g, color.b, color.a], pixel * 4);
        }
        const first = Math.max(x, left), end = Math.min(x + count, left + image.width), sy = y - top;
        if (sy >= 0 && sy < image.height && first < end) {
            const bytes = yield { kind: "read", position: (sy * image.width + first - left) * 4, length: (end - first) * 4, highDepth, evaluate };
            if (!bytes) throw new Error("Missing border source pixels");
            const source = evaluate ? new Float64Array(bytes.slice().buffer).map(value => value * maximum / 255) : highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
            for (let pixel = first; pixel < end; pixel++) {
                const src = (pixel - first) * 4, dst = (pixel - x) * 4;
                const alpha = image.hasAlpha ? source[src + 3]! / maximum : 1, behind = background[3]! / maximum * (1 - alpha), combined = alpha + behind;
                for (let channel = 0; channel < 4; channel++) {
                    const value = channel === 3 ? combined * maximum : combined
                        ? (source[src + channel]! * alpha + background[channel]! * behind) / combined : background[channel]!;
                    data[dst + channel] = Math.round(value);
                    // Retain Q16-HDRI palette means for the following warp/interpolation.
                    if (samples) samples[dst + channel] = Math.fround(value * 65535 / maximum) / 257;
                }
            }
        }
        if (samples) yield { kind: "write", position: (y * width + x) * 4, data: new Uint8Array(samples.buffer), evaluate: true };
        yield { kind: "write", position: (y * width + x) * 4, data: new Uint8Array(data.buffer), highDepth };
    }
}
