import type { RgbaImage } from "@poe-code/image-ast/portable";
import { formatMetricNum } from "./compare-kernel.js";

export interface HslMetadata {
    magickColorspace?: "HSL" | "RGB";
    // Preserve native HDRI precision for expressions; codecs use the integer planes.
    hslSamples?: Float64Array;
    storedHslSamples?: number;
}

export function* convertHslPixels(image: RgbaImage & HslMetadata, toHsl: boolean): Generator<void, RgbaImage & HslMetadata, void> {
    if ((image.magickColorspace === "HSL") === toHsl) return image;
    const data = new Uint8Array(image.data.length), data16 = new Uint16Array(data.length);
    const input = image.hslSamples ?? image.data16 ?? image.data, range = image.hslSamples ? 1 : image.data16 ? 65535 : 255;
    const hslSamples = toHsl ? new Float64Array(data.length) : undefined;
    for (let offset = 0; offset < data.length; offset += 4) {
        if (offset % 65536 === 0) yield;
        let r = input[offset]! / range, g = input[offset + 1]! / range, b = input[offset + 2]! / range;
        if (toHsl) {
            const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, lightness = (max + min) / 2;
            const hue = !delta ? 0 : max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
            r = hue / 6; g = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0; b = lightness;
        } else {
            const hue = r * 6, chroma = (1 - Math.abs(2 * b - 1)) * g, x = chroma * (1 - Math.abs(hue % 2 - 1)), m = b - chroma / 2;
            [r, g, b] = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
            r += m; g += m; b += m;
        }
        for (const [channel, value] of [r, g, b, input[offset + 3]! / range].entries()) {
            if (hslSamples) hslSamples[offset + channel] = value;
            data16[offset + channel] = Math.round(value * 65535);
            data[offset + channel] = Math.round(value * 255);
        }
    }
    const { magickColorspace: ignored, hslSamples: ignoredSamples, storedHslSamples: ignoredStored, ...metadata } = image;
    return { ...metadata, data, data16, space: "srgb", channels: image.hasAlpha ? 4 : 3, ...(hslSamples ? { magickColorspace: "HSL", hslSamples } : {}) };
}

export function formatHslPixel(channels: readonly number[]): string {
    return `hsla(${Number((channels[0]! * 360).toPrecision(6))},${Number((channels[1]! * 100).toPrecision(6))}%,${Number((channels[2]! * 100).toPrecision(6))}%,${formatMetricNum(channels[3] ?? 1)})`;
}

export function* prepareHslOutput(image: RgbaImage & HslMetadata, format: string): Generator<void, RgbaImage & HslMetadata, void> {
    if (image.magickColorspace !== "HSL") return image;
    if (format === "tiff" || format === "raw") {
        const { magickColorspace: ignored, hslSamples: ignoredSamples, storedHslSamples: ignoredStored, ...output } = image;
        return output;
    }
    return yield* convertHslPixels(image, false);
}

export function hslTextPixel(values: readonly number[], hasAlpha: boolean): string {
    const channels = values.slice(0, hasAlpha ? 4 : 3);
    const color = formatHslPixel(values.map(value => value / 65535));
    const spelling = hasAlpha ? color : `hsl(${color.slice(5, color.lastIndexOf(","))})`;
    return `(${channels.join(",")})  #${channels.map(value => value.toString(16).toUpperCase().padStart(4, "0")).join("")}  ${spelling}`;
}
