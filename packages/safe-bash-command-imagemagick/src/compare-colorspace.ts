import type { RgbaImage } from "@poe-code/image-ast/portable";
import { rgbToCmyk } from "./colorspace-cmyk.js";
import { convertHuePixels, type HueMetadata } from "./colorspace-hue.js";

type CompareRaster = RgbaImage & HueMetadata & { evaluateSamples?: Float64Array | undefined };

export function* compareColorspaceSteps(image: CompareRaster, target: string): Generator<void, CompareRaster, void> {
    const current = image.space === "cmyk" ? "cmyk" : image.magickColorspace?.toLowerCase() ?? (image.space === "b-w" || image.space === "grey16" ? "gray" : "srgb");
    if (current === target || current === "cielab" && target === "lab") return image;
    if (image.magickColorspace && image.magickColorspace !== "RGB" && image.magickColorspace !== "scRGB") image = yield* convertHuePixels(image, "sRGB");
    const { hueSamples: ignoredHue, evaluateSamples: ignoredEvaluate, magickColorspace: ignoredSpace, ...metadata } = image;
    const source = image.space === "cmyk" ? image.data16 ?? image.data : image.evaluateSamples ?? image.hueSamples ?? image.data16 ?? image.data;
    const range = source === image.hueSamples ? 1 : source === image.data16 ? 65535 : 255;
    const samples = Float64Array.from(source, value => value / range);
    for (let offset = 0; offset < samples.length; offset += 4) {
        if (offset % 65536 === 0) yield;
        for (let channel = 0; channel < 3; channel++) {
            let value = samples[offset + channel]!;
            if (current === "rgb" || current === "scrgb") value = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
            if (target === "rgb") value = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            samples[offset + channel] = Math.fround(value * 65535) / 65535;
        }
        if (target === "gray") samples[offset] = samples[offset + 1] = samples[offset + 2] =
            Math.fround((0.212656 * samples[offset]! + 0.715158 * samples[offset + 1]! + 0.072186 * samples[offset + 2]!) * 65535) / 65535;
    }
    const data = Uint8Array.from(samples, value => Math.max(0, Math.min(255, Math.round(value * 255))));
    const data16 = Uint16Array.from(samples, value => Math.max(0, Math.min(65535, Math.round(value * 65535))));
    const rgb: CompareRaster = { ...metadata, data, data16, hueSamples: samples, space: "srgb", channels: image.hasAlpha ? 4 : 3 };
    if (target === "lab") return yield* convertHuePixels(rgb, "CIELab");
    if (target === "cmyk") {
        const inks = new Float64Array(samples.length);
        for (let offset = 0; offset < inks.length; offset += 4) {
            if (offset % 65536 === 0) yield;
            inks.set(rgbToCmyk(samples[offset]!, samples[offset + 1]!, samples[offset + 2]!).map(value => Math.fround(value * 65535) / 65535), offset);
        }
        return { ...rgb, space: "cmyk", channels: 4, hueSamples: inks };
    }
    return { ...rgb, ...(target === "rgb" ? { magickColorspace: "RGB" as const } : {}),
        ...(target === "gray" ? { space: "b-w" as const, channels: image.hasAlpha ? 2 : 1 } : {}) };
}

export function* compareDiffSteps(samples: Float64Array, space?: string, magickColorspace?: string, highDepth = false): Generator<void, Pick<RgbaImage, "data" | "data16">, void> {
    if (space === "cmyk") {
        const rgb = new Float64Array(samples.length / 5 * 4);
        for (let pixel = 0; pixel < rgb.length / 4; pixel++) {
            if (pixel % 16384 === 0) yield;
            for (let channel = 0; channel < 3; channel++) rgb[pixel * 4 + channel] = (255 - samples[pixel * 5 + channel]!) * (1 - samples[pixel * 5 + 4]! / 255);
            rgb[pixel * 4 + 3] = samples[pixel * 5 + 3]!;
        }
        samples = rgb;
    }
    if (magickColorspace === "CIELab") {
        const converted = yield* convertHuePixels({ width: samples.length / 4, height: 1, data: new Uint8Array(samples.length),
            hueSamples: Float64Array.from(samples, value => value / 255), magickColorspace: "CIELab",
            format: "png", space: "srgb", channels: 4, hasAlpha: true, depth: "uchar", density: 72 }, "sRGB");
        return { data: converted.data, ...(highDepth && converted.data16 ? { data16: converted.data16 } : {}) };
    }
    return { data: Uint8Array.from(samples, value => Math.max(0, Math.min(255, Math.round(value)))),
        ...(highDepth ? { data16: Uint16Array.from(samples, value => Math.max(0, Math.min(65535, Math.round(value * 257)))) } : {}) };
}
