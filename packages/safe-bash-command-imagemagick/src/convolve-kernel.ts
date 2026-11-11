import type { RgbaColor } from "@poe-code/image-ast/portable";
import type { VirtualPixelMethod } from "./warp-kernel.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import { regionContains, type Region } from "./region.js";

export interface ConvolveKernel {
    weights: number[];
    width: number;
    height: number;
    x: number;
    y: number;
}

// Positions and lengths count RGBA samples, or pixels for pngIndices; highDepth transfers native Uint16 sample bytes.
export type ConvolveRequest = { readonly kind: "read"; readonly pngIndices?: boolean; readonly evaluate?: boolean; readonly hue?: boolean; readonly highDepth?: boolean; readonly image?: number; readonly position: number; readonly length: number }
    | { readonly kind: "write"; readonly pngIndices?: boolean; readonly hue?: boolean; readonly highDepth?: boolean; readonly evaluate?: boolean; readonly position: number; readonly data: Uint8Array };
/** Alpha-aware convolution, bounded row spans, and owned output chunks. */
export function* convolvePixelSteps(image: { width: number; height: number; hasAlpha: boolean }, kernel: ConvolveKernel, bias: number, region?: Region, channels?: { r: boolean; g: boolean; b: boolean; a: boolean }, virtualPixel: VirtualPixelMethod = "edge", background?: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image;
    const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 127.5 : 0;
    const fill = virtualPixel === "background" || virtualPixel.endsWith("-tile")
        ? [background?.r ?? 255, background?.g ?? 255, background?.b ?? 255, background?.a ?? 255]
        : [gray, gray, gray, virtualPixel === "transparent" ? 0 : 255];
    const mask = channels ? [channels.r, channels.g, channels.b, channels.a] : undefined;
    for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 1024) {
        yield;
        const count = Math.min(1024, width - left), position = (y * width + left) * 4;
        const working = yield { kind: "read", evaluate: true, position, length: count * 4 };
        const evaluate = !!working?.length;
        const centerBytes = evaluate ? working : yield { kind: "read", position, length: count * 4 };
        if (!centerBytes || centerBytes.length !== count * 4 * (evaluate ? 8 : 1)) throw new Error("Truncated convolution pixels");
        const center = evaluate ? new Float64Array(centerBytes.slice().buffer) : centerBytes;
        const data = evaluate ? new Float64Array(center) : new Uint8Array(center), sums = new Float64Array(count * 4);
        sums.fill(bias);
        for (let ky = 0; ky < kernel.height; ky++) {
            yield;
            for (let kx = 0; kx < kernel.width; kx++) {
                const weight = kernel.weights[ky * kernel.width + kx] ?? 0;
                const indices = Int32Array.from({ length: count }, (_, x) =>
                    virtualPixelIndex(left + x + kx - kernel.x, y + ky - kernel.y, width, height, virtualPixel));
                for (let x = 0; x < count;) {
                    yield;
                    const pixel = indices[x]!;
                    const direction = x + 1 < count ? indices[x + 1]! - pixel : 0;
                    let run = 1;
                    if (direction >= -1 && direction <= 1) {
                        while (x + run < count && (pixel < 0 ? indices[x + run]! < 0
                            : indices[x + run] === pixel + run * direction && indices[x + run]! >= 0)) run++;
                    }
                    let pixels: Uint8Array | Float64Array | number[] = fill;
                    if (pixel >= 0) {
                        const first = direction === -1 ? pixel - run + 1 : pixel;
                        const length = (direction === 0 ? 1 : run) * 4;
                        const bytes = yield { kind: "read", evaluate, position: first * 4, length };
                        if (!bytes || bytes.length !== length * (evaluate ? 8 : 1)) throw new Error("Truncated convolution pixels");
                        pixels = evaluate ? new Float64Array(bytes.slice().buffer) : bytes;
                    }
                    for (let i = 0; i < run; i++) {
                        const offset = (pixel < 0 || direction === 0 ? 0 : direction === -1 ? run - i - 1 : i) * 4;
                        const alpha = image.hasAlpha ? pixels[offset + 3]! / 255 : 1;
                        for (let channel = 0; channel < 3; channel++) sums[(x + i) * 4 + channel]! += pixels[offset + channel]! * weight * alpha;
                        sums[(x + i) * 4 + 3]! += alpha * weight;
                    }
                    x += run;
                }
            }
        }
        for (let x = 0; x < count; x++) for (let channel = 0; channel < (image.hasAlpha ? 4 : 3); channel++) {
            if (mask && !mask[channel]) continue;
            const alpha = sums[x * 4 + 3]!;
            let value = channel === 3 ? alpha * 255 : sums[x * 4 + channel]! / (image.hasAlpha ? (Math.abs(alpha) < 1e-12 ? 1e-12 : alpha) : 1);
            if (region && !regionContains(region, left + x, y)) {
                // Native Q16-HDRI composites the region mask before clipping the
                // convolution, including negative colors and alpha above one.
                const sourceAlpha = image.hasAlpha ? center[x * 4 + 3]! / 255 : 1;
                const editedAlpha = image.hasAlpha ? Math.fround(alpha * 65535) / 65535 : 1;
                value = channel === 3 ? center[x * 4 + 3]!
                    : center[x * 4 + channel]! * sourceAlpha + Math.fround(value * 257) / 257 * editedAlpha * (1 - sourceAlpha);
            }
            // HDRI stores float32 quantum values without clipping to the output gamut.
            data[x * 4 + channel] = evaluate ? Math.fround(value * 257) / 257
                : Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round(value + 1e-12))) : 0;
        }
        if (evaluate) {
            yield { kind: "write", evaluate: true, position, data: new Uint8Array(data.buffer) };
            const bounded = Uint16Array.from(data, value => Math.max(0, Math.min(65535, Math.round(value * 257))));
            yield { kind: "write", highDepth: true, position, data: new Uint8Array(bounded.buffer) };
        } else yield { kind: "write", position, data: new Uint8Array(data.buffer) };
    }
}
