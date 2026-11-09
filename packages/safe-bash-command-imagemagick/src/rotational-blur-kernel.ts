import { virtualPixelIndex } from "./virtual-pixel.js";
import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";

export function* rotationalBlurPixelSteps(image: Pick<RgbaImage, "width" | "height" | "data16"> & Partial<Pick<StoredRgbaImage, "storedData16">>, angle: number, background: RgbaColor, virtualPixel: VirtualPixelMethod = "edge", channels?: { r: boolean; g: boolean; b: boolean; a: boolean }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const highDepth = !!(image.data16 || image.storedData16), scale = highDepth ? 257 : 1;
    const { width, height } = image, cx = (width - 1) / 2, cy = (height - 1) / 2, radius = Math.hypot(cx, cy);
    const radians = angle * Math.PI / 180, samples = Math.max(2, Math.floor(Math.abs(4 * radians * Math.sqrt(radius) + 2)));
    if (!Number.isFinite(angle) || samples > 100_000) throw new Error("Rotational blur sample count exceeds limit");
    const cosines = new Float64Array(samples), sines = new Float64Array(samples);
    // Preserve native operation order: rounding at half-pixel boundaries selects the sample.
    const angularStep = radians / (samples - 1), offset = angularStep * (samples - 1) / 2;
    for (let j = 0; j < samples; j++) {
        yield;
        const theta = angularStep * j - offset;
        cosines[j] = Math.cos(theta); sines[j] = Math.sin(theta);
    }
    const mask = channels ? [channels.r, channels.g, channels.b, channels.a] : undefined;
    // Native uses nearest pixels, truncating coordinates toward zero after adding 0.5.
    for (let start = 0; start < width * height; start += 1024) {
        yield;
        const count = Math.min(1024, width * height - start);
        const original = yield { kind: "read", highDepth, position: start * 4, length: count * 4 };
        if (!original || original.length !== count * 4 * (highDepth ? 2 : 1)) throw new Error("Truncated rotational blur pixels");
        const data = highDepth ? new Uint16Array(original.slice().buffer) : original.slice();
        if (angle !== 0) for (let i = 0; i < count; i++) {
            yield;
            const dx = (start + i) % width - cx, dy = Math.floor((start + i) / width) - cy, distance = Math.hypot(dx, dy);
            const step = distance === 0 ? 1 : Math.max(1, Math.min(samples - 1, Math.floor(radius / distance)));
            const sums = [0, 0, 0, 0];
            let total = 0;
            for (let j = 0; j < samples; j += step) {
                yield;
                const cos = cosines[j]!, sin = sines[j]!;
                let x = Math.trunc(cx + dx * cos - dy * sin + 0.5), y = Math.trunc(cy + dx * sin + dy * cos + 0.5);
                let pixel: Uint8Array | Uint16Array | number[] | undefined;
                if (x < 0 || y < 0 || x >= width || y >= height) {
                    const index = virtualPixelIndex(x, y, width, height, virtualPixel);
                    if (index >= 0) {
                        x = index % width; y = Math.floor(index / width);
                    } else {
                        // Native gray is half the quantum range; round only the final blurred pixel.
                        const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 127.5 : 0;
                        const samples = (virtualPixel === "background" || virtualPixel?.endsWith("-tile")) ? [background.r, background.g, background.b, background.a] : [gray, gray, gray, virtualPixel === "transparent" ? 0 : 255];
                        pixel = samples.map(value => value * scale);
                    }
                }
                if (!pixel) {
                    const bytes = yield { kind: "read", highDepth, position: (y * width + x) * 4, length: 4 };
                    if (!bytes || bytes.length !== 4 * (highDepth ? 2 : 1)) throw new Error("Truncated rotational blur pixels");
                    pixel = highDepth ? new Uint16Array(bytes.buffer, bytes.byteOffset, 4) : bytes;
                }
                for (let c = 0; c < 3; c++) sums[c]! += pixel[c]! * pixel[3]!;
                sums[3]! += pixel[3]!;
                total++;
            }
            for (let c = 0; c < 4; c++) if (!mask || mask[c]) data[i * 4 + c] = Math.round(c === 3 ? sums[3]! / total : sums[3] ? sums[c]! / sums[3] : 0);
        }
        yield { kind: "write", highDepth, position: start * 4, data: new Uint8Array(data.buffer) };
    }
}
