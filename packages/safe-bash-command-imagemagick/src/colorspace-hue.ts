import type { RgbaImage } from "@poe-code/image-ast/portable";
import { formatMetricNum } from "./compare-kernel.js";

export interface HueMetadata {
    magickColorspace?: "HCL" | "HCLp" | "HSL" | "HSB" | "HSV" | "HWB" | "XYZ" | "CIELab" | "YCbCr" | "OHTA" | "YUV" | "Luv" | "RGB";
    // Preserve native HDRI precision for expressions; codecs use the integer planes.
    hueSamples?: Float64Array;
    storedHueSamples?: number;
}

export function* convertHuePixels(image: RgbaImage & HueMetadata, target: "HCL" | "HCLp" | "HSL" | "HSB" | "HSV" | "HWB" | "XYZ" | "CIELab" | "YCbCr" | "OHTA" | "YUV" | "Luv" | "sRGB"): Generator<void, RgbaImage & HueMetadata, void> {
    if (image.magickColorspace === target) return image;
    const toHue = target !== "sRGB", hsb = toHue ? target === "HSB" || target === "HSV" : image.magickColorspace === "HSB" || image.magickColorspace === "HSV";
    const hwb = toHue ? target === "HWB" : image.magickColorspace === "HWB";
    const data = new Uint8Array(image.data.length), data16 = new Uint16Array(data.length);
    // Lab, Luv, YUV, YCbCr and OHTA need HDRI samples before integer rounding or clamping.
    const inputEvaluateSamples = target === "Luv" || target === "OHTA" || target === "CIELab" || target === "YUV" || target === "YCbCr" ? image.evaluateSamples : undefined;
    const input = image.hueSamples ?? inputEvaluateSamples ?? image.data16 ?? image.data, range = image.hueSamples ? 1 : inputEvaluateSamples ? 255 : image.data16 ? 65535 : 255;
    const hueSamples = toHue ? new Float64Array(data.length) : undefined;
    const evaluateSamples = toHue ? undefined : new Float64Array(data.length);
    for (let offset = 0; offset < data.length; offset += 4) {
        if (offset % 65536 === 0) yield;
        let r = input[offset]! / range, g = input[offset + 1]! / range, b = input[offset + 2]! / range;
        if (target === "OHTA" || image.magickColorspace === "OHTA") {
            // Native OHTA uses Q16 lookup tables in both directions. Its forward
            // chroma offset is 32768, while the inverse subtracts 32767.5.
            [r, g, b] = [r, g, b].map(value => Math.round(Math.max(0, Math.min(1, value)) * 65535) / 65535) as [number, number, number];
            [r, g, b] = target === "OHTA"
                ? [0.33333 * r + 0.33334 * g + 0.33333 * b,
                    32768 / 65535 + 0.5 * r - 0.5 * b,
                    32768 / 65535 - 0.25 * r + 0.5 * g - 0.25 * b]
                : [r + (g - 0.5) - 0.66668 * (b - 0.5),
                    r + 1.33333 * (b - 0.5),
                    r - (g - 0.5) - 0.66668 * (b - 0.5)];
        } else if (target === "YUV") {
            [r, g, b] = [0.298839 * r + 0.586811 * g + 0.11435 * b,
                0.5 - 0.147 * r - 0.289 * g + 0.436 * b,
                0.5 + 0.615 * r - 0.515 * g - 0.1 * b];
        } else if (image.magickColorspace === "YUV") {
            // ImageMagick's inverse includes cross-channel terms even near zero.
            [r, g, b] = [r - 3.945707070708279e-05 * (g - 0.5) + 1.1398279671717170825 * (b - 0.5),
                r - 0.3946101641414141437 * (g - 0.5) - 0.5805003156565656797 * (b - 0.5),
                r + 2.0319996843434342537 * (g - 0.5) - 4.813762626262513e-04 * (b - 0.5)];
        } else if (target === "YCbCr") {
            [r, g, b] = [0.298839 * r + 0.586811 * g + 0.11435 * b,
                0.5 - 0.1687367 * r - 0.331264 * g + 0.5 * b,
                0.5 + 0.5 * r - 0.418688 * g - 0.081312 * b];
        } else if (image.magickColorspace === "YCbCr") {
            // ImageMagick's inverse YPbPr matrix preserves Q16 rounding boundaries.
            [r, g, b] = [0.9999999999991468 * r - 1.2188941887145875e-6 * (g - 0.5) + 1.401999588656144 * (b - 0.5),
                0.9999997591050251 * r - 0.34413567816504304 * (g - 0.5) - 0.7141364933164679 * (b - 0.5),
                1.0000012404000462 * r + 1.772000066072304 * (g - 0.5) + 2.1453384174593273e-6 * (b - 0.5)];
        } else if (target === "XYZ" || target === "CIELab" || target === "Luv") {
            const linear = [r, g, b].map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
            [r, g, b] = [
                0.412395588967414 * linear[0]! + 0.357583430763715 * linear[1]! + 0.180492647381701 * linear[2]!,
                0.212586230785596 * linear[0]! + 0.715170303703411 * linear[1]! + 0.0722004986433362 * linear[2]!,
                0.0192972154917469 * linear[0]! + 0.119183864580849 * linear[1]! + 0.95049712513158 * linear[2]!,
            ];
            if (target === "CIELab") {
                const f = (value: number) => value > 216 / 24389 ? Math.cbrt(value) : (24389 / 27 * value + 16) / 116;
                const x = f(r / 0.95047), y = f(g), z = f(b / 1.08883);
                [r, g, b] = [(116 * y - 16) / 100, 500 * (x - y) / 255 + 0.5, 200 * (y - z) / 255 + 0.5];
            } else if (target === "Luv") {
                const lightness = g > 216 / 24389 ? 116 * Math.cbrt(g) - 16 : 24389 / 27 * g;
                const denominator = r + 15 * g + 3 * b;
                const u = denominator === 0 ? 0 : 4 * r / denominator;
                const v = denominator === 0 ? 0 : 9 * g / denominator;
                const white = 0.95047 + 15 + 3 * 1.08883;
                [r, g, b] = [lightness / 100, (13 * lightness * (u - 4 * 0.95047 / white) + 134) / 354,
                    (13 * lightness * (v - 9 / white) + 140) / 262];
            }
        } else if (image.magickColorspace === "XYZ" || image.magickColorspace === "CIELab" || image.magickColorspace === "Luv") {
            if (image.magickColorspace === "CIELab") {
                const y = (r * 100 + 16) / 116, x = (g - 0.5) * 255 / 500 + y, z = y - (b - 0.5) * 255 / 200;
                const inverse = (value: number) => value > 6 / 29 ? value ** 3 : (value - 16 / 116) * 108 / 841;
                [r, g, b] = [0.95047 * inverse(x), inverse(y), 1.08883 * inverse(z)];
            } else if (image.magickColorspace === "Luv") {
                const lightness = r * 100, white = 0.95047 + 15 + 3 * 1.08883;
                const u = lightness === 0 ? 0 : (g * 354 - 134) / (13 * lightness) + 4 * 0.95047 / white;
                const v = lightness === 0 ? 0 : (b * 262 - 140) / (13 * lightness) + 9 / white;
                const y = lightness > 8 ? ((lightness + 16) / 116) ** 3 : lightness * 27 / 24389;
                [r, g, b] = v === 0 ? [0, y, 0] : [9 * y * u / (4 * v), y, y * (12 - 3 * u - 20 * v) / (4 * v)];
            }
            const linear = [
                3.24096994190452 * r - 1.53738317757009 * g - 0.498610760293003 * b,
                -0.96924363628088 * r + 1.87596750150772 * g + 0.0415550574071756 * b,
                0.0556300796969937 * r - 0.203976958888977 * g + 1.05697151424288 * b,
            ];
            // ImageMagick shifts out-of-gamut linear channels together before encoding.
            const minimum = Math.min(0, ...linear);
            [r, g, b] = linear.map(sample => {
                const value = sample - minimum;
                return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
            }) as [number, number, number];
        } else if (!toHue && (image.magickColorspace === "HCL" || image.magickColorspace === "HCLp")) {
            const hue = r * 6, chroma = g, luma = b, x = chroma * (1 - Math.abs(hue % 2 - 1));
            [r, g, b] = hue < 0 || hue >= 6 ? [0, 0, 0] : hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
            let m = luma - (0.298839 * r + 0.586811 * g + 0.114350 * b), scale = 1;
            if (image.magickColorspace === "HCLp") {
                if (m < 0) { scale = luma / (luma - m); m = 0; }
                else if (m + chroma > 1) { scale = (1 - luma) / (m + chroma - luma); m = 1 - scale * chroma; }
            }
            r = scale * r + m; g = scale * g + m; b = scale * b + m;
        } else if (toHue) {
            const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, lightness = (max + min) / 2;
            const hue = !delta ? 0 : max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
            const hcl = target === "HCL" || target === "HCLp", luma = 0.298839 * r + 0.586811 * g + 0.114350 * b;
            // ImageMagick HWB uses -1 for achromatic hue, 1 for red, and an HDRI epsilon for zero blackness.
            r = hwb ? !delta ? -1 : hue === 0 ? 1 : hue / 6 : hue / 6; g = hcl ? delta : hwb ? min : delta ? delta / (hsb ? max : 1 - Math.abs(2 * lightness - 1)) : 0; b = hcl ? luma : hwb ? Math.max(2 ** -64, 1 - max) : hsb ? max : lightness;
        } else {
            // HSL arithmetic can move hue outside one turn in either direction.
            if (image.magickColorspace === "HSL") r -= Math.floor(r);
            // Edited HWB channels can sum above one; native preserves the negative chroma.
            const hue = (r < 0 || r === 1 ? 0 : r) * 6, chroma = hwb ? 1 - g - b : (hsb ? b : 1 - Math.abs(2 * b - 1)) * g, x = chroma * (1 - Math.abs(hue % 2 - 1)), m = hwb ? g : b - chroma / (hsb ? 1 : 2);
            [r, g, b] = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
            r += m; g += m; b += m;
        }
        for (const [channel, sample] of [r, g, b, input[offset + 3]! / range].entries()) {
            // Q16-HDRI stores Lab conversion results as float quantum samples.
            const value = target === "CIELab" || image.magickColorspace === "CIELab" ? Math.fround(sample * 65535) / 65535 : sample;
            if (hueSamples) hueSamples[offset + channel] = value;
            if (evaluateSamples) evaluateSamples[offset + channel] = value * 255;
            data16[offset + channel] = Math.round(Math.max(0, Math.min(1, value)) * 65535);
            data[offset + channel] = Math.round(Math.max(0, Math.min(1, value)) * 255);
        }
    }
    const { magickColorspace: ignored, hueSamples: ignoredSamples, storedHueSamples: ignoredStored, evaluateSamples: ignoredEvaluate, ...metadata } = image;
    return { ...metadata, data, data16, ...(evaluateSamples ? { evaluateSamples } : {}), space: "srgb", channels: image.hasAlpha ? 4 : 3, ...(hueSamples ? { magickColorspace: target as "HCL" | "HCLp" | "HSL" | "HSB" | "HSV" | "HWB" | "XYZ" | "CIELab" | "YCbCr" | "OHTA" | "YUV" | "Luv", hueSamples } : {}) };
}

