import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import { regionContains, type Region } from "./region.js";
import type { HueMetadata } from "./colorspace-hue.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

/** Separable à trous hat transform with native noise thresholds and reflected edges. */
export function* waveletDenoisePixelSteps(image: Pick<RgbaImage, "width" | "height" | "data16" | "space" | "evaluateSamples"> & Partial<Pick<StoredRgbaImage, "storedData16" | "storedEvaluateSamples">> & HueMetadata & { region?: Region | undefined; hasAlpha?: boolean; alphaBlend?: boolean | undefined }, geometry: string): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const normalized = geometry.replaceAll("%", "").replaceAll("(", "").replaceAll(")", "")
        .replaceAll(",", "x").replaceAll("/", "x").replaceAll("X", "x");
    const fields: string[] = [];
    let start = 0;
    for (let i = 1; i < normalized.length; i++) {
        if ("+-".includes(normalized[i]!) && !"eEx".includes(normalized[i - 1]!)) {
            fields.push(normalized.slice(start, i));
            start = i;
        }
    }
    fields.push(normalized.slice(start));
    const [thresholdText = "", softnessText = "0", ...extra] = fields[0]!.split("x");
    const scale = geometry.includes("%") ? 65535 / 100 : 1;
    const threshold = Number(thresholdText) * scale;
    const softness = Number(softnessText) * scale;
    if (!thresholdText.trim() || !Array.from(thresholdText.trim()).every(char => "0123456789.eE+-".includes(char)) || extra.length || fields.slice(1).some(field => !Number.isFinite(Number(field))) || !Number.isFinite(threshold) || !Number.isFinite(softness)) throw new Error("Invalid wavelet denoise geometry");
    const { width, height } = image, size = width * height;
    const noise = [0.8002, 0.2735, 0.1202, 0.0585, 0.0291];
    let levels = 5;
    while (levels > 0 && 2 ** (levels - 1) >= Math.min(width, height)) levels--;
    const hue = image.hueSamples !== undefined || image.storedHueSamples !== undefined;
    const evaluate = !hue && (image.evaluateSamples !== undefined || image.storedEvaluateSamples !== undefined);
    const cmyk = image.space === "cmyk";
    const highDepth = !!(image.data16 || image.storedData16), quantumScale = hue ? 65535 : highDepth ? 1 : 257;
    const output = new Float64Array(size * 4);
    for (let start = 0; start < size; start += 1024) {
        yield;
        const count = Math.min(1024, size - start);
        const bytes = yield { kind: "read", hue, evaluate, highDepth, position: start * 4, length: count * 4 };
        if (!bytes || bytes.length !== count * (hue || evaluate ? 32 : highDepth ? 8 : 4)) throw new Error("Truncated wavelet pixels");
        const samples = hue || evaluate ? new Float64Array(bytes.slice().buffer) : highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
        output.set(evaluate && highDepth ? samples.map(value => value * 257) : samples, start * 4);
    }
    const alpha = cmyk && image.region ? new Float64Array(size) : undefined;
    if (alpha) for (let start = 0; start < size; start += 1024) {
        const count = Math.min(1024, size - start);
        const bytes = yield { kind: "read", highDepth, position: start * 4, length: count * 4 };
        if (!bytes) throw new Error("Truncated wavelet alpha");
        const samples = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
        for (let i = 0; i < count; i++) alpha[start + i] = samples[i * 4 + 3]! / (highDepth ? 65535 : 255);
    }
    const masked = image.region ? Float64Array.from(output) : undefined;
    if ((threshold !== 0 || masked) && levels > 0) {
        const planes = new Float32Array(size * 4), row = new Float32Array(Math.max(width, height));
        for (let channel = 0; channel < 3; channel++) {
            for (let i = 0; i < size; i++) {
                if (i % 1024 === 0) yield;
                planes[i] = output[i * 4 + channel]! * quantumScale;
            }
            let high = 0, low = 0;
            for (let level = 0; level < levels; level++) {
                low = size * ((level & 1) + 1);
                const scale = 2 ** level;
                for (const vertical of [false, true]) {
                    const extent = vertical ? height : width, lines = vertical ? width : height, stride = vertical ? width : 1;
                    for (let line = 0; line < lines; line++) {
                        const base = vertical ? line : line * width, source = vertical ? low : high;
                        for (let i = 0; i < extent; i++) {
                            if (i % 1024 === 0) yield;
                            const left = i < scale ? scale - i : i - scale;
                            // Native processes the leading edge first, even when the
                            // edge spans overlap, and reserves a fourth scratch plane.
                            const right = i < scale || i < extent - scale ? i + scale
                                : extent - 2 - (i - Math.max(scale, extent - scale));
                            row[i] = 0.25 * Math.fround(Math.fround(2 * planes[source + base + i * stride]! + planes[source + base + left * stride]!) + planes[source + base + right * stride]!);
                        }
                        for (let i = 0; i < extent; i++) planes[low + base + i * stride] = row[i]!;
                    }
                }
                const magnitude = threshold * Math.fround(noise[level]!);
                for (let i = 0; i < size; i++) {
                    if (i % 1024 === 0) yield;
                    let detail = Math.fround(planes[high + i]! - planes[low + i]!);
                    if (detail < -magnitude) detail = Math.fround(detail + Math.fround(magnitude * (1 - softness)));
                    else if (detail > magnitude) detail = Math.fround(detail - Math.fround(magnitude * (1 - softness)));
                    else detail = Math.fround(detail * Math.fround(softness));
                    planes[high + i] = detail;
                    if (high !== 0) planes[i]! += detail;
                }
                high = low;
            }
            for (let i = 0; i < size; i++) {
                if (i % 1024 === 0) yield;
                const value = Math.fround(planes[i]! + planes[low + i]!) / quantumScale;
                if (masked) {
                    const region = image.region!, x = i % width, y = Math.floor(i / width);
                    if (!regionContains(region, x, y)) {
                        // Native synchronizes the write mask after each RGB channel,
                        // compositing every color against the preceding channel's result.
                        const opacity = image.hasAlpha || image.alphaBlend !== false ? alpha?.[i] ?? output[i * 4 + 3]! / (hue ? 1 : highDepth ? 65535 : 255) : 1;
                        for (let color = 0; color < 3; color++) {
                            const original = masked[i * 4 + color]!;
                            masked[i * 4 + color] = original * opacity + (color === channel ? value : original) * opacity * (1 - opacity);
                        }
                    } else masked[i * 4 + channel] = value;
                } else output[i * 4 + channel] = value;

            }
        }
    }
    if (masked) for (let i = 0; i < output.length; i++) {
        if (i % 4096 === 0) yield;
        output[i] = masked[i]!;
    }
    for (let position = 0; position < output.length; position += 4096) {
        yield;
        const samples = output.slice(position, position + 4096);
        if (hue) {
            yield { kind: "write", hue: true, position, data: new Uint8Array(samples.buffer) };
            const rgba = Float64Array.from(samples, value => value * 255);
            if (cmyk) {
                const bytes = yield { kind: "read", position, length: samples.length, highDepth };
                if (!bytes) throw new Error("Truncated wavelet pixels");
                const original = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
                for (let i = 0; i < samples.length; i += 4) {
                    for (let channel = 0; channel < 3; channel++) rgba[i + channel] = (1 - samples[i + channel]!) * (1 - samples[i + 3]!) * 255;
                    rgba[i + 3] = original[i + 3]! / (highDepth ? 257 : 1);
                }
                yield { kind: "write", evaluate: true, position, data: new Uint8Array(rgba.buffer) };
            }
            const bounded = highDepth ? Uint16Array.from(rgba, value => Math.max(0, Math.min(65535, Math.round(value * 257))))
                : Uint8Array.from(rgba, value => Math.max(0, Math.min(255, Math.round(value))));
            yield { kind: "write", highDepth, position, data: new Uint8Array(bounded.buffer) };
        } else {
            // Keep calculated precision without changing the source image depth.
            const working = Float64Array.from(samples, value => value / (highDepth ? 257 : 1));
            yield { kind: "write", evaluate: true, position, data: new Uint8Array(working.buffer) };
            const bounded = highDepth ? Uint16Array.from(samples, value => Math.max(0, Math.min(65535, Math.round(value))))
                : Uint8Array.from(samples, value => Math.max(0, Math.min(255, Math.round(value))));
            yield { kind: "write", highDepth, position, data: new Uint8Array(bounded.buffer) };
        }
    }
}
