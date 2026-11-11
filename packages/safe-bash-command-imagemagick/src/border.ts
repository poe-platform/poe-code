import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";

export function* borderPixels(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "evaluateSamples" | "space" | "hueSamples"> & Partial<Pick<StoredRgbaImage, "storedEvaluateSamples" | "storedHueSamples">> & { inactiveAlpha?: boolean | undefined }, left: number, top: number, color: RgbaColor & { cmyk?: readonly number[] }, highDepth: boolean, bottom = top, channels?: readonly boolean[]): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const width = image.width + left * 2, height = image.height + top + bottom;
    const cmyk = image.space === "cmyk";
    const backgroundInks = color.cmyk ?? [color.r / 255, color.g / 255, color.b / 255, 0];
    const hue = !cmyk && (!!image.hueSamples || image.storedHueSamples !== undefined);
    const evaluate = !hue && (!!image.evaluateSamples || image.storedEvaluateSamples !== undefined);
    const maximum = highDepth ? 65535 : 255;
    const background = [color.r, color.g, color.b, color.a].map(value => Math.round(value * maximum / 255));
    // Four Float64 channels per pixel must fit the 16 KiB retained read limit.
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x += 512) {
        yield;
        const count = Math.min(512, width - x);
        const data = highDepth ? new Uint16Array(count * 4) : new Uint8Array(count * 4);
        const inks = cmyk ? new Float64Array(count * 4) : undefined;
        const samples = new Float64Array(count * 4);
        for (let pixel = 0; pixel < count; pixel++) {
            data.set(background, pixel * 4);
            inks?.set(backgroundInks, pixel * 4);
            samples.set([color.r, color.g, color.b, color.a], pixel * 4);
        }
        const first = Math.max(x, left), end = Math.min(x + count, left + image.width), sy = y - top;
        if (sy >= 0 && sy < image.height && first < end) {
            const bytes = yield { kind: "read", position: (sy * image.width + first - left) * 4, length: (end - first) * 4, highDepth, evaluate, hue };
            if (!bytes) throw new Error("Missing border source pixels");
            const source = hue || evaluate ? new Float64Array(bytes.slice().buffer).map(value => value * maximum / (hue ? 1 : 255)) : highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
            const inkBytes = cmyk ? yield { kind: "read", hue: true, position: (sy * image.width + first - left) * 4, length: (end - first) * 4 } : undefined;
            const sourceInks = inkBytes?.length ? new Float64Array(inkBytes.slice().buffer) : undefined;
            for (let pixel = first; pixel < end; pixel++) {
                const src = (pixel - first) * 4, dst = (pixel - x) * 4;
                const alpha = image.hasAlpha || image.inactiveAlpha ? source[src + 3]! / maximum : 1, behind = background[3]! / maximum * (1 - alpha), combined = alpha + behind;
                for (let channel = 0; channel < 4; channel++) {
                    if (channels?.[channel] === false) continue;
                    // Native Over clamps each composited channel, including retained HDRI samples.
                    const value = Math.max(0, Math.min(maximum, channel === 3 ? combined * maximum : combined
                        ? (source[src + channel]! * alpha + background[channel]! * behind) / combined : 0));
                    data[dst + channel] = Math.round(value);
                    if (inks && sourceInks) inks[dst + channel] = combined
                        ? (sourceInks[src + channel]! * alpha + backgroundInks[channel]! * behind) / combined : backgroundInks[channel]!;
                    // Blending creates fractional Q16-HDRI samples even from 8-bit inputs.
                    samples[dst + channel] = Math.fround(value * 65535 / maximum) / 257;
                }
            }
        }
        if (inks) {
            for (let pixel = 0; pixel < count; pixel++) for (let channel = 0; channel < 3; channel++) {
                const offset = pixel * 4;
                const value = (1 - inks[offset + channel]!) * (1 - inks[offset + 3]!) * 255;
                data[offset + channel] = Math.round(value * maximum / 255);
                samples[offset + channel] = value;
            }
            yield { kind: "write", hue: true, position: (y * width + x) * 4, data: new Uint8Array(inks.buffer) };
        }
        yield { kind: "write", position: (y * width + x) * 4, data: new Uint8Array((hue ? samples.map(value => value / 255) : samples).buffer), evaluate: !hue, hue };
        yield { kind: "write", position: (y * width + x) * 4, data: new Uint8Array(data.buffer), highDepth };
    }
}
