import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";

/** Directional hull smoothing with the native zero border and Q16 step size. */
export function* despecklePixelSteps(image: { alphaSeparate?: boolean | undefined } & Pick<RgbaImage, "width" | "height" | "hasAlpha" | "space" | "hueSamples" | "evaluateSamples"> & Partial<Pick<StoredRgbaImage, "storedHueSamples" | "storedEvaluateSamples">>, channels?: readonly boolean[]): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, stride = width + 2;
    const gray = image.space === "b-w" || image.space === "grey16";
    const hue = image.space !== "cmyk" && (!!image.hueSamples || image.storedHueSamples !== undefined);
    const evaluate = !hue && (!!image.evaluateSamples || image.storedEvaluateSamples !== undefined);
    const scale = hue ? 65535 : 257;
    const output = new Float64Array(width * height * 4);
    // CMYK inks occupy their own plane; alpha remains in the RGBA backing.
    const inks = image.space === "cmyk" ? new Float64Array(output.length) : undefined;
    for (let position = 0; position < output.length; position += 4096) {
        yield;
        const length = Math.min(4096, output.length - position);
        const bytes = yield { kind: "read", hue, evaluate, highDepth: true, position, length };
        if (!bytes || bytes.length !== length * (hue || evaluate ? 8 : 2)) throw new Error("Truncated despeckle pixels");
        output.set(hue || evaluate ? Float64Array.from(new Float64Array(bytes.slice().buffer), value => value * scale)
            : new Uint16Array(bytes.slice().buffer), position);
        if (inks) {
            const bytes = yield { kind: "read", hue: true, position, length };
            if (!bytes || bytes.length !== length * 8) throw new Error("Truncated despeckle inks");
            inks.set(new Float64Array(bytes.slice().buffer), position);
        }
    }
    const pixels = new Float64Array(stride * (height + 2));
    const buffer = new Float64Array(pixels.length);
    let work = 0;
    for (let channel = 0; channel < (inks ? 5 : 4); channel++) {
        if (channel === 3 && !image.hasAlpha && !image.alphaSeparate) continue;
        if (gray && (channel === 1 || channel === 2) || channels && !channels[channel]) continue;
        const ink = inks && channel !== 3 ? channel === 4 ? 3 : channel : undefined;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            if (++work % 4096 === 0) yield;
            const position = (y * width + x) * 4;
            pixels[(y + 1) * stride + x + 1] = ink === undefined ? output[position + channel]! : inks![position + ink]! * 65535;
        }
        // Every hull has two stages. Only interior samples change; padding stays zero.
        for (const direction of [stride, 1, stride + 1, stride - 1]) {
            for (const [offset, polarity] of [[direction, 1], [-direction, 1], [-direction, -1], [direction, -1]] as const) {
                for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                    if (++work % 4096 === 0) yield;
                    const i = (y + 1) * stride + x + 1, value = pixels[i]!;
                    buffer[i] = (pixels[i + offset]! - value) * polarity >= 514 ? value + polarity * 257 : value;
                }
                for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                    if (++work % 4096 === 0) yield;
                    const i = (y + 1) * stride + x + 1, value = buffer[i]!;
                    pixels[i] = (buffer[i - offset]! - value) * polarity >= 514 && (buffer[i + offset]! - value) * polarity > 0
                        ? value + polarity * 257 : value;
                }
            }
        }
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            if (++work % 4096 === 0) yield;
            const position = (y * width + x) * 4;
            const value = pixels[(y + 1) * stride + x + 1]!;
            if (ink === undefined) output[position + channel] = value;
            else inks![position + ink] = value / 65535;
            // Gray has one color plane; R selects it and RGB storage stays neutral.
            if (gray && channel === 0) output[position + 1] = output[position + 2] = output[position]!;
        }
    }
    for (let position = 0; position < output.length; position += 4096) {
        yield;
        const samples = output.slice(position, position + 4096);
        if (inks) {
            const inkSamples = inks.slice(position, position + samples.length);
            for (let i = 0; i < samples.length; i += 4) for (let channel = 0; channel < 3; channel++)
                samples[i + channel] = Math.fround((1 - inkSamples[i + channel]!) * (1 - inkSamples[i + 3]!) * 65535);
            yield { kind: "write", hue: true, position, data: new Uint8Array(inkSamples.buffer) };
        }
        const bounded = Uint16Array.from(samples, value => Math.max(0, Math.min(65535, Math.round(value))));
        yield { kind: "write", highDepth: true, position, data: new Uint8Array(bounded.buffer) };
        if (hue || evaluate || inks) {
            yield { kind: "write", evaluate: true, position, data: new Uint8Array(samples.map(value => value / 257).buffer) };
            if (hue) yield { kind: "write", hue: true, position, data: new Uint8Array(samples.map(value => value / 65535).buffer) };
        }
    }
}
