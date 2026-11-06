import type { ConvolveRequest } from "./convolve-kernel.js";

/** Four-channel sliding histograms; rows gives (width - 1) / 2 at each vertical offset; half-integers allow even windows. */
export function* morphologyPixelSteps(image: { width: number; height: number }, rows: readonly number[], mode: "min" | "max" | "median" | "mean" | "mode" | "rms" | "standarddeviation"): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, histogram = new Float64Array(4 * 256);
    const ry = Math.floor(rows.length / 2);
    const samples = rows.reduce((total, radius) => total + radius * 2 + 1, 0);
    const rank = Math.floor(samples / 2), sums = new Float64Array(4), squaredSums = new Float64Array(4);
    let work = 0;
    for (let y = 0; y < height; y++) {
        yield;
        histogram.fill(0);
        sums.fill(0);
        squaredSums.fill(0);
        for (let left = 0; left < width; left += 1024) {
            const count = Math.min(1024, width - left), data = new Uint8Array(count * 4);
            for (let local = 0; local < count; local++) {
                const x = left + local;
                for (let phase = 0; phase < (x === 0 ? 1 : 2); phase++) {
                    const delta = x === 0 || phase === 1 ? 1 : -1;
                    for (let row = 0; row < rows.length; row++) {
                        const rx = rows[row]!, before = Math.ceil(rx), after = Math.floor(rx);
                        const first = x === 0 ? -before : phase === 0 ? x - before - 1 : x + after;
                        const last = x === 0 ? after : first;
                        for (let column = first; column <= last; column++) {
                            if (++work % 4096 === 0) yield;
                            const sx = Math.max(0, Math.min(width - 1, column)), sy = Math.max(0, Math.min(height - 1, y + row - ry));
                            const bytes = yield { kind: "read", position: (sy * width + sx) * 4, length: 4 };
                            if (!bytes || bytes.length !== 4) throw new Error("Truncated morphology pixels");
                            for (let c = 0; c < 4; c++) {
                                if (mode === "standarddeviation") {
                                    sums[c]! += delta * bytes[c]!;
                                    squaredSums[c]! += delta * bytes[c]! * bytes[c]!;
                                } else if (mode === "rms") sums[c]! += delta * bytes[c]! * bytes[c]!;
                                else if (mode === "mean") sums[c]! += delta * bytes[c]!;
                                else histogram[c * 256 + bytes[c]!]! += delta;
                            }
                        }
                    }
                }
                for (let c = 0; c < 4; c++) {
                    let value = mode === "max" ? 255 : 0, seen = 0;
                    if (mode === "standarddeviation") {
                        const mean = sums[c]! / samples;
                        value = Math.round(Math.sqrt(Math.max(0, squaredSums[c]! / samples - mean * mean)));
                    } else if (mode === "rms") {
                        value = Math.round(Math.sqrt(sums[c]! / samples));
                    } else if (mode === "mean") {
                        value = Math.round(sums[c]! / samples);
                    } else if (mode === "mode") {
                        // Ascending traversal preserves the lowest value when frequencies tie.
                        for (let candidate = 0; candidate < 256; candidate++) {
                            const frequency = histogram[c * 256 + candidate]!;
                            if (frequency > seen) { seen = frequency; value = candidate; }
                        }
                    } else if (mode === "median") {
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
