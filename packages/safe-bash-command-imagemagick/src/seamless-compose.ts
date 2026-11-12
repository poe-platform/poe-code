import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";

type Raster = Pick<RgbaImage, "width" | "height" | "hasAlpha" | "data16" | "evaluateSamples"> & Partial<Pick<StoredRgbaImage, "storedData16" | "storedEvaluateSamples">>;

export function* seamlessCompositeSteps(base: Raster, overlay: Raster, left: number, top: number, args = "", tile = false, channels?: readonly boolean[]): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const x0 = tile ? 0 : Math.max(0, left), y0 = tile ? 0 : Math.max(0, top);
    const width = (tile ? base.width : Math.min(base.width, left + overlay.width)) - x0;
    const height = (tile ? base.height : Math.min(base.height, top + overlay.height)) - y0;
    const highDepth = !!(base.data16 || overlay.data16 || base.storedData16 || overlay.storedData16);
    const baseEvaluate = !!base.evaluateSamples || base.storedEvaluateSamples !== undefined;
    // Raster outputs start empty: retain the canvas beyond the overlapping crop.
    for (let position = 0; position < base.width * base.height * 4; position += 2048) {
        const length = Math.min(2048, base.width * base.height * 4 - position);
        const bytes = (yield { kind: "read", highDepth: true, evaluate: baseEvaluate, position, length })!;
        const samples = baseEvaluate ? new Float64Array(bytes.slice().buffer)
            : Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257);
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(samples.buffer) };
        const data = highDepth ? Uint16Array.from(samples, value => Math.round(value * 257)) : Uint8Array.from(samples, Math.round);
        yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
    }
    if (width <= 0 || height <= 0) return;
    const source = new Float64Array(width * height * 4);
    const difference = new Float64Array(source.length);
    const mean = [0, 0, 0, 0];
    // Read bounded spans so both retained and buffered rasters use identical samples.
    for (let y = 0; y < height; y++) for (let x = 0; x < width;) {
        const sx = tile ? (x + x0) % overlay.width : x + x0 - left;
        const sy = tile ? (y + y0) % overlay.height : y + y0 - top;
        const count = Math.min(512, width - x, overlay.width - sx);
        const offset = (y * width + x) * 4;
        for (const image of [0, 1]) {
            const raster = image ? overlay : base;
            const evaluate = !!raster.evaluateSamples || raster.storedEvaluateSamples !== undefined;
            const position = image ? (sy * overlay.width + sx) * 4 : ((y + y0) * base.width + x + x0) * 4;
            const bytes = (yield { kind: "read", image, highDepth: true, evaluate, position, length: count * 4 })!;
            const samples = evaluate ? new Float64Array(bytes.slice().buffer)
                : Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257);
            for (let i = 0; i < samples.length; i++) {
                const value = i % 4 === 3 && !raster.hasAlpha ? 255 : samples[i]!;
                if (image) {
                    source[offset + i] = value;
                    // Native subtracts alpha only when both images have that channel.
                    if (i % 4 !== 3 || base.hasAlpha && overlay.hasAlpha) difference[offset + i]! -= value;
                    difference[offset + i] = Math.fround(difference[offset + i]! * 257) / 257;
                    mean[i % 4]! += difference[offset + i]! / (width * height);
                } else difference[offset + i] = value;
            }
        }
        x += count;
    }
    let relaxed = new Float64Array(source.length), next = new Float64Array(source.length);
    for (let i = 0; i < source.length; i++) {
        if (i % 65536 === 0) yield;
        relaxed[i] = source[i - i % 4 + 3] !== 0 ? Math.fround(mean[i % 4]! * 257) / 257 : difference[i]!;
    }
    const [iterations = 400, threshold = 0.0002] = args ? args.toLowerCase().replaceAll(",", "x").split("x").map(Number) : [];
    // Jacobi relaxation of the color difference; transparent source pixels anchor it.
    for (let iteration = 0; iteration < iterations; iteration++) {
        let residual = 0;
        for (let y = 0; y < height; y++) {
            // Native's residual accumulator resets per scanline, then divides by image area.
            residual = 0;
            for (let x = 0; x < width; x++) {
                const offset = (y * width + x) * 4;
                if (offset % 65536 === 0) yield;
                const neighbors = [(y * width + Math.max(0, x - 1)) * 4, (y * width + Math.min(width - 1, x + 1)) * 4,
                    (Math.max(0, y - 1) * width + x) * 4, (Math.min(height - 1, y + 1) * width + x) * 4];
                let alpha = 0;
                for (const neighbor of neighbors) alpha += (base.hasAlpha ? relaxed[neighbor + 3]! : 255) / 4;
                for (let c = 0; c < 4; c++) {
                    let value = 0;
                    for (const neighbor of neighbors) value += relaxed[neighbor + c]! * (c < 3 && base.hasAlpha ? relaxed[neighbor + 3]! : 255) / 1020;
                    if (c < 3 && base.hasAlpha) value = Math.abs(alpha) < 1e-12 ? 0 : value * 255 / alpha;
                    if (c === 3) value = alpha;
                    if (source[offset + 3] === 0) value = c === 3 ? 255 : difference[offset + c]!;
                    next[offset + c] = Math.fround(value * 257) / 257;
                }
                for (let c = 0; c < (base.hasAlpha ? 4 : 3); c++) {
                    const current = next[offset + c]! * (c < 3 && base.hasAlpha ? next[offset + 3]! / 255 : 1);
                    const previous = relaxed[offset + c]! * (c < 3 && base.hasAlpha ? relaxed[offset + 3]! / 255 : 1);
                    residual += ((current - previous) / 255) ** 2;
                }
            }
        }
        [relaxed, next] = [next, relaxed];
        if (Math.sqrt(residual / (width * height * (base.hasAlpha ? 4 : 3))) < threshold) break;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x += 512) {
        const count = Math.min(512, width - x), offset = (y * width + x) * 4;
        const position = ((y + y0) * base.width + x + x0) * 4;
        const evaluate = !!base.evaluateSamples || base.storedEvaluateSamples !== undefined;
        const bytes = (yield { kind: "read", highDepth: true, evaluate, position, length: count * 4 })!;
        const samples = evaluate ? new Float64Array(bytes.slice().buffer)
            : Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257);
        for (let i = 0; i < samples.length; i += 4) {
            const sa = overlay.hasAlpha ? (source[offset + i + 3]! + (base.hasAlpha ? relaxed[offset + i + 3]! : 0)) / 255 : 1;
            const da = base.hasAlpha ? samples[i + 3]! / 255 : 1;
            const alpha = sa + da * (1 - sa);
            for (let c = 0; c < 4; c++) {
                if (channels && !channels[c]) continue;
                const value = c === 3 ? alpha * 255 : alpha === 0 ? 0
                    : ((source[offset + i + c]! + relaxed[offset + i + c]!) * sa + samples[i + c]! * da * (1 - sa)) / alpha;
                samples[i + c] = Math.fround(Math.max(0, Math.min(255, value)) * 257) / 257;
            }
        }
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(samples.buffer) };
        const data = highDepth ? Uint16Array.from(samples, value => Math.round(value * 257)) : Uint8Array.from(samples, Math.round);
        yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
    }
}
