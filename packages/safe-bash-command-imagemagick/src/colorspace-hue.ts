import type { RgbaImage } from "@poe-code/image-ast/portable";
import { formatMetricNum } from "./compare-kernel.js";

export interface HueMetadata {
    magickColorspace?: "HSL" | "HSB" | "HWB" | "XYZ" | "YCbCr" | "RGB";
    // Preserve native HDRI precision for expressions; codecs use the integer planes.
    hueSamples?: Float64Array;
    storedHueSamples?: number;
}

export function* convertHuePixels(image: RgbaImage & HueMetadata, target: "HSL" | "HSB" | "HWB" | "XYZ" | "YCbCr" | "sRGB"): Generator<void, RgbaImage & HueMetadata, void> {
    if (image.magickColorspace === target) return image;
    const toHue = target !== "sRGB", hsb = toHue ? target === "HSB" : image.magickColorspace === "HSB";
    const hwb = toHue ? target === "HWB" : image.magickColorspace === "HWB";
    const data = new Uint8Array(image.data.length), data16 = new Uint16Array(data.length);
    const input = image.hueSamples ?? image.data16 ?? image.data, range = image.hueSamples ? 1 : image.data16 ? 65535 : 255;
    const hueSamples = toHue ? new Float64Array(data.length) : undefined;
    for (let offset = 0; offset < data.length; offset += 4) {
        if (offset % 65536 === 0) yield;
        let r = input[offset]! / range, g = input[offset + 1]! / range, b = input[offset + 2]! / range;
        if (target === "YCbCr") {
            [r, g, b] = [0.298839 * r + 0.586811 * g + 0.11435 * b,
                0.5 - 0.1687367 * r - 0.331264 * g + 0.5 * b,
                0.5 + 0.5 * r - 0.418688 * g - 0.081312 * b];
        } else if (image.magickColorspace === "YCbCr") {
            [r, g, b] = [r + 1.402 * (b - 0.5),
                r - 0.344136 * (g - 0.5) - 0.714136 * (b - 0.5),
                r + 1.772 * (g - 0.5)];
        } else if (target === "XYZ") {
            const linear = [r, g, b].map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
            [r, g, b] = [
                0.412395588967414 * linear[0]! + 0.357583430763715 * linear[1]! + 0.180492647381701 * linear[2]!,
                0.212586230785596 * linear[0]! + 0.715170303703411 * linear[1]! + 0.0722004986433362 * linear[2]!,
                0.0192972154917469 * linear[0]! + 0.119183864580849 * linear[1]! + 0.95049712513158 * linear[2]!,
            ];
        } else if (image.magickColorspace === "XYZ") {
            const linear = [
                3.24096994190452 * r - 1.53738317757009 * g - 0.498610760293003 * b,
                -0.96924363628088 * r + 1.87596750150772 * g + 0.0415550574071756 * b,
                0.0556300796969937 * r - 0.203976958888977 * g + 1.05697151424288 * b,
            ].map(value => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055);
            [r, g, b] = [linear[0]!, linear[1]!, linear[2]!];
        } else if (toHue) {
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
    return { ...metadata, data, data16, space: "srgb", channels: image.hasAlpha ? 4 : 3, ...(hueSamples ? { magickColorspace: target as "HSL" | "HSB" | "HWB" | "XYZ" | "YCbCr", hueSamples } : {}) };
}

export function formatHuePixel(channels: readonly number[], space: "HSL" | "HSB" | "HWB" | "XYZ" | "YCbCr", hasAlpha: boolean): string {
    if (space === "XYZ") return `xyz${hasAlpha ? "a" : ""}(${channels.slice(0, 3).map(value => Number((value * 100).toPrecision(6))).join(",")}${hasAlpha ? `,${formatMetricNum(channels[3] ?? 1)}` : ""})`;
    if (space === "HWB" || space === "YCbCr") return `${space.toLowerCase()}${hasAlpha ? "a" : ""}(${channels.slice(0, 3).map(value => Number((value * 255).toPrecision(6))).join(",")}${hasAlpha ? `,${formatMetricNum(channels[3] ?? 1)}` : ""})`;
    const alpha = space === "HSL" || hasAlpha;
    return `${space.toLowerCase()}${alpha ? "a" : ""}(${Number((channels[0]! * 360).toPrecision(6))},${Number((channels[1]! * 100).toPrecision(6))}%,${Number((channels[2]! * 100).toPrecision(6))}%${alpha ? `,${formatMetricNum(channels[3] ?? 1)}` : ""})`;
}

export function* prepareHueOutput(image: RgbaImage & HueMetadata, format: string): Generator<void, RgbaImage & HueMetadata, void> {
    if (image.magickColorspace !== "HSL" && image.magickColorspace !== "HSB" && image.magickColorspace !== "HWB" && image.magickColorspace !== "XYZ" && image.magickColorspace !== "YCbCr") return image;
    if (format === "tiff" || format === "raw") {
        const { magickColorspace: ignored, hueSamples: ignoredSamples, storedHueSamples: ignoredStored, ...output } = image;
        return output;
    }
    return yield* convertHuePixels(image, "sRGB");
}

export function hueTextPixel(values: readonly number[], hasAlpha: boolean, space: "HSL" | "HSB" | "HWB" | "XYZ" | "YCbCr", samples?: readonly number[]): string {
    const channels = values.slice(0, hasAlpha ? 4 : 3);
    const color = formatHuePixel((space === "HWB" || space === "XYZ" || space === "YCbCr") && samples ? samples : values.map(value => value / 65535), space, true);
    const spelling = hasAlpha ? color : `${space.toLowerCase()}(${color.slice(color.indexOf("(") + 1, color.lastIndexOf(","))})`;
    return `(${channels.join(",")})  #${channels.map(value => value.toString(16).toUpperCase().padStart(4, "0")).join("")}  ${spelling}`;
}
