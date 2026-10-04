export type ConvolveRequest = { readonly kind: "read"; readonly position: number; readonly length: number }
    | { readonly kind: "write"; readonly position: number; readonly data: Uint8Array };
/** RGB convolution with unchanged alpha, bounded row spans, and owned output chunks. */
export function* convolvePixelSteps(image: { width: number; height: number }, kernel: readonly number[], bias: number): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, side = Math.max(1, Math.round(Math.sqrt(kernel.length))), half = Math.floor(side / 2);
    for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 1024) {
        yield;
        const count = Math.min(1024, width - left), position = (y * width + left) * 4;
        const center = yield { kind: "read", position, length: count * 4 };
        if (!center || center.length !== count * 4) throw new Error("Truncated convolution pixels");
        const data = new Uint8Array(center), sums = new Float64Array(count * 3);
        sums.fill(bias);
        for (let ky = 0; ky < side; ky++) {
            yield;
            const sy = Math.max(0, Math.min(height - 1, y + ky - half));
            for (let kx = 0; kx < side; kx++) {
                const first = Math.max(0, Math.min(width - 1, left + kx - half));
                const last = Math.max(0, Math.min(width - 1, left + count - 1 + kx - half));
                const length = (last - first + 1) * 4, weight = kernel[ky * side + kx] ?? 0;
                const bytes = yield { kind: "read", position: (sy * width + first) * 4, length };
                if (!bytes || bytes.length !== length) throw new Error("Truncated convolution pixels");
                for (let x = 0; x < count; x++) {
                    const offset = (Math.max(0, Math.min(width - 1, left + x + kx - half)) - first) * 4;
                    for (let channel = 0; channel < 3; channel++) sums[x * 3 + channel]! += bytes[offset + channel]! * weight;
                }
            }
        }
        for (let x = 0; x < count; x++) for (let channel = 0; channel < 3; channel++) {
            const value = sums[x * 3 + channel]!;
            data[x * 4 + channel] = Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round(value))) : 0;
        }
        yield { kind: "write", position, data };
    }
}
