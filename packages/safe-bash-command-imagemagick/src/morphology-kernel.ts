import type { ConvolveRequest } from "./convolve-kernel.js";

/** Four-channel sliding histograms; rows gives the included half-width at each vertical offset. */
export function* morphologyPixelSteps(image: { width: number; height: number }, rows: readonly number[], mode: "min" | "max" | "median"): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, histogram = new Float64Array(4 * 256);
    const ry = Math.floor(rows.length / 2);
    const rank = Math.floor(rows.reduce((total, radius) => total + radius * 2 + 1, 0) / 2);
    let work = 0;
    for (let y = 0; y < height; y++) {
        yield;
        histogram.fill(0);
        for (let left = 0; left < width; left += 1024) {
            const count = Math.min(1024, width - left), data = new Uint8Array(count * 4);
            for (let local = 0; local < count; local++) {
                const x = left + local;
                for (let phase = 0; phase < (x === 0 ? 1 : 2); phase++) {
                    const delta = x === 0 || phase === 1 ? 1 : -1;
                    for (let dy = -ry; dy <= ry; dy++) {
                        const rx = rows[dy + ry]!;
                        const first = x === 0 ? -rx : phase === 0 ? x - rx - 1 : x + rx;
                        const last = x === 0 ? rx : first;
                        for (let column = first; column <= last; column++) {
                            if (++work % 4096 === 0) yield;
                            const sx = Math.max(0, Math.min(width - 1, column)), sy = Math.max(0, Math.min(height - 1, y + dy));
                            const bytes = yield { kind: "read", position: (sy * width + sx) * 4, length: 4 };
                            if (!bytes || bytes.length !== 4) throw new Error("Truncated morphology pixels");
                            for (let c = 0; c < 4; c++) histogram[c * 256 + bytes[c]!]! += delta;
                        }
                    }
                }
                for (let c = 0; c < 4; c++) {
                    let value = mode === "max" ? 255 : 0, seen = 0;
                    if (mode === "median") {
                        for (; value < 255; value++) { seen += histogram[c * 256 + value]!; if (seen > rank) break; }
                    } else if (mode === "max") {
                        while (value > 0 && histogram[c * 256 + value] === 0) value--;
                    } else {
                        while (value < 255 && histogram[c * 256 + value] === 0) value++;
                    }
                    data[local * 4 + c] = value;
                }
            }
            yield { kind: "write", position: (y * width + left) * 4, data };
        }
    }
}
