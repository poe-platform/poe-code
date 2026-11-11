import { virtualPixelIndex } from "./virtual-pixel.js";
import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { VirtualPixelMethod } from "./warp-kernel.js";
import type { Region } from "./region.js";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { HueMetadata } from "./colorspace-hue.js";

export function* edgePixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "data16" | "space"> & Partial<Pick<StoredRgbaImage, "storedData16">> & HueMetadata & { region?: Region | undefined }, radius: number, channels?: { r: boolean; g: boolean; b: boolean; a: boolean; k?: boolean }, virtualPixel: VirtualPixelMethod = "edge", background?: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const cmyk = image.space === "cmyk", stride = cmyk ? 5 : 4;
    const hue = !cmyk && !!image.magickColorspace && (image.hueSamples !== undefined || image.storedHueSamples !== undefined);
    const highDepth = !!(image.data16 || image.storedData16), maximum = highDepth ? 65535 : 255;
    const mask = channels ? [channels.r, channels.g, channels.b, channels.a && image.hasAlpha, channels.k] : [true, true, true, image.hasAlpha, true];
    const half = radius > 0 ? Math.ceil(radius) : 2;
    if (!Number.isFinite(half) || half > 5000) throw new Error("Edge radius exceeds 5000");
    const { width, height } = image, area = (2 * half + 1) ** 2;
    const gray = virtualPixel === "white" ? maximum : virtualPixel === "gray" ? 128 * (maximum / 255) : 0;
    const fill = (virtualPixel === "background" || virtualPixel.endsWith("-tile")) && background
        ? [background.r, background.g, background.b, background.a].map(value => value * (maximum / 255))
        : [gray, gray, gray, virtualPixel === "transparent" ? 0 : maximum];
    if (cmyk) fill.push(0);
    function* read(position: number, length: number): Generator<ConvolveRequest | undefined, Uint8Array | Uint16Array | Float64Array, Uint8Array | undefined> {
        if (!cmyk && !image.hueSamples && image.storedHueSamples === undefined) {
            const working = yield { kind: "read", evaluate: true, position, length };
            if (working?.length) {
                if (working.length !== length * 8) throw new Error("Truncated edge working samples");
                return Float64Array.from(new Float64Array(working.slice().buffer), value => value * maximum / 255);
            }
        }
        const bytes = yield { kind: "read", hue, highDepth, position, length };
        if (!bytes || bytes.length !== length * (hue ? 8 : highDepth ? 2 : 1)) throw new Error("Truncated edge pixels");
        if (hue) return new Float64Array(bytes.slice().buffer).map(value => value * maximum);
        const rgba = highDepth ? new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2) : bytes;
        if (!cmyk) return rgba;
        const inkBytes = yield { kind: "read", hue: true, position, length };
        if (!inkBytes || inkBytes.length !== length * 8) throw new Error("Truncated edge inks");
        const inks = new Float64Array(inkBytes.slice().buffer), samples = new Float64Array(length / 4 * stride);
        for (let i = 0; i < length / 4; i++) samples.set([
            inks[i * 4]! * maximum, inks[i * 4 + 1]! * maximum, inks[i * 4 + 2]! * maximum,
            rgba[i * 4 + 3]!, inks[i * 4 + 3]! * maximum,
        ], i * stride);
        return samples;
    }
    for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 1024) {
        yield;
        const count = Math.min(1024, width - left), sums = new Float64Array(count * stride);
        const first = left - half, length = (count + 2 * half) * stride;
        for (let ky = -half; ky <= half; ky++) {
            yield;
            const map = (x: number) => virtualPixelIndex(x, y + ky, width, height, virtualPixel);
            const samples = new Float64Array(length);
            for (let x = 0; x < length / stride;) {
                yield;
                const sx = map(first + x);
                if (sx < 0) {
                    samples.set(fill, x * stride);
                    x++;
                    continue;
                }
                let run = 1;
                const direction = map(first + x + 1) - sx;
                if (direction >= -1 && direction <= 1) {
                    while (x + run < length / stride && map(first + x + run) === sx + run * direction && sx + run * direction >= 0) run++;
                }
                const start = direction === -1 ? sx - run + 1 : sx;
                const readLength = (direction === 0 ? 1 : run) * 4;
                const row = yield* read(start * 4, readLength);
                if (direction === 1) samples.set(row, x * stride);
                else for (let i = 0; i < run; i++) {
                    const offset = (direction === 0 ? 0 : direction === -1 ? run - i - 1 : i) * stride;
                    samples.set(row.subarray(offset, offset + stride), (x + i) * stride);
                }
                x += run;
            }
            for (let c = 0; c < stride; c++) {
                if (!mask[c] && !(image.hasAlpha && c === 3)) continue;
                let sum = 0;
                for (let k = -half; k <= half; k++) {
                    const offset = (k + half) * stride;
                    sum += samples[offset + c]! * (image.hasAlpha && c !== 3 ? samples[offset + 3]! : 1);
                }
                for (let x = 0; x < count; x++) {
                    sums[x * stride + c]! += sum;
                    const outgoing = x * stride;
                    const incoming = (x + 2 * half + 1) * stride;
                    sum -= samples[outgoing + c]! * (image.hasAlpha && c !== 3 ? samples[outgoing + 3]! : 1);
                    sum += (samples[incoming + c] ?? 0) * (image.hasAlpha && c !== 3 ? (samples[incoming + 3] ?? 0) : 1);
                }
            }
        }
        const position = (y * width + left) * 4;
        const samples = yield* read(position, count * 4);
        let data = cmyk || hue ? new Float64Array(samples)
            : highDepth ? Uint16Array.from(samples, value => Math.max(0, Math.min(maximum, Math.round(value))))
                : Uint8Array.from(samples, value => Math.max(0, Math.min(maximum, Math.round(value))));
        const working = !cmyk && image.region ? Float64Array.from(samples, value => value * 255 / maximum) : undefined;
        for (let x = 0; x < count; x++) {
            const alpha = area * samples[x * stride + 3]! - sums[x * stride + 3]!;
            for (let c = 0; c < stride; c++) if (mask[c]) {
                // Normalize premultiplied colors by the convolved alpha, including
                // zero-sum kernels (ImageMagick uses a positive epsilon at zero).
                const value = image.hasAlpha && c !== 3
                    ? (area * samples[x * stride + c]! * samples[x * stride + 3]! - sums[x * stride + c]!) / (alpha === 0 ? maximum * 1e-12 : alpha)
                    : area * samples[x * stride + c]! - sums[x * stride + c]!;
                // Region compositing needs unclamped Q16-HDRI quantum values.
                if (working) working[x * stride + c] = Math.fround(value * 65535 / maximum) / 257;
                data[x * stride + c] = cmyk || hue ? Math.fround(value * 65535 / maximum) * maximum / 65535 : Math.max(0, Math.min(maximum, Math.round(value)));
            }
        }
        if (cmyk) {
            const inks = new Float64Array(count * 4), rgba = new Float64Array(count * 4);
            for (let x = 0; x < count; x++) {
                inks.set([data[x * stride]! / maximum, data[x * stride + 1]! / maximum, data[x * stride + 2]! / maximum, data[x * stride + 4]! / maximum], x * 4);
                for (let c = 0; c < 3; c++) rgba[x * 4 + c] = (1 - inks[x * 4 + c]!) * (1 - inks[x * 4 + 3]!) * 255;
                rgba[x * 4 + 3] = data[x * stride + 3]! * 255 / maximum;
            }
            yield { kind: "write", hue: true, position, data: new Uint8Array(inks.buffer) };
            yield { kind: "write", evaluate: true, position, data: new Uint8Array(rgba.buffer) };
            const bounded = highDepth ? new Uint16Array(rgba.length) : new Uint8Array(rgba.length);
            for (let i = 0; i < rgba.length; i++) bounded[i] = Math.max(0, Math.min(maximum, Math.round(rgba[i]! * maximum / 255)));
            yield { kind: "write", highDepth, position, data: new Uint8Array(bounded.buffer) };
            continue;
        }
        if (hue) {
            // Convert back from the filtered HDRI channels, not the original samples.
            yield { kind: "write", hue: true, position, data: new Uint8Array(Float64Array.from(data, value => value / maximum).buffer) };
            const bounded = highDepth ? new Uint16Array(data.length) : new Uint8Array(data.length);
            for (let i = 0; i < data.length; i++) bounded[i] = Math.max(0, Math.min(maximum, Math.round(data[i]!)));
            data = bounded;
        }
        yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
        if (working) yield { kind: "write", evaluate: true, position, data: new Uint8Array(working.buffer) };
    }
}
