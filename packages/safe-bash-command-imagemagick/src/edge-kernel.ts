import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { VirtualPixelMethod } from "./warp-kernel.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

export function* edgePixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "data16"> & Partial<Pick<StoredRgbaImage, "storedData16">>, radius: number, channels?: { r: boolean; g: boolean; b: boolean; a: boolean }, virtualPixel: VirtualPixelMethod = "edge", background?: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const highDepth = !!(image.data16 || image.storedData16), maximum = highDepth ? 65535 : 255;
    const mask = channels ? [channels.r, channels.g, channels.b, channels.a && image.hasAlpha] : [true, true, true, image.hasAlpha];
    const half = radius > 0 ? Math.ceil(radius) : 2;
    if (!Number.isFinite(half) || half > 5000) throw new Error("Edge radius exceeds 5000");
    const { width, height } = image, area = (2 * half + 1) ** 2;
    const map = (value: number, size: number) => {
        if (virtualPixel === "tile" || virtualPixel === "mirror") {
            const period = size * (virtualPixel === "mirror" ? 2 : 1);
            const wrapped = ((value % period) + period) % period;
            return wrapped < size ? wrapped : period - wrapped - 1;
        }
        return virtualPixel === "edge" ? Math.max(0, Math.min(size - 1, value)) : value < 0 || value >= size ? -1 : value;
    };
    const gray = virtualPixel === "white" ? maximum : virtualPixel === "gray" ? 128 * (maximum / 255) : 0;
    const fill = virtualPixel === "background" && background
        ? [background.r, background.g, background.b, background.a].map(value => value * (maximum / 255))
        : [gray, gray, gray, virtualPixel === "transparent" ? 0 : maximum];
    for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 1024) {
        yield;
        const count = Math.min(1024, width - left), sums = new Float64Array(count * 4);
        const first = left - half, length = (count + 2 * half) * 4;
        for (let ky = -half; ky <= half; ky++) {
            yield;
            const sy = map(y + ky, height);
            const samples = highDepth ? new Uint16Array(length) : new Uint8Array(length);
            for (let x = 0; x < length / 4;) {
                yield;
                const sx = map(first + x, width);
                if (sy < 0 || sx < 0) {
                    samples.set(fill, x * 4);
                    x++;
                    continue;
                }
                let run = 1;
                const direction = map(first + x + 1, width) - sx;
                if (direction >= -1 && direction <= 1) {
                    while (x + run < length / 4 && map(first + x + run, width) === sx + run * direction && sx + run * direction >= 0) run++;
                }
                const start = direction === -1 ? sx - run + 1 : sx;
                const readLength = (direction === 0 ? 1 : run) * 4;
                const bytes = yield { kind: "read", highDepth, position: (sy * width + start) * 4, length: readLength };
                if (!bytes || bytes.length !== readLength * (highDepth ? 2 : 1)) throw new Error("Truncated edge pixels");
                const row = highDepth ? new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2) : bytes;
                if (direction === 1) samples.set(row, x * 4);
                else for (let i = 0; i < run; i++) {
                    const offset = (direction === 0 ? 0 : direction === -1 ? run - i - 1 : i) * 4;
                    samples.set(row.subarray(offset, offset + 4), (x + i) * 4);
                }
                x += run;
            }
            for (let c = 0; c < 4; c++) {
                if (!mask[c] && !(image.hasAlpha && c === 3)) continue;
                let sum = 0;
                for (let k = -half; k <= half; k++) {
                    const offset = (k + half) * 4;
                    sum += samples[offset + c]! * (image.hasAlpha && c < 3 ? samples[offset + 3]! : 1);
                }
                for (let x = 0; x < count; x++) {
                    sums[x * 4 + c]! += sum;
                    const outgoing = x * 4;
                    const incoming = (x + 2 * half + 1) * 4;
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
