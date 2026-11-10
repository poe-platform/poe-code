import { virtualPixelIndex } from "./virtual-pixel.js";
import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";

export function parseMeanShiftGeometry(raw: string): { width: number; height: number; distance: number } {
    const percent = raw.endsWith("%"), value = percent ? raw.slice(0, -1) : raw;
    const offset = value.indexOf("+"), dimensions = (offset < 0 ? value : value.slice(0, offset)).split("x");
    const width = Number(dimensions[0]), height = dimensions[1] === undefined ? 1 : Number(dimensions[1]);
    const distance = offset < 0 ? 6553.5 : Number(value.slice(offset + 1));
    if (dimensions.length > 2 || !dimensions.some(part => part.length > 0) || ![width, height, distance].every(Number.isFinite)
        || width < 0 || height < 0 || distance < 0 || (offset >= 0 && offset === value.length - 1)) throw new Error("Invalid mean-shift geometry");
    if (width > 1000 || height > 1000) throw new Error("Mean-shift window exceeds limit");
    return { width: Math.trunc(width), height: Math.trunc(height), distance: percent ? distance / 100 : distance / 65535 };
}

/** Native mean shift: circular neighborhood, moving centroid, at most 100 iterations. */
export function* meanShiftPixelSteps(image: Pick<RgbaImage, "width" | "height" | "data16" | "evaluateSamples"> & Partial<Pick<StoredRgbaImage, "storedData16" | "storedEvaluateSamples">>, geometry: ReturnType<typeof parseMeanShiftGeometry>, background: RgbaColor, virtualPixel: VirtualPixelMethod = "edge"): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const evaluate = !!image.evaluateSamples || image.storedEvaluateSamples !== undefined;
    const { width, height } = image, highDepth = !!(image.data16 || image.storedData16), scale = !evaluate && highDepth ? 257 : 1;
    const rx = Math.floor(geometry.width / 2), ry = Math.floor(geometry.height / 2), limit = (geometry.distance * 255 * scale) ** 2;
    for (let start = 0; start < width * height; start += 1024) {
        yield;
        const count = Math.min(1024, width * height - start);
        const original = yield { kind: "read", evaluate, highDepth, position: start * 4, length: count * 4 };
        if (!original || original.length !== count * 4 * (evaluate ? 8 : highDepth ? 2 : 1)) throw new Error("Truncated mean-shift pixels");
        const data = evaluate ? new Float64Array(original.slice().buffer) : highDepth ? new Uint16Array(original.slice().buffer) : original.slice();
        const samples = new Float64Array(count * 4);
        for (let i = 0; i < count; i++) {
            let mx = (start + i) % width, my = Math.floor((start + i) / width);
            let mean = Array.from(data.subarray(i * 4, i * 4 + 4));
            for (let iteration = 0; iteration < 100; iteration++) {
                yield;
                let sx = 0, sy = 0, total = 0;
                // Native initializes the alpha accumulator to opaque.
                const sums = [0, 0, 0, 255 * scale];
                for (let v = -ry; v <= ry; v++) for (let u = -rx; u <= rx; u++) {
                    yield;
                    if (u * u + v * v > rx * ry) continue;
                    // MagickRound rounds ties away from zero.
                    let x = Math.sign(mx + u) * Math.floor(Math.abs(mx + u) + 0.5), y = Math.sign(my + v) * Math.floor(Math.abs(my + v) + 0.5);
                    let pixel: ArrayLike<number> | undefined;
                    if (x < 0 || y < 0 || x >= width || y >= height) {
                        const index = virtualPixelIndex(x, y, width, height, virtualPixel);
                        if (index >= 0) {
                            x = index % width; y = Math.floor(index / width);
                        } else {
                            // Native gray is quantum 32768, expressed here on the 0–255 scale.
                            const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 32768 / 257 : 0;
                            pixel = ((virtualPixel === "background" || virtualPixel?.endsWith("-tile")) ? [background.r, background.g, background.b, background.a] : [gray, gray, gray, virtualPixel === "transparent" ? 0 : 255]).map(value => value * scale);
                        }
                    }
                    if (!pixel) {
                        const bytes = yield { kind: "read", evaluate, highDepth, position: (y * width + x) * 4, length: 4 };
                        if (!bytes || bytes.length !== (evaluate ? 32 : highDepth ? 8 : 4)) throw new Error("Truncated mean-shift pixels");
                        pixel = evaluate ? new Float64Array(bytes.slice().buffer) : highDepth ? new Uint16Array(bytes.buffer, bytes.byteOffset, 4) : bytes;
                    }
                    if ((mean[0]! - pixel[0]!) ** 2 + (mean[1]! - pixel[1]!) ** 2 + (mean[2]! - pixel[2]!) ** 2 > limit) continue;
                    sx += mx + u; sy += my + v; total++;
                    for (let c = 0; c < 4; c++) sums[c]! += pixel[c]!;
                }
                const nx = sx / (total || 1), ny = sy / (total || 1), next = sums.map(value => value / (total || 1));
                const movement = (nx - mx) ** 2 + (ny - my) ** 2 + ((next[0]! - mean[0]!) ** 2 + (next[1]! - mean[1]!) ** 2 + (next[2]! - mean[2]!) ** 2) / scale ** 2;
                mx = nx; my = ny; mean = next;
                if (movement <= 3) break;
            }
            for (let c = 0; c < 4; c++) {
                samples[i * 4 + c] = Math.fround(mean[c]! * 257 / scale) / 257;
                data[i * 4 + c] = evaluate ? mean[c]! : Math.min(255 * scale, Math.max(0, Math.round(mean[c]!)));
            }
        }
        const bounded = !evaluate ? data : highDepth
            ? Uint16Array.from(data, value => Math.min(65535, Math.max(0, Math.round(value * 257))))
            : Uint8Array.from(data, value => Math.min(255, Math.max(0, Math.round(value))));
        yield { kind: "write", highDepth, position: start * 4, data: new Uint8Array(bounded.buffer, bounded.byteOffset, bounded.byteLength) };
        yield { kind: "write", evaluate: true, position: start * 4, data: new Uint8Array(samples.buffer) };
    }
}