export function formatHuePixel(channels: readonly number[], space: "HCL" | "HCLp" | "HSL" | "HSB" | "HSV" | "HWB" | "XYZ" | "CIELab" | "YCbCr" | "OHTA" | "YUV" | "Luv", hasAlpha: boolean): string {
    if (space === "CIELab") return `cielab${hasAlpha ? "a" : ""}(${channels.slice(0, 3).map((value, index) => Number((index === 0 ? value * 100 : (value - 0.5) * 255).toPrecision(6))).join(",")}${hasAlpha ? `,${formatMetricNum(channels[3] ?? 1)}` : ""})`;
    if (space === "XYZ") return `xyz${hasAlpha ? "a" : ""}(${channels.slice(0, 3).map(value => Number((value * 100).toPrecision(6))).join(",")}${hasAlpha ? `,${formatMetricNum(channels[3] ?? 1)}` : ""})`;
    if (space === "HWB" || space === "YCbCr" || space === "OHTA" || space === "YUV" || space === "Luv") return `${space.toLowerCase()}${hasAlpha ? "a" : ""}(${channels.slice(0, 3).map(value => Number((value * 255).toPrecision(6))).join(",")}${hasAlpha ? `,${formatMetricNum(channels[3] ?? 1)}` : ""})`;
    return `${space.toLowerCase()}${hasAlpha ? "a" : ""}(${Number((channels[0]! * 360).toPrecision(6))},${Number((channels[1]! * 100).toPrecision(6))}%,${Number((channels[2]! * 100).toPrecision(6))}%${hasAlpha ? `,${formatMetricNum(channels[3] ?? 1)}` : ""})`;
}

