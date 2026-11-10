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
export function* convolvePixelSteps(image: { width: number; height: number; hasAlpha: boolean }, kernel: ConvolveKernel, bias: number, region?: Region): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image;
    for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 1024) {
        yield;
        const count = Math.min(1024, width - left), position = (y * width + left) * 4;
        const center = yield { kind: "read", position, length: count * 4 };
        if (!center || center.length !== count * 4) throw new Error("Truncated convolution pixels");
        const data = new Uint8Array(center), sums = new Float64Array(count * 4);
        sums.fill(bias);
        for (let ky = 0; ky < kernel.height; ky++) {
            yield;
            const sy = Math.max(0, Math.min(height - 1, y + ky - kernel.y));
            for (let kx = 0; kx < kernel.width; kx++) {
                const first = Math.max(0, Math.min(width - 1, left + kx - kernel.x));
                const last = Math.max(0, Math.min(width - 1, left + count - 1 + kx - kernel.x));
                const length = (last - first + 1) * 4, weight = kernel.weights[ky * kernel.width + kx] ?? 0;
                const bytes = yield { kind: "read", position: (sy * width + first) * 4, length };
                if (!bytes || bytes.length !== length) throw new Error("Truncated convolution pixels");
                for (let x = 0; x < count; x++) {
                    const offset = (Math.max(0, Math.min(width - 1, left + x + kx - kernel.x)) - first) * 4;
                    const alpha = image.hasAlpha ? bytes[offset + 3]! / 255 : 1;
                    for (let channel = 0; channel < 3; channel++) sums[x * 4 + channel]! += bytes[offset + channel]! * weight * alpha;
                    sums[x * 4 + 3]! += alpha * weight;
                }
            }
        }
        for (let x = 0; x < count; x++) for (let channel = 0; channel < (image.hasAlpha ? 4 : 3); channel++) {
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
            data[x * 4 + channel] = Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round(value + 1e-12))) : 0;
        }
        yield { kind: "write", position, data };
    }
}
