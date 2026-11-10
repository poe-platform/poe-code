import type { RgbaImage } from "@poe-code/image-ast/portable";
import { convertHuePixels } from "./colorspace-hue.js";
import { blendMaskedPixel } from "./write-mask.js";
import type { Region } from "./region.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

/** Gray-world correction in Lab, including colors beneath transparent pixels. */
export function* whiteBalancePixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha"> & { region?: Region | undefined }, vibrance?: string, writeMask = false): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
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
            if (bytes?.length === length * 8) samples = Float64Array.from(new Float64Array(bytes.slice().buffer), value => value * 255);
            else {
                const original = yield { kind: "read", highDepth: true, position, length };
                if (!original || original.length !== length * 2) throw new Error("Truncated white-balance pixels");
                samples = Float64Array.from(new Uint16Array(original.slice().buffer), value => value / 257);
            }
            const mask = writeMask ? new Uint16Array((yield { kind: "read", highDepth: true, image: 2, position, length })!.slice().buffer) : undefined;
            const protection = new Float64Array(length / 4);
            if (image.region || mask) {
                const hue = yield { kind: "read", hue: true, image: 1, position, length };
                const working = hue?.length ? undefined : yield { kind: "read", evaluate: true, image: 1, position, length };
                const original = hue?.length ? Float64Array.from(new Float64Array(hue.slice().buffer), value => value * 255)
                    : working?.length ? new Float64Array(working.slice().buffer)
                    : Float64Array.from(new Uint16Array((yield { kind: "read", highDepth: true, image: 1, position, length })!.slice().buffer), value => value / 257);
                for (let offset = 0; offset < length; offset += 4) {
                    const pixel = (position + offset) / 4, x = pixel % image.width, y = Math.floor(pixel / image.width), region = image.region;
                    protection[offset / 4] = region && (x < region.x || x >= region.x + region.width || y < region.y || y >= region.y + region.height) ? 1
                        : mask ? (0.212656 * mask[offset]! + 0.715158 * mask[offset + 1]! + 0.072186 * mask[offset + 2]!) / 65535 : 0;
                    // Native cache writes apply the mask before measuring the Lab means.
                    blendMaskedPixel(samples, original, samples, offset, protection[offset / 4]!, 255, undefined, image.hasAlpha);
                }
            }
            const uncorrected = pass === 1 ? samples.slice() : undefined;
            for (let offset = 0; offset < length; offset += 4) {
                if (pass === 0) { a += samples[offset + 1]! / 255 - 0.5; b += samples[offset + 2]! / 255 - 0.5; }
                else {
                    samples[offset + 1]! -= 1.1 * samples[offset]! * a;
                    samples[offset + 2]! -= 1.1 * samples[offset]! * b;
                    blendMaskedPixel(samples, uncorrected!, samples, offset, protection[offset / 4]!, 255, undefined, image.hasAlpha);
                    if (vibrance !== undefined) {
                        // ImageMagick 7.1.2 aliases both aChannel and bChannel to
                        // GreenChannel, so its vibrance mask levels only Lab a.
                        uncorrected![offset + 1] = samples[offset + 1]!;
                        samples[offset + 1] = Math.max(0, Math.min(255, (samples[offset + 1]! * 257 - black) * scale * 255));
                        blendMaskedPixel(samples, uncorrected!, samples, offset, protection[offset / 4]!, 255, { r: false, g: true, b: false }, image.hasAlpha);
                    }
                }
            }
            if (pass === 1) {
                const conversion = convertHuePixels({ width: length / 4, height: 1, hasAlpha: image.hasAlpha,
                    channels: image.hasAlpha ? 4 : 3, space: "srgb", depth: "ushort", format: "raw", density: 72,
                    magickColorspace: "CIELab", data: new Uint8Array(length), hueSamples: Float64Array.from(samples, value => value / 255) }, "sRGB");
                let next = conversion.next();
                while (!next.done) { yield; next = conversion.next(); }
                const output = next.value;
                const rgb = output.evaluateSamples!;
                for (let offset = 0; offset < length; offset += 4)
                    blendMaskedPixel(rgb, samples, rgb, offset, protection[offset / 4]!, 255, undefined, image.hasAlpha);
                yield { kind: "write", highDepth: true, position, data: new Uint8Array(Uint16Array.from(rgb, value => Math.round(Math.max(0, Math.min(65535, value * 257)))).buffer) };
                yield { kind: "write", evaluate: true, position, data: new Uint8Array(rgb.buffer) };
            }
        }
        if (pass === 0) { a /= image.width * image.height; b /= image.width * image.height; }
    }
}