export function* prepareHueOutput(image: RgbaImage & HueMetadata, format: string): Generator<void, RgbaImage & HueMetadata, void> {
    if (image.magickColorspace === "CIELab" && format === "tiff") throw new Error("unsupported colorspace 'Lab' for TIFF output");
    if (image.magickColorspace !== "CIELab" && image.magickColorspace !== "HCL" && image.magickColorspace !== "HCLp" && image.magickColorspace !== "HSL" && image.magickColorspace !== "HSB" && image.magickColorspace !== "HSV" && image.magickColorspace !== "HWB" && image.magickColorspace !== "XYZ" && image.magickColorspace !== "YCbCr" && image.magickColorspace !== "OHTA" && image.magickColorspace !== "YUV" && image.magickColorspace !== "Luv") return image;
    if (format === "tiff" || format === "raw") {
        const { magickColorspace: ignored, hueSamples: ignoredSamples, storedHueSamples: ignoredStored, ...output } = image;
        return output;
    }
    return yield* convertHuePixels(image, "sRGB");
}

export function hueTextPixel(values: readonly number[], hasAlpha: boolean, space: "HCL" | "HCLp" | "HSL" | "HSB" | "HSV" | "HWB" | "XYZ" | "CIELab" | "YCbCr" | "OHTA" | "YUV" | "Luv", samples?: readonly number[], maximum = 65535): string {
    const channels = values.slice(0, hasAlpha ? 4 : 3).map(value => Math.round(value * maximum / 65535));
    const color = formatHuePixel((space === "HCL" || space === "HCLp" || space === "HSL" || space === "HWB" || space === "XYZ" || space === "CIELab" || space === "YCbCr" || space === "OHTA" || space === "YUV" || space === "Luv") && samples ? samples : values.map(value => value / 65535), space, true);
    const spelling = hasAlpha ? color : `${space.toLowerCase()}(${color.slice(color.indexOf("(") + 1, color.lastIndexOf(","))})`;
    return `(${channels.join(",")})  #${channels.map(value => value.toString(16).toUpperCase().padStart(maximum === 255 ? 2 : 4, "0")).join("")}  ${spelling}`;
}
