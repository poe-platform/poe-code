import type { RgbaImage } from "@poe-code/image-ast/portable";
import type { HueMetadata } from "./colorspace-hue.js";
import { convertCmykPixels } from "./colorspace-cmyk.js";

export function* tintCmykPixels(image: RgbaImage & HueMetadata, vector: readonly number[]): Generator<void, RgbaImage & HueMetadata, void> {
    image = yield* convertCmykPixels(image);
    const hueSamples = image.hueSamples!.slice();
    const data = image.data.slice();
    const data16 = image.data16?.slice() ?? Uint16Array.from(data, value => value * 257);
    const evaluateSamples = image.evaluateSamples?.slice() ?? Float64Array.from(data16, value => value / 257);
    for (let offset = 0; offset < data.length; offset += 4) {
        if (offset % 65536 === 0) yield;
        // Tint all four inks in Q16-HDRI; alpha stays in the RGBA backing.
        for (let channel = 0; channel < 4; channel++) {
            const value = hueSamples[offset + channel]!;
            const weight = value - 0.5;
            hueSamples[offset + channel] = Math.fround((value + vector[channel]! / 255 * (1 - 4 * weight * weight)) * 65535) / 65535;
        }
        // Keep unbounded inks for subsequent operations; clamp only encoding views.
        for (let channel = 0; channel < 3; channel++) {
            const value = Math.fround((1 - hueSamples[offset + channel]!) * (1 - hueSamples[offset + 3]!) * 65535);
            evaluateSamples[offset + channel] = value / 257;
            data16[offset + channel] = Math.round(Math.max(0, Math.min(65535, value)));
            data[offset + channel] = Math.round(Math.max(0, Math.min(255, value / 257)));
        }
    }
    return { ...image, data, data16, hueSamples, evaluateSamples };
}
