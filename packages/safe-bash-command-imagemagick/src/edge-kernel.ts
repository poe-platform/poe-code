import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";

export function* edgePixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "data16"> & Partial<Pick<StoredRgbaImage, "storedData16">>, radius: number, channels?: { r: boolean; g: boolean; b: boolean; a: boolean }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const highDepth = !!(image.data16 || image.storedData16), maximum = highDepth ? 65535 : 255;
    const mask = channels ? [channels.r, channels.g, channels.b, channels.a && image.hasAlpha] : [true, true, true, image.hasAlpha];
    const half = radius > 0 ? Math.ceil(radius) : 2;
    if (!Number.isFinite(half) || half > 5000) throw new Error("Edge radius exceeds 5000");
    const { width, height } = image, area = (2 * half + 1) ** 2;
    for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 1024) {
        yield;
        const count = Math.min(1024, width - left), sums = new Float64Array(count * 4);
        const first = Math.max(0, left - half), last = Math.min(width - 1, left + count - 1 + half);
        for (let ky = -half; ky <= half; ky++) {
            yield;
            const sy = Math.max(0, Math.min(height - 1, y + ky)), length = (last - first + 1) * 4;
            const bytes = yield { kind: "read", highDepth, position: (sy * width + first) * 4, length };
            if (!bytes || bytes.length !== length * (highDepth ? 2 : 1)) throw new Error("Truncated edge pixels");
            const samples = highDepth ? new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2) : bytes;
            for (let c = 0; c < 4; c++) {
                if (!mask[c] && !(image.hasAlpha && c === 3)) continue;
                let sum = 0;
                for (let k = -half; k <= half; k++) {
                    const offset = (Math.max(0, Math.min(width - 1, left + k)) - first) * 4;
                    sum += samples[offset + c]! * (image.hasAlpha && c < 3 ? samples[offset + 3]! : 1);
                }
                for (let x = 0; x < count; x++) {
                    sums[x * 4 + c]! += sum;
                    const outgoing = (Math.max(0, left + x - half) - first) * 4;
                    const incoming = (Math.min(width - 1, left + x + half + 1) - first) * 4;
                    sum -= samples[outgoing + c]! * (image.hasAlpha && c < 3 ? samples[outgoing + 3]! : 1);
                    sum += (samples[incoming + c] ?? 0) * (image.hasAlpha && c < 3 ? (samples[incoming + 3] ?? 0) : 1);
                }
            }
        }
        const position = (y * width + left) * 4, bytes = yield { kind: "read", highDepth, position, length: count * 4 };
        if (!bytes || bytes.length !== count * 4 * (highDepth ? 2 : 1)) throw new Error("Truncated edge pixels");
        const samples = highDepth ? new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2) : bytes;
        const data = highDepth ? new Uint16Array(samples) : new Uint8Array(samples);
        for (let x = 0; x < count; x++) {
            const alpha = area * samples[x * 4 + 3]! - sums[x * 4 + 3]!;
            for (let c = 0; c < 4; c++) if (mask[c]) {
                // Normalize premultiplied colors by the convolved alpha, including
                // zero-sum kernels (ImageMagick uses a positive epsilon at zero).
                const value = image.hasAlpha && c < 3
                    ? (area * samples[x * 4 + c]! * samples[x * 4 + 3]! - sums[x * 4 + c]!) / (alpha === 0 ? maximum * 1e-12 : alpha)
                    : area * samples[x * 4 + c]! - sums[x * 4 + c]!;
                data[x * 4 + c] = Math.max(0, Math.min(maximum, Math.round(value)));
            }
        }
        yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
    }
}
