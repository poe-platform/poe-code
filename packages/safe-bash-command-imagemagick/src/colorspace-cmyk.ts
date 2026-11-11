import type { RgbaImage } from "@poe-code/image-ast/portable";
import type { HueMetadata } from "./colorspace-hue.js";
import { formatSignificantMetric } from "./compare-kernel.js";

export function rgbToCmyk(r: number, g: number, b: number): number[] {
    const maximum = Math.max(r, g, b);
    // Q16-HDRI stores converted inks as float quantum samples before export.
    return maximum === 0 ? [0, 0, 0, 1] : [1 - r / maximum, 1 - g / maximum, 1 - b / maximum, 1 - maximum]
        .map(value => Math.fround(value * 65535) / 65535);
}

export function* fillCmykPixels(image: RgbaImage & HueMetadata, inks: readonly number[]): Generator<void, RgbaImage & HueMetadata, void> {
    const hueSamples = new Float64Array(image.data.length);
    const data16 = new Uint16Array(image.data.length);
    const evaluateSamples = new Float64Array(image.data.length);
    const rgb = inks.slice(0, 3).map(ink => (1 - ink) * (1 - inks[3]!) * 255);
    for (let offset = 0; offset < image.data.length; offset += 4) {
        if (offset % 65536 === 0) yield;
        hueSamples.set(inks, offset);
        for (let channel = 0; channel < 4; channel++) {
            const value = channel === 3 ? image.data[offset + channel]! : rgb[channel]!;
            evaluateSamples[offset + channel] = value;
            data16[offset + channel] = Math.round(value * 257);
            image.data[offset + channel] = Math.round(value);
        }
    }
    return { ...image, data16, evaluateSamples, space: "cmyk", channels: 4, hueSamples };
}

export function* convertCmykPixels(image: RgbaImage & HueMetadata): Generator<void, RgbaImage & HueMetadata, void> {
    if (image.space === "cmyk" && image.hueSamples) return image;
    // The codec backing remains RGBA; the working plane holds C, M, Y and K.
    // Alpha stays in the backing, independent of the fourth ink channel.
    const hueSamples = new Float64Array(image.data.length);
    // Fractional inks need a Q16 backing for separation and later RGB operations.
    const data16 = image.data16 ?? Uint16Array.from(image.data, value => value * 257);
    // Convert HDRI RGB samples before clamping the exported ink channels.
    const input = image.evaluateSamples ?? image.data16 ?? image.data, range = image.evaluateSamples ? 255 : image.data16 ? 65535 : 255;
    for (let offset = 0; offset < input.length; offset += 4) {
        if (offset % 65536 === 0) yield;
        hueSamples.set(rgbToCmyk(input[offset]! / range, input[offset + 1]! / range, input[offset + 2]! / range), offset);
    }
    return { ...image, isPalette: false, data16, space: "cmyk", channels: 4, hueSamples };
}

/** Mixed append copies ink channels into the sRGB canvas without converting them. */
export function* copyCmykChannelsToRgb(image: RgbaImage & HueMetadata): Generator<void, RgbaImage, void> {
    const { hueSamples, storedHueSamples: ignoredStored, ...metadata } = yield* convertCmykPixels(image);
    const data = new Uint8Array(image.data), data16 = image.data16?.slice();
    for (let offset = 0; offset < data.length; offset += 4) {
        if (offset % 65536 === 0) yield;
        for (let channel = 0; channel < 3; channel++) {
            const value = hueSamples![offset + channel]!;
            data[offset + channel] = Math.max(0, Math.min(255, Math.round(value * 255)));
            if (data16) data16[offset + channel] = Math.max(0, Math.min(65535, Math.round(value * 65535)));
        }
    }
    return { ...metadata, data, ...(data16 ? { data16 } : {}), space: "srgb", channels: image.hasAlpha ? 4 : 3 };
}

export function formatCmykPixel(channels: readonly number[], hasAlpha: boolean, precision?: number): string {
    return `cmyk${hasAlpha ? "a" : ""}(${channels.slice(0, 4).map(value => formatSignificantMetric(value * 255, precision)).join(",")}${hasAlpha ? `,${formatSignificantMetric(channels[4] ?? 1, precision)}` : ""})`;
}

/** Apply Q16 stretch maps to inks while keeping alpha in the RGBA backing. */
export function* applyCmykLookup(image: RgbaImage & HueMetadata, lookup: readonly (Uint8Array | Uint16Array | Float32Array)[], active: readonly boolean[]): Generator<void, RgbaImage & HueMetadata, void> {
    const hueSamples = image.hueSamples!.slice();
    const data = new Uint8Array(image.data);
    const data16 = new Uint16Array(data.length);
    const evaluateSamples = new Float64Array(data.length);
    for (let offset = 0; offset < data.length; offset += 4) {
        if (offset % 65536 === 0) yield;
        for (let channel = 0; channel < 4; channel++) {
            if (!active[channel === 3 ? 4 : channel]) continue;
            const value = Math.round(Math.max(0, Math.min(65535, Math.fround(hueSamples[offset + channel]! * 65535))));
            hueSamples[offset + channel] = lookup[channel === 3 ? 4 : channel]![value]! / 65535;
        }
        const alpha = image.evaluateSamples ? image.evaluateSamples[offset + 3]! * 257 : image.data16?.[offset + 3] ?? image.data[offset + 3]! * 257;
        for (let channel = 0; channel < 4; channel++) {
            const value = channel === 3 ? active[3] ? lookup[3]![Math.round(Math.max(0, Math.min(65535, alpha)))]! : alpha
                : Math.fround((1 - hueSamples[offset + channel]!) * (1 - hueSamples[offset + 3]!) * 65535);
            evaluateSamples[offset + channel] = value / 257;
            data16[offset + channel] = Math.max(0, Math.min(65535, Math.round(value)));
            data[offset + channel] = Math.max(0, Math.min(255, Math.round(value / 257)));
        }
    }
    return { ...image, hueSamples, data, data16, evaluateSamples };
}
