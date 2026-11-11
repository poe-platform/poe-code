import type { RgbaColor, RgbaImage } from "@poe-code/image-ast/portable";
import type { HueMetadata } from "./colorspace-hue.js";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { magickIntensity } from "./intensity.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";

/** Select whole pixels from the most frequent intensity bin in each square brush. */
export function* paintPixelSteps(image: Pick<RgbaImage, "width" | "height" | "space" | "hasAlpha"> & HueMetadata, geometry: { width?: number; height?: number }, background: RgbaColor, method: VirtualPixelMethod = "edge", channels?: { r: boolean; g: boolean; b: boolean; a: boolean; k?: boolean }, intensity = "rec709luma"): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const radius = geometry.width ?? 0, sigma = Math.abs(geometry.height ?? 0);
    if (!Number.isFinite(radius) || !Number.isFinite(sigma)) throw new Error("Paint radius or sigma exceeds limit");
    let half = radius > 1e-12 ? Math.ceil(radius) : 1;
    if (radius <= 1e-12 && sigma > 1e-12) {
        // The 2D Gaussian sum factors into the square of its 1D sum.
        let sum = 1 + 2 * Math.exp(-1 / (2 * sigma * sigma));
        for (half = 2; half <= 5000; half++) {
            yield;
            const edge = Math.exp(-half * half / (2 * sigma * sigma));
            sum += 2 * edge;
            if (edge / (sum * sum) < 1 / 65535) { half--; break; }
        }
    }
    if (half > 5000) throw new Error("Paint radius exceeds 5000");
    const { width, height } = image, cmyk = image.space === "cmyk";
    const hue = !!image.hueSamples || image.storedHueSamples !== undefined;
    const mask = channels ? [channels.r, channels.g, channels.b, channels.a && image.hasAlpha, channels.k] : [true, true, true, image.hasAlpha, true];
    const linear = intensity === "rec601luminance" || intensity === "rec709luminance"
        ? !!image.magickColorspace && image.magickColorspace !== "Gray" || cmyk
        : image.magickColorspace === "RGB" || image.magickColorspace === "scRGB";
    const bin = (r: number, g: number, b: number) => Math.max(0, Math.min(255, Math.round(magickIntensity(r, g, b, intensity, 255, linear))));
    const gray = method === "white" ? 255 : method === "gray" ? 127.5 : 0;
    const fill = Float64Array.from(method === "background" || method.endsWith("-tile")
        ? [background.r, background.g, background.b, background.a, 0, 0]
        : [gray, gray, gray, method === "transparent" ? 0 : 255, cmyk ? gray : 0, 0]);
    fill[5] = bin(fill[0]!, fill[1]!, fill[2]!);
    const blocks = new Map<number, Float64Array>();
    function* sample(x: number, y: number): Generator<ConvolveRequest | undefined, Float64Array, Uint8Array | undefined> {
        const pixel = virtualPixelIndex(x, y, width, height, method);
        if (pixel < 0) return fill;
        const start = Math.floor(pixel / 512) * 512;
        let samples = blocks.get(start);
        if (!samples) {
            const length = Math.min(512, width * height - start) * 4;
            const working = yield { kind: "read", evaluate: true, position: start * 4, length };
            const bytes = working?.length ? working : yield { kind: "read", highDepth: true, position: start * 4, length };
            if (!bytes || bytes.length !== length * (working?.length ? 8 : 2)) throw new Error("Truncated paint pixels");
            const rgba = working?.length ? new Float64Array(bytes.slice().buffer) : Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257);
            const planes = hue ? yield { kind: "read", hue: true, position: start * 4, length } : undefined;
            if (hue && planes?.length !== length * 8) throw new Error("Truncated paint color planes");
            const inks = planes ? new Float64Array(planes.slice().buffer) : undefined;
            samples = new Float64Array(length / 4 * 6);
            for (let i = 0; i < length / 4; i++) {
                for (let c = 0; c < 3; c++) samples[i * 6 + c] = inks ? inks[i * 4 + c]! * 255 : rgba[i * 4 + c]!;
                samples[i * 6 + 3] = rgba[i * 4 + 3]!;
                samples[i * 6 + 4] = cmyk && inks ? inks[i * 4 + 3]! * 255 : 0;
                samples[i * 6 + 5] = bin(samples[i * 6]!, samples[i * 6 + 1]!, samples[i * 6 + 2]!);
            }
            if (blocks.size === 32) blocks.delete(blocks.keys().next().value!);
            blocks.set(start, samples);
        }
        return samples.subarray((pixel - start) * 6, (pixel - start + 1) * 6);
    }
    const histogram = new Uint32Array(256);
    for (let start = 0; start < width * height; start += 512) {
        const count = Math.min(512, width * height - start), output = new Float64Array(count * 4);
        const planes = hue ? new Float64Array(count * 4) : undefined;
        for (let i = 0; i < count; i++) {
            yield;
            const x = (start + i) % width, y = Math.floor((start + i) / width);
            const center = yield* sample(x, y);
            let selected = center, maximum = 0;
            histogram.fill(0);
            for (let dy = -half; dy <= half; dy++) {
                yield;
                for (let dx = -half; dx <= half; dx++) {
                    const neighbor = yield* sample(x + dx, y + dy);
                    const frequency = ++histogram[neighbor[5]!]!;
                    // Strict comparison preserves native scan-order ties, including
                    // the last occurrence that first establishes the winning count.
                    if (frequency > maximum) { maximum = frequency; selected = neighbor; }
                }
            }
            for (let c = 0; c < 4; c++) output[i * 4 + c] = mask[c] ? selected[c]! : center[c]!;
            if (planes) {
                for (let c = 0; c < 4; c++) planes[i * 4 + c] = c === 3 && cmyk
                    ? (mask[4] ? selected[4]! : center[4]!) / 255 : output[i * 4 + c]! / 255;
                if (cmyk) for (let c = 0; c < 3; c++) output[i * 4 + c] = (1 - planes[i * 4 + c]!) * (1 - planes[i * 4 + 3]!) * 255;
            }
        }
        const position = start * 4;
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(output.buffer) };
        yield { kind: "write", highDepth: true, position, data: new Uint8Array(Uint16Array.from(output, value => Math.max(0, Math.min(65535, Math.round(value * 257)))).buffer) };
        if (planes) yield { kind: "write", hue: true, position, data: new Uint8Array(planes.buffer) };
    }
}
