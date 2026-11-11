import type { RgbaImage } from "@poe-code/image-ast/portable";
import type { HueMetadata } from "./colorspace-hue.js";

export function* setColorspacePixels(image: RgbaImage & HueMetadata, value: string): Generator<void, RgbaImage & HueMetadata, void> {
    const name = value.toLowerCase() === "lab" ? "cielab" : value.toLowerCase();
    const target = (["sRGB", "RGB", "scRGB", "CMYK", "HCL", "HCLp", "HSI", "HSL", "HSB", "HSV", "HWB", "DisplayP3", "XYZ", "CAT02LMS", "LMS", "xyY", "ProPhoto", "Jzazbz", "CIELab", "YPbPr", "YCbCr", "Rec601YCbCr", "YCC", "Rec709YCbCr", "Log", "Adobe98", "OHTA", "CMY", "YUV", "YIQ", "YDbDr", "Luv", "Oklab", "Oklch", "LCH", "LCHab", "LCHuv", "Gray", "LinearGray"] as const)
        .find(space => space.toLowerCase() === name);
    if (!target) return image;
    const gray = target === "Gray" || target === "LinearGray";
    const source = image.magickColorspace ?? (image.space === "cmyk" ? "CMYK" : image.space === "srgb" ? "sRGB" : undefined);
    if (target === source) return image;

    const { magickColorspace: ignoredSpace, hueSamples: ignoredHue, storedHueSamples: ignoredStoredHue, evaluateSamples: ignoredEvaluate, ...metadata } = image;
    const input = image.hueSamples ?? image.evaluateSamples ?? image.data16 ?? image.data;
    const range = image.hueSamples ? 1 : image.evaluateSamples ? 255 : image.data16 ? 65535 : 255;
    const alpha = image.evaluateSamples ?? image.data16 ?? image.data;
    const alphaRange = image.evaluateSamples ? 255 : image.data16 ? 65535 : 255;
    const data = new Uint8Array(image.data.length), data16 = new Uint16Array(data.length);
    const hueSamples = target === "RGB" || target === "scRGB" || target === "sRGB" || gray ? undefined : new Float64Array(data.length);
    const evaluateSamples = hueSamples && target !== "CMYK" ? undefined : new Float64Array(data.length);
    for (let offset = 0; offset < data.length; offset += 4) {
        if (offset % 65536 === 0) yield;
        for (let channel = 0; channel < 4; channel++) {
            let sample = channel === 3 ? alpha[offset + channel]! / alphaRange : input[offset + (gray ? 0 : channel)]! / range;
            // CMYK stores ink samples separately from its RGBA codec backing.
            // Declaring CMYK adds a zero black channel; alpha remains independent.
            if (hueSamples) hueSamples[offset + channel] = target === "CMYK" && channel === 3 ? 0 : sample;
            if (target === "CMYK" && channel !== 3) sample = 1 - sample;
            if (evaluateSamples) evaluateSamples[offset + channel] = sample * 255;
            data[offset + channel] = Math.round(Math.max(0, Math.min(1, sample)) * 255);
            data16[offset + channel] = Math.round(Math.max(0, Math.min(1, sample)) * 65535);
        }
    }
    return {
        ...metadata, data, data16, space: target === "CMYK" ? "cmyk" : gray ? "b-w" : "srgb",
        channels: target === "CMYK" ? 4 : gray ? image.hasAlpha ? 2 : 1 : image.hasAlpha ? 4 : 3,
        gamma: target === "RGB" || target === "scRGB" || target === "LinearGray" ? 1 : 1 / 2.2,
        ...(target === "sRGB" || target === "CMYK" || target === "LinearGray" ? {} : { magickColorspace: target }),
        ...(hueSamples ? { hueSamples } : {}), ...(evaluateSamples ? { evaluateSamples } : {}),
    };
}
