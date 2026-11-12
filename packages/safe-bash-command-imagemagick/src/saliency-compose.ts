import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";

type Raster = Pick<RgbaImage, "width" | "height" | "hasAlpha" | "data16" | "evaluateSamples"> & Partial<Pick<StoredRgbaImage, "storedData16" | "storedEvaluateSamples">>;

// ImageMagick's mixed-gradient Poisson blend, with float32 Q16 working samples.
export function* saliencyCompositeSteps(base: Raster, overlay: Raster, left: number, top: number, args?: string, channels?: readonly boolean[]): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const x0 = Math.max(0, left), y0 = Math.max(0, top);
    const width = Math.max(0, Math.min(base.width, left + overlay.width) - x0);
    const height = Math.max(0, Math.min(base.height, top + overlay.height) - y0);
    const size = width * height;
    const crop = new Float64Array(size * 4), source = new Float64Array(size * 4);
    const quantum = (value: number) => Math.fround(value * 257) / 257;
    function* read(image: number, raster: Raster, position: number, length: number): Generator<ConvolveRequest, Float64Array, Uint8Array | undefined> {
        const evaluate = !!raster.evaluateSamples || raster.storedEvaluateSamples !== undefined;
        const bytes = (yield { kind: "read", image, highDepth: true, evaluate, position, length })!;
        return evaluate ? new Float64Array(bytes.slice().buffer) : Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257);
    }
    const mean = [0, 0, 0, 0];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x += 512) {
        const length = Math.min(512, width - x) * 4, offset = (y * width + x) * 4;
        const background = yield* read(0, base, ((y0 + y) * base.width + x0 + x) * 4, length);
        const foreground = yield* read(1, overlay, ((y0 + y - top) * overlay.width + x0 + x - left) * 4, length);
        for (let i = 0; i < length; i++) {
            if (i % 4 === 3) {
                if (!base.hasAlpha) background[i] = 255;
                if (!overlay.hasAlpha) foreground[i] = 255;
            }
            mean[i % 4]! += background[i]! / size;
        }
        crop.set(background, offset);
        source.set(foreground, offset);
    }
    const index = (x: number, y: number) => (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 4;
    const gx = new Float64Array(size * 3), gy = new Float64Array(size * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if ((y * width + x) % 512 === 0) yield;
        for (let c = 0; c < 3; c++) {
            const dx = quantum((crop[index(x - 1, y) + c]! - crop[index(x + 1, y) + c]!) / 2);
            const dy = quantum((crop[index(x, y - 1) + c]! - crop[index(x, y + 1) + c]!) / 2);
            const sx = quantum((source[index(x - 1, y) + c]! - source[index(x + 1, y) + c]!) / 2);
            const sy = quantum((source[index(x, y - 1) + c]! - source[index(x, y + 1) + c]!) / 2);
            const destinationWins = quantum(Math.hypot(dx, dy)) > quantum(Math.hypot(sx, sy));
            gx[(y * width + x) * 3 + c] = destinationWins ? dx : sx;
            gy[(y * width + x) * 3 + c] = destinationWins ? dy : sy;
        }
    }
    const divergence = new Float64Array(size * 3);
    let relaxed = new Float64Array(crop), next = new Float64Array(crop.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const pixel = y * width + x;
        if (pixel % 512 === 0) yield;
        for (let c = 0; c < 3; c++) {
            const dx = quantum((gx[index(x - 1, y) / 4 * 3 + c]! - gx[index(x + 1, y) / 4 * 3 + c]!) / 2);
            const dy = quantum((gy[index(x, y - 1) / 4 * 3 + c]! - gy[index(x, y + 1) / 4 * 3 + c]!) / 2);
            divergence[pixel * 3 + c] = quantum((dx + dy) / 4);
        }
        if (source[pixel * 4 + 3] !== 0) for (let c = 0; c < 4; c++) relaxed[pixel * 4 + c] = quantum(mean[c]!);
    }
    const [iterations = 400, threshold = 0.0002] = args === undefined ? [] : args.toLowerCase().replaceAll(",", "x").split("x").map(Number);
    for (let iteration = 0; size && iteration < Math.max(0, Math.trunc(iterations)); iteration++) {
        let residual = 0;
        for (let y = 0; y < height; y++) {
            // Native's serial residual calculation retains the final row's sum.
            residual = 0;
            for (let x = 0; x < width; x++) {
                const pixel = y * width + x, offset = pixel * 4;
                if (pixel % 512 === 0) yield;
                const neighbors = [index(x - 1, y), index(x + 1, y), index(x, y - 1), index(x, y + 1)];
                let alpha = 0;
                for (const neighbor of neighbors) alpha += relaxed[neighbor + 3]! / 1020;
                const convolvedAlpha = base.hasAlpha ? quantum(alpha * 255) : 255;
                const masked = source[offset + 3] === 0;
                next[offset + 3] = masked ? 255 : convolvedAlpha;
                for (let c = 0; c < 3; c++) {
                    let sum = 0;
                    for (const neighbor of neighbors) sum += relaxed[neighbor + c]! * (base.hasAlpha ? relaxed[neighbor + 3]! / 255 : 1) / 4;
                    const blurred = quantum(sum / (base.hasAlpha ? Math.max(1e-12, alpha) : 1));
                    next[offset + c] = masked ? crop[offset + c]! : quantum(blurred - divergence[pixel * 3 + c]!);
                }
                for (let c = 0; c < 4; c++) {
                    const distance = c === 3 ? (next[offset + c]! - relaxed[offset + c]!) / 255
                        : (next[offset + c]! * next[offset + 3]! - relaxed[offset + c]! * relaxed[offset + 3]!) / 65025;
                    residual += distance * distance;
                }
            }
        }
        [relaxed, next] = [next, relaxed];
        if (Math.sqrt(residual / size / (base.hasAlpha ? 4 : 3)) < threshold) break;
    }
    const highDepth = !!(base.data16 || base.storedData16 || overlay.data16 || overlay.storedData16);
    for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width; x += 512) {
        const count = Math.min(512, base.width - x), position = (y * base.width + x) * 4;
        const samples = yield* read(0, base, position, count * 4);
        for (let i = 0; i < count; i++) {
            if (x + i < x0 || x + i >= x0 + width || y < y0 || y >= y0 + height) continue;
            const offset = ((y - y0) * width + x + i - x0) * 4;
            const sa = relaxed[offset + 3]! / 255, da = crop[offset + 3]! / 255, alpha = sa + da * (1 - sa);
            for (let c = 0; c < 4; c++) {
                if (channels && !channels[c]) continue;
                const value = c === 3 ? alpha * 255 : alpha ? (relaxed[offset + c]! * sa + crop[offset + c]! * da * (1 - sa)) / alpha : 0;
                samples[i * 4 + c] = quantum(Math.max(0, Math.min(255, value)));
            }
        }
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(samples.buffer) };
        const data = highDepth ? Uint16Array.from(samples, value => Math.round(Math.max(0, Math.min(65535, value * 257))))
            : Uint8Array.from(samples, value => Math.round(Math.max(0, Math.min(255, value))));
        yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
    }
}
