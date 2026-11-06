import type { RgbaImage } from "@poe-code/image-ast/portable";
import { formatMetricNum } from "./compare-kernel.js";

export interface HueMetadata {
    magickColorspace?: "HSL" | "HSB" | "HWB" | "RGB";
    // Preserve native HDRI precision for expressions; codecs use the integer planes.
    hueSamples?: Float64Array;
    storedHueSamples?: number;
}

export function* convertHuePixels(image: RgbaImage & HueMetadata, target: "HSL" | "HSB" | "HWB" | "sRGB"): Generator<void, RgbaImage & HueMetadata, void> {
    if (image.magickColorspace === target) return image;
    const toHue = target !== "sRGB", hsb = toHue ? target === "HSB" : image.magickColorspace === "HSB";
    const hwb = toHue ? target === "HWB" : image.magickColorspace === "HWB";
    const data = new Uint8Array(image.data.length), data16 = new Uint16Array(data.length);
    const input = image.hueSamples ?? image.data16 ?? image.data, range = image.hueSamples ? 1 : image.data16 ? 65535 : 255;
    const hueSamples = toHue ? new Float64Array(data.length) : undefined;
    for (let offset = 0; offset < data.length; offset += 4) {
        if (offset % 65536 === 0) yield;
        let r = input[offset]! / range, g = input[offset + 1]! / range, b = input[offset + 2]! / range;
        if (toHue) {
            const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, lightness = (max + min) / 2;
            const hue = !delta ? 0 : max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
            // ImageMagick HWB uses -1 for achromatic hue, 1 for red, and an HDRI epsilon for zero blackness.
            r = hwb ? !delta ? -1 : hue === 0 ? 1 : hue / 6 : hue / 6; g = hwb ? min : delta ? delta / (hsb ? max : 1 - Math.abs(2 * lightness - 1)) : 0; b = hwb ? Math.max(2 ** -64, 1 - max) : hsb ? max : lightness;
        } else {
            const hue = (r < 0 || r === 1 ? 0 : r) * 6, chroma = hwb ? Math.max(0, 1 - g - b) : (hsb ? b : 1 - Math.abs(2 * b - 1)) * g, x = chroma * (1 - Math.abs(hue % 2 - 1)), m = hwb ? g : b - chroma / (hsb ? 1 : 2);
            [r, g, b] = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
            r += m; g += m; b += m;
        }
        for (const [channel, value] of [r, g, b, input[offset + 3]! / range].entries()) {
            if (hueSamples) hueSamples[offset + channel] = value;
            data16[offset + channel] = Math.round(Math.max(0, Math.min(1, value)) * 65535);
            data[offset + channel] = Math.round(Math.max(0, Math.min(1, value)) * 255);
        }
    }
    const { magickColorspace: ignored, hueSamples: ignoredSamples, storedHueSamples: ignoredStored, ...metadata } = image;
    return { ...metadata, data, data16, space: "srgb", channels: image.hasAlpha ? 4 : 3, ...(hueSamples ? { magickColorspace: target as "HSL" | "HSB" | "HWB", hueSamples } : {}) };
}

export function formatHuePixel(channels: readonly number[], space: "HSL" | "HSB" | "HWB", hasAlpha: boolean): string {
    if (space === "HWB") return `hwb${hasAlpha ? "a" : ""}(${channels.slice(0, 3).map(value => Number((value * 255).toPrecision(6))).join(",")}${hasAlpha ? `,${formatMetricNum(channels[3] ?? 1)}` : ""})`;
    const alpha = space === "HSL" || hasAlpha;
    return `${space.toLowerCase()}${alpha ? "a" : ""}(${Number((channels[0]! * 360).toPrecision(6))},${Number((channels[1]! * 100).toPrecision(6))}%,${Number((channels[2]! * 100).toPrecision(6))}%${alpha ? `,${formatMetricNum(channels[3] ?? 1)}` : ""})`;
}

export function* prepareHueOutput(image: RgbaImage & HueMetadata, format: string): Generator<void, RgbaImage & HueMetadata, void> {
    if (image.magickColorspace !== "HSL" && image.magickColorspace !== "HSB" && image.magickColorspace !== "HWB") return image;
    if (format === "tiff" || format === "raw") {
        const { magickColorspace: ignored, hueSamples: ignoredSamples, storedHueSamples: ignoredStored, ...output } = image;
        return output;
    }
    return yield* convertHuePixels(image, "sRGB");
}

export function hueTextPixel(values: readonly number[], hasAlpha: boolean, space: "HSL" | "HSB" | "HWB", samples?: readonly number[]): string {
    const channels = values.slice(0, hasAlpha ? 4 : 3);
    const color = formatHuePixel(space === "HWB" && samples ? samples : values.map(value => value / 65535), space, true);
    const spelling = hasAlpha ? color : `${space.toLowerCase()}(${color.slice(5, color.lastIndexOf(","))})`;
    return `(${channels.join(",")})  #${channels.map(value => value.toString(16).toUpperCase().padStart(4, "0")).join("")}  ${spelling}`;
}
