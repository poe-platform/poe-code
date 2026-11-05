import type { ConvolveRequest } from "./convolve-kernel.js";

export function* edgePixelSteps(image: { width: number; height: number }, radius: number): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const half = radius > 0 ? Math.ceil(radius) : 2;
    if (!Number.isFinite(half) || half > 5000) throw new Error("Edge radius exceeds 5000");
    const { width, height } = image, area = (2 * half + 1) ** 2;
    for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 1024) {
        yield;
        const count = Math.min(1024, width - left), sums = new Float64Array(count * 3);
        const first = Math.max(0, left - half), last = Math.min(width - 1, left + count - 1 + half);
        for (let ky = -half; ky <= half; ky++) {
            yield;
            const sy = Math.max(0, Math.min(height - 1, y + ky)), length = (last - first + 1) * 4;
            const bytes = yield { kind: "read", position: (sy * width + first) * 4, length };
            if (!bytes || bytes.length !== length) throw new Error("Truncated edge pixels");
            for (let c = 0; c < 3; c++) {
                let sum = 0;
                for (let k = -half; k <= half; k++) sum += bytes[(Math.max(0, Math.min(width - 1, left + k)) - first) * 4 + c]!;
                for (let x = 0; x < count; x++) {
                    sums[x * 3 + c]! += sum;
                    sum -= bytes[(Math.max(0, left + x - half) - first) * 4 + c]!;
                    sum += bytes[(Math.min(width - 1, left + x + half + 1) - first) * 4 + c] ?? 0;
                }
            }
        }
        const position = (y * width + left) * 4, bytes = yield { kind: "read", position, length: count * 4 };
        if (!bytes || bytes.length !== count * 4) throw new Error("Truncated edge pixels");
        const data = new Uint8Array(bytes);
        for (let x = 0; x < count; x++) {
            for (let c = 0; c < 3; c++) data[x * 4 + c] = Math.max(0, Math.min(255, area * bytes[x * 4 + c]! - sums[x * 3 + c]!));
        }
        yield { kind: "write", position, data };
    }
}
