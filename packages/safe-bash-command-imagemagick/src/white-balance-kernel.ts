import type { RgbaImage } from "@poe-code/image-ast/portable";
import { convertHuePixels } from "./colorspace-hue.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

/** Gray-world correction in Lab, including colors beneath transparent pixels. */
export function* whiteBalancePixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha">, vibrance?: string): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const size = image.width * image.height * 4;
    // Native levels Lab chroma in Q16 units; bare values are not percentages.
    const black = (Number.parseFloat(vibrance ?? "") || 0) * (vibrance?.includes("%") ? 65535 / 100 : 1);
    const range = 65535 - 2 * black;
    const scale = 1 / (Math.abs(range) >= 1e-12 ? range : range < 0 ? -1e-12 : 1e-12);
    let a = 0, b = 0;
    for (let pass = 0; pass < 2; pass++) {
        for (let position = 0; position < size; position += 2048) {
            yield;
            const length = Math.min(2048, size - position);
            const bytes = yield { kind: "read", hue: true, position, length };
            let samples: Float64Array;
            if (bytes?.length === length * 8) samples = new Float64Array(bytes.slice().buffer);
            else {
                const original = yield { kind: "read", highDepth: true, position, length };
                if (!original || original.length !== length * 2) throw new Error("Truncated white-balance pixels");
                samples = Float64Array.from(new Uint16Array(original.slice().buffer), value => value / 65535);
            }
            for (let offset = 0; offset < length; offset += 4) {
                if (pass === 0) { a += samples[offset + 1]! - 0.5; b += samples[offset + 2]! - 0.5; }
                else {
                    samples[offset + 1]! -= 1.1 * samples[offset]! * a;
                    samples[offset + 2]! -= 1.1 * samples[offset]! * b;
                    if (vibrance !== undefined) {
                        // ImageMagick 7.1.2 aliases both aChannel and bChannel to
                        // GreenChannel, so its vibrance mask levels only Lab a.
                        samples[offset + 1] = Math.max(0, Math.min(1, (samples[offset + 1]! * 65535 - black) * scale));
                    }
                }
            }
            if (pass === 1) {
                const conversion = convertHuePixels({ width: length / 4, height: 1, hasAlpha: image.hasAlpha,
                    channels: image.hasAlpha ? 4 : 3, space: "srgb", depth: "ushort", format: "raw", density: 72,
                    magickColorspace: "CIELab", data: new Uint8Array(length), hueSamples: samples }, "sRGB");
                let next = conversion.next();
                while (!next.done) { yield; next = conversion.next(); }
                const output = next.value;
                yield { kind: "write", highDepth: true, position, data: new Uint8Array(output.data16!.buffer) };
            }
        }
        if (pass === 0) { a /= image.width * image.height; b /= image.width * image.height; }
    }
}
